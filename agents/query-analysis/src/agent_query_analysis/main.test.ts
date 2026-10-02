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
} from "@repo/query-analysis-agent";

import { queryAnalysisConfig } from "./config.js";

const harness = vi.hoisted(() => {
  const tools = [
    { name: "mongodb__find" },
    { name: "mongodb__aggregate" },
    { name: "mongodb__drop_collection" },
  ];
  const model = { id: "orchestrator-model" };
  const graph = { id: "query-analysis-graph" };

  return {
    tools,
    model,
    checkpointer: undefined as unknown,
    graph,
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

    entrypoint(fn: () => unknown): () => unknown {
      harness.builder = fn;
      return fn;
    }

    prepareAgentInput(fn: (...args: never[]) => unknown): (...args: never[]) => unknown {
      harness.prepareAgentInput = fn;
      return fn;
    }

    getTools(): readonly { name: string }[] {
      return harness.tools;
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

vi.mock("@repo/query-analysis-agent", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@repo/query-analysis-agent")
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

describe("Query Analysis graph assembly", () => {
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
    expect(harness.appName).toBe("query-analysis");
    expect(harness.agentWorkdirAtAppConstruction).toBe(process.cwd());
    expect(harness.builder).toBeTypeOf("function");

    harness.builder!();

    expect(harness.buildLLM).toHaveBeenCalledWith({
      provider: queryAnalysisConfig.llm.provider,
      model: queryAnalysisConfig.llm.model,
      logPrefix: "query-analysis",
    });
    const options = assembled();
    expect(options.tools).toEqual([harness.tools[0], harness.tools[1]]);
    expect(options.systemPrompt).toBe(
      buildSystemPrompt({
        name: queryAnalysisConfig.systemPrompt.name,
        customInstructions: queryAnalysisConfig.systemPrompt.customInstructions,
        scope: queryAnalysisConfig.scope,
        maxQueryShapes: queryAnalysisConfig.maxQueryShapes,
      }),
    );
    expect(options.skills).toEqual(["skills"]);
    expect(options.middleware?.map((middleware) => middleware.name)).toEqual([
      stampResumeClientUserMiddleware.name,
      "stripOpenAIToolEcho",
      "annotatePerformanceAdvisor",
      "recoverToolErrors",
    ]);
    expect(harness.prepareAgentInput).toBe(prepareAgentInput);
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
