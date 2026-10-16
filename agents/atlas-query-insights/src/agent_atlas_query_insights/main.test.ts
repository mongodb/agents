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
  buildSystemPrompt,
  prepareAgentInput,
  stampClientUser,
  stampResumeClientUserMiddleware,
} from "@repo/atlas-query-insights-agent";

import { atlasQueryInsightsConfig } from "./config.js";

const harness = vi.hoisted(() => {
  const tools = [
    { name: "mongodb__find" },
    { name: "mongodb__aggregate" },
    { name: "mongodb__search_knowledge" },
    { name: "mongodb__list_knowledge_sources" },
    { name: "mongodb__drop_collection" },
  ];
  const model = { id: "orchestrator-model" };
  const graph = { id: "atlas-query-insights-graph" };

  return {
    tools,
    model,
    checkpointer: undefined as unknown,
    graph,
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

    ready(): Promise<void> {
      return Promise.resolve();
    }

    entrypoint(fn: () => unknown): () => unknown {
      harness.builder = fn;
      return fn;
    }

    prepareAgentInput(fn: (...args: never[]) => unknown): (...args: never[]) => unknown {
      harness.prepareAgentInput = fn;
      return fn;
    }

    tool(options: {
      name?: string;
      isLocal?: boolean;
      network?: readonly string[];
    } = {}) {
      harness.registeredTools.push(options);
      return (fn: unknown) => fn;
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
  },
}));

vi.mock("@repo/atlas-query-insights-agent", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@repo/atlas-query-insights-agent")
  >();
  return {
    ...actual,
    buildLLM: harness.buildLLM,
  };
});

function assembled(): {
  tools: { name: string }[];
  systemPrompt?: string;
  skills?: string[];
  middleware?: { name?: string }[];
  backend?: { id?: string; execute?: unknown };
  checkpointer?: BaseCheckpointSaver;
} {
  return harness.deepAgent.mock.calls[0]?.[1] as never;
}

describe("Atlas Query Insights graph assembly", () => {
  const previousAgentWorkdir = process.env.AGENTIC_AGENT_WORKDIR;

  beforeEach(() => {
    harness.buildLLM.mockClear();
    harness.deepAgent.mockClear();
    harness.checkpointer = new MemorySaver();
  });

  afterEach(() => {
    if (previousAgentWorkdir === undefined) {
      delete process.env.AGENTIC_AGENT_WORKDIR;
    } else {
      process.env.AGENTIC_AGENT_WORKDIR = previousAgentWorkdir;
    }
  });

  it("builds a read-only deep agent with the evidence middleware and no write tools", async () => {
    delete process.env.AGENTIC_AGENT_WORKDIR;
    const { app } = await import("./main.js");

    expect(app).toBeDefined();
    expect(harness.appName).toBe("atlas-query-insights");
    expect(harness.agentWorkdirAtAppConstruction).toBe(process.cwd());
    expect(harness.builder).toBeTypeOf("function");

    harness.builder!();

    expect(harness.buildLLM).toHaveBeenCalledWith({
      provider: atlasQueryInsightsConfig.llm.provider,
      model: atlasQueryInsightsConfig.llm.model,
      logPrefix: "atlas-query-insights",
    });
    const options = assembled();
    expect(options.tools.map((tool) => tool.name)).toEqual([
      "mongodb__find",
      "mongodb__aggregate",
      "search_knowledge",
      "list_knowledge_sources",
    ]);
    expect(harness.registeredTools.map((tool) => tool.name)).toEqual([
      "search_knowledge",
      "list_knowledge_sources",
    ]);
    expect(
      harness.registeredTools.every(
        (tool) =>
          tool.isLocal === false &&
          tool.network?.includes("knowledge.mongodb.com"),
      ),
    ).toBe(true);
    expect(options.systemPrompt).toBe(
      buildSystemPrompt({
        name: atlasQueryInsightsConfig.systemPrompt.name,
        customInstructions: atlasQueryInsightsConfig.systemPrompt.customInstructions,
        scope: atlasQueryInsightsConfig.scope,
        maxQueryShapes: atlasQueryInsightsConfig.maxQueryShapes,
      }),
    );
    expect(options.skills).toEqual(["skills"]);
    expect(options.middleware?.map((middleware) => middleware.name)).toEqual([
      "inputRefusal",
      stampResumeClientUserMiddleware.name,
      "stripOpenAIToolEcho",
      "redactSecrets",
      "rejectAggregateWrites",
      "recoverToolErrors",
    ]);
    const hook = harness.prepareAgentInput as typeof prepareAgentInput;
    const clean = { payload: { message: "List slow queries" } };
    expect(hook(clean, {})).toEqual(prepareAgentInput(clean, {}));
    const secret = {
      payload: { message: "use mongodb://admin:hunter2@db.example.com/test" },
    };
    const [message] = hook(secret, {}).messages as HumanMessage[];
    expect(message?.content).not.toContain("hunter2");
    expect(options.backend?.id).toBe("agent-engine-toolpod");
    expect(options.backend?.execute).toBeUndefined();
    expect(harness.deepAgent.mock.calls[0]?.[1]).not.toHaveProperty("subagents");
  });

  it("hands the deep agent a checkpointer that records the requester", async () => {
    const { buildAgent } = await import("./main.js");
    buildAgent();

    const { checkpointer } = assembled();
    if (!checkpointer) throw new Error("checkpointer was not wired");
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
});
