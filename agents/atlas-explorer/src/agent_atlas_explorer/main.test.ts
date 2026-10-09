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

import { HumanMessage } from "@langchain/core/messages";
import {
  MemorySaver,
  emptyCheckpoint,
  type BaseCheckpointSaver,
} from "@langchain/langgraph";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  approveAggregateWritesMiddleware,
  prepareAtlasExplorerInput,
  READ_ONLY_SYSTEM_PROMPT,
  stampClientUser,
  stampResumeClientUserMiddleware,
  WRITE_ENABLED_SYSTEM_PROMPT,
} from "@repo/atlas-explorer-agent";

import { atlasExplorerConfig } from "./config.js";

const harness = vi.hoisted(() => {
  const tools = [
    { name: "mongodb__find" },
    { name: "mongodb__drop_collection" },
    { name: "mongodb__future_mutating_operation" },
    { name: "mongodb__atlas_create_db_user" },
    { name: "mongodb__atlas_create_access_list" },
  ];
  const model = { id: "orchestrator-model" };
  const graph = { id: "atlas-graph" };
  const hitlMiddleware = { name: "atlas-hitl" };

  return {
    tools,
    model,
    // Replaced with a fresh saver per test so the in-place wrapper applied by
    // main.ts cannot stack across builds.
    checkpointer: undefined as unknown,
    graph,
    hitlMiddleware,
    hitlConfig: undefined as unknown,
    registeredTools: [] as Array<{
      name?: string;
      isLocal?: boolean;
      network?: readonly string[];
    }>,
    startupEvents: [] as string[],
    agentWorkdirAtAppConstruction: undefined as string | undefined,
    appName: undefined as string | undefined,
    builder: undefined as (() => unknown) | undefined,
    prepareAgentInput: undefined as ((...args: never[]) => unknown) | undefined,
    buildLLM: vi.fn((_options: unknown) => model),
    deepAgent: vi.fn((_model: unknown, _options: unknown) => graph),
    run: vi.fn(),
  };
});

vi.mock("langchain", async (importOriginal) => {
  const actual = await importOriginal<typeof import("langchain")>();
  return {
    ...actual,
    humanInTheLoopMiddleware: vi.fn((config: unknown) => {
      harness.hitlConfig = config;
      return harness.hitlMiddleware;
    }),
  };
});

vi.mock("@mongodb-js/agent-engine-sdk-langgraph", () => ({
  AgentEngineToolSandboxBackend: class {
    readonly id = "agent-engine-toolpod";

    execute(): void {}
  },
  App: class {
    constructor(options: { appName: string }) {
      harness.startupEvents.push("app");
      harness.agentWorkdirAtAppConstruction = process.env.AGENTIC_AGENT_WORKDIR;
      harness.appName = options.appName;
    }

    get agentConfig(): { mcp: { servers: Record<string, unknown> } } {
      return { mcp: { servers: {} } };
    }

    ready(): Promise<void> {
      return Promise.resolve();
    }

    tool(options: {
      name?: string;
      isLocal?: boolean;
      network?: readonly string[];
    } = {}) {
      harness.registeredTools.push(options);
      return (fn: unknown) => fn;
    }

    entrypoint(fn: () => unknown): () => unknown {
      harness.builder = fn;
      return fn;
    }

    prepareAgentInput(fn: (...args: never[]) => unknown): (...args: never[]) => unknown {
      harness.prepareAgentInput = fn;
      return fn;
    }

    getTools(): readonly { name: string }[] {
      const registered = harness.registeredTools.flatMap((tool) =>
        tool.name === undefined ? [] : [{ name: tool.name }],
      );
      return [...harness.tools, ...registered];
    }

    checkpointer(): unknown {
      return harness.checkpointer;
    }

    deepAgent(_model: unknown, options: unknown): unknown {
      return harness.deepAgent(_model, options);
    }

    run(): void {
      harness.run();
    }

    llm(model: unknown): unknown {
      return model;
    }
  },
}));

