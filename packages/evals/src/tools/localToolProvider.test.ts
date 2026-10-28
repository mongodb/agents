/**
 * Copyright 2026 MongoDB, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { atlasExplorerAgent } from "../agents/atlasExplorer.js";
import { atlasQueryInsightsAgent } from "../agents/atlasQueryInsights.js";
import { makeAgentTask } from "../task.js";
import {
  startEphemeralMongo,
  type EphemeralMongo,
} from "../mongo/ephemeralMongo.js";
import type { MongoSeed } from "../mongo/seed.js";
import {
  createLocalToolProvider,
  type LocalToolProviderOptions,
} from "./localToolProvider.js";
import type { CaseTools, ToolProvider } from "./types.js";

const ORG = "5".padEnd(24, "0");
const PROJECT = "6".padEnd(24, "0");

const mockAtlas = {
  orgs: [{ id: ORG, name: "Acme" }],
  projects: [
    {
      id: PROJECT,
      name: "prod",
      orgId: ORG,
      clusters: [
        {
          name: "c1",
          advisor: {
            suggestedIndexes: [
              {
                id: "idx1",
                namespace: "shop.orders",
                index: [{ customerId: 1 }],
                weight: 5000,
                impact: ["q1"],
              },
            ],
          },
        },
      ],
    },
  ],
};

const localMongo = {
  shop: {
    orders: {
      documents: [
        { _id: 1, customerId: "a", total: 10 },
        { _id: 2, customerId: "b", total: 20 },
      ],
      indexes: [{ key: { customerId: 1 } }],
    },
  },
};

let provider: ToolProvider;

beforeAll(async () => {
  provider = createLocalToolProvider();
  await provider.start?.();
});

afterAll(async () => {
  await provider.stop?.();
});

async function withCase<T>(
  request: Parameters<ToolProvider["forCase"]>[0],
  body: (caseTools: CaseTools, call: (name: string, args: object) => Promise<any>) => Promise<T>,
): Promise<T> {
  const caseTools = await provider.forCase(request);
  const call = async (name: string, args: object) => {
    const found = caseTools.tools.find((t) => t.name === name);
    if (!found) throw new Error(`no tool ${name}`);
    return found.invoke(args as never);
  };
  try {
    return await body(caseTools, call);
  } finally {
    await caseTools.dispose();
  }
}

describe("local tool provider", () => {
  it("offers the agents' tool names and hides local-only tools", async () => {
    await withCase({ allowWrites: false }, async ({ tools }) => {
      const names = tools.map((t) => t.name);
      expect(names).toContain("mongodb__atlas_list_projects");
      expect(names).toContain("mongodb__atlas_connect_cluster");
      expect(names).toContain("mongodb__find");
      expect(names).not.toContain("mongodb__connect");
      expect(names).not.toContain("mongodb__export");
      expect(names.some((n) => n.startsWith("mongodb__atlas_local"))).toBe(false);
    });
  });

  it("serves the seeded Atlas account", async () => {
    await withCase(
      { allowWrites: false, setup: { mockAtlas } },
      async (_caseTools, call) => {
        const result = await call("mongodb__atlas_list_clusters", {
          projectId: PROJECT,
        });
        expect(JSON.stringify(result)).toContain('"name":"c1"');
      },
    );
  });

  it("reads seeded documents through a read-only server", async () => {
    await withCase(
      { allowWrites: false, setup: { localMongo } },
      async ({ tools }, call) => {
        expect(tools.map((t) => t.name)).not.toContain("mongodb__insert_many");
        const found = await call("mongodb__find", {
          connectionId: "preconfigured",
          database: "shop",
          collection: "orders",
          filter: { customerId: "b" },
        });
        expect(JSON.stringify(found)).toContain('"total\\":20');
      },
    );
  });

  it("gives a write case its own database", async () => {
    const insert = (call: (n: string, a: object) => Promise<unknown>) =>
      call("mongodb__insert_many", {
        connectionId: "preconfigured",
        database: "shop",
        collection: "orders",
        documents: [{ _id: 3, customerId: "c", total: 30 }],
      });

    const [first, second] = await Promise.all([
      withCase({ allowWrites: true, setup: { localMongo } }, async (c, call) => {
        await insert(call);
        return c.state() as Promise<any>;
      }),
      withCase({ allowWrites: true, setup: { localMongo } }, async (c) =>
        c.state() as Promise<any>,
      ),
    ]);

    expect(first.mongo.shop.orders).toHaveLength(3);
    expect(second.mongo.shop.orders).toHaveLength(2);
  });

  it("reports atlas state and the requests the tools made", async () => {
    await withCase(
      { allowWrites: true, setup: { mockAtlas } },
      async (c, call) => {
        await call("mongodb__atlas_pause_resume_cluster", {
          projectId: PROJECT,
          clusterName: "c1",
          action: "PAUSE",
        });
        const state = (await c.state()) as any;
        expect(state.atlas.projects[0].clusters[0].paused).toBe(true);
        expect(state.atlasRequests).toContainEqual(
          expect.objectContaining({ method: "PATCH", status: 200 }),
        );
        expect(state.mongo).toBeUndefined();
      },
    );
  });

  it("rejects a malformed setup without leaving a server behind", async () => {
    await expect(
      provider.forCase({
        allowWrites: false,
        setup: { localMongo: { admin: { users: {} } } },
      }),
    ).rejects.toThrow(/admin, config, or local/);
  });

  it("stops the case's server on dispose", async () => {
    const caseTools = await provider.forCase({ allowWrites: false });
    const list = caseTools.tools.find(
      (t) => t.name === "mongodb__atlas_list_orgs",
    )!;
    await caseTools.dispose();
    await expect(list.invoke({} as never)).rejects.toThrow();
  });
});

describe("shared mongod lifetime", () => {
  const seedOf = (n: number) => ({
    shop: { orders: { documents: [{ _id: n }] } },
  });

  async function countingProvider(
    options: Pick<LocalToolProviderOptions, "maxIdleSharedMongos">,
  ) {
    const counts = { started: 0, stopped: 0 };
    const counting = createLocalToolProvider({
      ...options,
      startMongo: async (seed: MongoSeed): Promise<EphemeralMongo> => {
        counts.started++;
        const mongo = await startEphemeralMongo(seed);
        return {
          ...mongo,
          stop: async () => {
            counts.stopped++;
            await mongo.stop();
          },
        };
      },
    });
    await counting.start?.();
    const readOnlyCase = async (n: number) => {
      const tools = await counting.forCase({
        allowWrites: false,
        setup: { localMongo: seedOf(n) },
      });
      await tools.dispose();
    };
    return { counting, counts, readOnlyCase };
  }

  it("reuses an idle instance for the same seed", async () => {
    const { counting, counts, readOnlyCase } = await countingProvider({});
    try {
      await readOnlyCase(1);
      await readOnlyCase(1);

      expect(counts).toEqual({ started: 1, stopped: 0 });
    } finally {
      await counting.stop?.();
    }
    expect(counts.stopped).toBe(1);
  }, 120_000);

  it("stops an instance once no case uses it and none may idle", async () => {
    const { counting, counts, readOnlyCase } = await countingProvider({
      maxIdleSharedMongos: 0,
    });
    try {
      await readOnlyCase(1);

      expect(counts).toEqual({ started: 1, stopped: 1 });
    } finally {
      await counting.stop?.();
    }
  }, 120_000);

  it("keeps a shared instance running while a case still uses it", async () => {
    const { counting, counts } = await countingProvider({
      maxIdleSharedMongos: 0,
    });
    try {
      const request = {
        allowWrites: false,
        setup: { localMongo: seedOf(1) },
      };
      const first = await counting.forCase(request);
      const second = await counting.forCase(request);
      await first.dispose();

      expect(counts).toEqual({ started: 1, stopped: 0 });
      await second.dispose();
      expect(counts).toEqual({ started: 1, stopped: 1 });
    } finally {
      await counting.stop?.();
    }
  }, 120_000);

  it("evicts the oldest idle instance past the limit", async () => {
    const { counting, counts, readOnlyCase } = await countingProvider({
      maxIdleSharedMongos: 1,
    });
    try {
      await readOnlyCase(1);
      await readOnlyCase(2);
      await readOnlyCase(3);

      expect(counts).toEqual({ started: 3, stopped: 2 });
    } finally {
      await counting.stop?.();
    }
    expect(counts.stopped).toBe(3);
  }, 180_000);
});

describe("with the agents", () => {
  it("lets Atlas Explorer read Atlas and MongoDB data", async () => {
    const task = makeAgentTask(atlasExplorerAgent, {
      toolProvider: provider,
      callbacks: () => [],
    });
    const output = await task.run({
      modelName: "scripted",
      modelConfig: { kind: "scripted" },
      input: {
        messages: [{ role: "user", content: "How many orders are there?" }],
        custom: {
          toolSetup: { mockAtlas, localMongo },
          script: [
            {
              toolCalls: [
                {
                  name: "mongodb__count",
                  args: {
                    connectionId: "preconfigured",
                    database: "shop",
                    collection: "orders",
                  },
                },
              ],
            },
            { text: "There are 2 orders." },
          ],
        },
      },
    });

    const toolMessage = output.messages.find((m) => m.role === "tool");
    expect(toolMessage?.content).toContain("2");
    expect(output.custom?.executed.map((c) => c.name)).toEqual([
      "mongodb__count",
    ]);
  });

  it("pauses a cluster after approval and leaves the change in state", async () => {
    const task = makeAgentTask(atlasExplorerAgent, {
      toolProvider: provider,
      callbacks: () => [],
    });
    const output = await task.run({
      modelName: "scripted",
      modelConfig: { kind: "scripted" },
      input: {
        messages: [{ role: "user", content: "Pause c1" }],
        custom: {
          allowWrites: true,
          toolSetup: { mockAtlas },
          script: [
            {
              toolCalls: [
                {
                  name: "mongodb__atlas_pause_resume_cluster",
                  args: { projectId: PROJECT, clusterName: "c1", action: "PAUSE" },
                },
              ],
            },
            { text: "Paused c1." },
          ],
        },
      },
    });

    expect(output.custom?.approvalRequests).toEqual([
      "mongodb__atlas_pause_resume_cluster",
    ]);
    const state = output.custom?.state as any;
    expect(state.atlas.projects[0].clusters[0].paused).toBe(true);
  });

  it("leaves the cluster alone when the approval is rejected", async () => {
    const task = makeAgentTask(atlasExplorerAgent, {
      toolProvider: provider,
      callbacks: () => [],
    });
    const output = await task.run({
      modelName: "scripted",
      modelConfig: { kind: "scripted" },
      input: {
        messages: [{ role: "user", content: "Pause c1" }],
        custom: {
          allowWrites: true,
          approval: "reject",
          toolSetup: { mockAtlas },
          script: [
            {
              toolCalls: [
                {
                  name: "mongodb__atlas_pause_resume_cluster",
                  args: { projectId: PROJECT, clusterName: "c1", action: "PAUSE" },
                },
              ],
            },
            { text: "Okay." },
          ],
        },
      },
    });

    const state = output.custom?.state as any;
    expect(state.atlas.projects[0].clusters[0].paused).toBe(false);
    expect(state.atlasRequests.some((r: any) => r.method === "PATCH")).toBe(
      false,
    );
  });

  it("gives Query Insights the advisor output", async () => {
    const task = makeAgentTask(atlasQueryInsightsAgent, {
      toolProvider: provider,
      callbacks: () => [],
    });
    const output = await task.run({
      modelName: "scripted",
      modelConfig: { kind: "scripted" },
      input: {
        messages: [{ role: "user", content: "Any index suggestions?" }],
        custom: {
          toolSetup: { mockAtlas },
          script: [
            {
              toolCalls: [
                {
                  name: "mongodb__atlas_get_performance_advisor",
                  args: { projectId: PROJECT, clusterName: "c1" },
                },
              ],
            },
            { text: "Index on customerId." },
          ],
        },
      },
    });

    const toolMessage = output.messages.find((m) => m.role === "tool");
    expect(toolMessage?.content).toContain("customerId");
  });
});
