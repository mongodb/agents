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

import { makeAgentTask } from "@mongodb-js/atlas-agents-eval";
import {
  createLocalToolProvider,
  withNamedFixtures,
  type ToolProvider,
} from "@mongodb-js/atlas-agents-eval/tools";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { atlasExplorerAgent } from "./agents/atlasExplorer.js";
import { atlasQueryInsightsAgent } from "./agents/atlasQueryInsights.js";
import { FIXTURES } from "./suite.js";

let provider: ToolProvider;

beforeAll(async () => {
  provider = createLocalToolProvider();
  await provider.start?.();
});

afterAll(async () => {
  await provider.stop?.();
});

describe("with the agents", () => {
  // The agents' cases name shared fixtures, as the datasets do.
  const ADVISOR_ACCOUNT = "one-project-with-advisor";
  const FIXTURE_PROJECT = "600000000000000000000001";
  const named = () => withNamedFixtures(provider, FIXTURES);

  it("lets Atlas Explorer read Atlas and MongoDB data", async () => {
    const task = makeAgentTask(atlasExplorerAgent, {
      toolProvider: named(),
      callbacks: () => [],
    });
    const output = await task.run({
      modelName: "scripted",
      modelConfig: { kind: "scripted" },
      input: {
        messages: [{ role: "user", content: "How many orders are there?" }],
        custom: {
          toolSetup: { mockAtlas: ADVISOR_ACCOUNT, localMongo: "shop-orders" },
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
      toolProvider: named(),
      callbacks: () => [],
    });
    const output = await task.run({
      modelName: "scripted",
      modelConfig: { kind: "scripted" },
      input: {
        messages: [{ role: "user", content: "Pause Cluster0" }],
        custom: {
          allowWrites: true,
          toolSetup: { mockAtlas: ADVISOR_ACCOUNT },
          script: [
            {
              toolCalls: [
                {
                  name: "mongodb__atlas_pause_resume_cluster",
                  args: { projectId: FIXTURE_PROJECT, clusterName: "Cluster0", action: "PAUSE" },
                },
              ],
            },
            { text: "Paused Cluster0." },
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
      toolProvider: named(),
      callbacks: () => [],
    });
    const output = await task.run({
      modelName: "scripted",
      modelConfig: { kind: "scripted" },
      input: {
        messages: [{ role: "user", content: "Pause Cluster0" }],
        custom: {
          allowWrites: true,
          approval: "reject",
          toolSetup: { mockAtlas: ADVISOR_ACCOUNT },
          script: [
            {
              toolCalls: [
                {
                  name: "mongodb__atlas_pause_resume_cluster",
                  args: { projectId: FIXTURE_PROJECT, clusterName: "Cluster0", action: "PAUSE" },
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
      toolProvider: named(),
      callbacks: () => [],
    });
    const output = await task.run({
      modelName: "scripted",
      modelConfig: { kind: "scripted" },
      input: {
        messages: [{ role: "user", content: "Any index suggestions?" }],
        custom: {
          toolSetup: { mockAtlas: ADVISOR_ACCOUNT },
          script: [
            {
              toolCalls: [
                {
                  name: "mongodb__atlas_get_performance_advisor",
                  args: { projectId: FIXTURE_PROJECT, clusterName: "Cluster0" },
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