vi.mock("@repo/atlas-explorer-agent", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@repo/atlas-explorer-agent")
  >();
  return {
    ...actual,
    buildLLM: harness.buildLLM,
  };
});

async function loadBuilder(): Promise<() => unknown> {
  if (harness.builder === undefined) {
    await import("./main.js");
  }
  if (harness.builder === undefined) {
    throw new Error("agent builder was not registered");
  }
  return harness.builder;
}

function assembledTools(): { name: string }[] {
  return (
    harness.deepAgent.mock.calls[0]?.[1] as {
      tools: { name: string }[];
    }
  ).tools;
}

describe("Atlas Explorer graph assembly", () => {
  const previousAgentWorkdir = process.env.AGENTIC_AGENT_WORKDIR;
  const previousAllowWrites = process.env.ALLOW_WRITE_OPERATIONS;

  beforeEach(() => {
    harness.buildLLM.mockClear();
    harness.deepAgent.mockClear();
    harness.checkpointer = new MemorySaver();
    delete process.env.ALLOW_WRITE_OPERATIONS;
  });

  afterEach(() => {
    if (previousAllowWrites === undefined) {
      delete process.env.ALLOW_WRITE_OPERATIONS;
    } else {
      process.env.ALLOW_WRITE_OPERATIONS = previousAllowWrites;
    }
  });

  it("builds a single Agent Engine deep agent with MCP tools, skills, and platform checkpoints", async () => {
    delete process.env.AGENTIC_AGENT_WORKDIR;

    const { app } = await import("./main.js");

    expect(app).toBeDefined();
    expect(harness.appName).toBe("atlas-explorer");
    expect(harness.agentWorkdirAtAppConstruction).toBe(process.cwd());
    expect(harness.startupEvents).toEqual(["app"]);
    expect(harness.builder).toBeTypeOf("function");

    harness.builder!();

    expect(harness.buildLLM).toHaveBeenCalledWith({
      provider: atlasExplorerConfig.llm.provider,
      model: atlasExplorerConfig.llm.model,
      logPrefix: "atlas-explorer",
    });
    expect(harness.deepAgent).toHaveBeenCalledWith(
      harness.model,
      expect.objectContaining({
        tools: [
          harness.tools[0],
          { name: "search_knowledge" },
          { name: "list_knowledge_sources" },
        ],
        systemPrompt: READ_ONLY_SYSTEM_PROMPT,
        skills: ["skills"],
        checkpointer: harness.checkpointer,
        middleware: [
          stampResumeClientUserMiddleware,
          expect.objectContaining({ name: "stripOpenAIToolEcho" }),
          expect.objectContaining({ name: "redactSecrets" }),
          harness.hitlMiddleware,
          approveAggregateWritesMiddleware,
          expect.objectContaining({ name: "recoverToolErrors" }),
        ],
      }),
    );
    const agentInput = { payload: { message: "List projects" } };
    const requestContext = { userId: "user-1", sessionId: "session-1" };
    expect(
      (harness.prepareAgentInput as typeof prepareAtlasExplorerInput)(
        agentInput,
        requestContext,
      ),
    ).toEqual(prepareAtlasExplorerInput(agentInput, requestContext));
    expect(harness.deepAgent.mock.calls[0]?.[1]).not.toHaveProperty(
      "subagents",
    );
    expect(harness.hitlConfig).toEqual({
      interruptOn: {},
      descriptionPrefix: "MongoDB or Atlas operation pending approval",
    });
    const backend = (
      harness.deepAgent.mock.calls[0]?.[1] as {
        backend?: { id?: string; execute?: unknown };
      }
    ).backend;
    expect(backend?.id).toBe("agent-engine-toolpod");
    expect(backend?.execute).toBeUndefined();
    expect(
      harness.registeredTools.map((tool) => tool.name).sort(),
    ).toEqual(["list_knowledge_sources", "search_knowledge"]);
    expect(
      harness.registeredTools.every((tool) => tool.isLocal === false),
    ).toBe(true);
    expect(
      harness.registeredTools.every((tool) =>
        tool.network?.includes("knowledge.mongodb.com"),
      ),
    ).toBe(true);

    if (previousAgentWorkdir === undefined) {
      delete process.env.AGENTIC_AGENT_WORKDIR;
    } else {
      process.env.AGENTIC_AGENT_WORKDIR = previousAgentWorkdir;
    }
  });

  it("hands the deep agent a checkpointer that records the requester", async () => {
    const builder = await loadBuilder();
    builder();

    const { checkpointer } = harness.deepAgent.mock.calls[0]?.[1] as {
      checkpointer: BaseCheckpointSaver;
    };
    const config = { configurable: { thread_id: "thread-1" } };
    const ada = { id: "U123", username: "ada", actor_id: "slack:U123" };
    await checkpointer.put(
      config,
      {
        ...emptyCheckpoint(),
        channel_values: {
          messages: [
            stampClientUser(new HumanMessage({ id: "m1", content: "hi" }), {
              client: "slack",
              user: ada,
            }),
          ],
        },
      },
      { source: "loop", step: 1, parents: {} },
      {},
    );

    const tuple = await checkpointer.getTuple(config);
    expect(tuple?.metadata).toMatchObject({
      source: "loop",
      requester: { client: "slack", user: ada, message_type: "human" },
    });
  });

  it("keeps write tools hidden when ALLOW_WRITE_OPERATIONS is empty", async () => {
    process.env.ALLOW_WRITE_OPERATIONS = "";
    const builder = await loadBuilder();
    builder();

    expect(assembledTools().map((tool) => tool.name)).toEqual([
      "mongodb__find",
      "search_knowledge",
      "list_knowledge_sources",
    ]);
    expect(
      (harness.deepAgent.mock.calls[0]?.[1] as { systemPrompt?: string })
        .systemPrompt,
    ).toBe(READ_ONLY_SYSTEM_PROMPT);
    expect(harness.hitlConfig).toEqual({
      interruptOn: {},
      descriptionPrefix: "MongoDB or Atlas operation pending approval",
    });
  });

  it("keeps write tools hidden when ALLOW_WRITE_OPERATIONS is false", async () => {
    process.env.ALLOW_WRITE_OPERATIONS = "false";
    const builder = await loadBuilder();
    builder();

    expect(assembledTools().map((tool) => tool.name)).toEqual([
      "mongodb__find",
      "search_knowledge",
      "list_knowledge_sources",
    ]);
    expect(harness.hitlConfig).toEqual({
      interruptOn: {},
      descriptionPrefix: "MongoDB or Atlas operation pending approval",
    });
  });

  it("exposes write tools behind HITL when ALLOW_WRITE_OPERATIONS is set", async () => {
    process.env.ALLOW_WRITE_OPERATIONS = "1";
    const builder = await loadBuilder();
    builder();

    const names = assembledTools().map((tool) => tool.name);
    expect(names).toEqual([
      "mongodb__find",
      "mongodb__drop_collection",
      "mongodb__future_mutating_operation",
      "search_knowledge",
      "list_knowledge_sources",
    ]);
    expect(names).not.toContain("mongodb__atlas_create_db_user");
    expect(names).not.toContain("mongodb__atlas_create_access_list");
    expect(
      (harness.deepAgent.mock.calls[0]?.[1] as { systemPrompt?: string })
        .systemPrompt,
    ).toBe(WRITE_ENABLED_SYSTEM_PROMPT);
    expect(harness.hitlConfig).toEqual({
      interruptOn: {
        mongodb__drop_collection: true,
        mongodb__future_mutating_operation: true,
      },
      descriptionPrefix: "MongoDB or Atlas operation pending approval",
    });
    expect(
      (
        harness.deepAgent.mock.calls[0]?.[1] as {
          middleware?: { name?: string }[];
        }
      ).middleware?.map((middleware) => middleware.name),
    ).toContain("approveAggregateWrites");
  });
});
