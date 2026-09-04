import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => {
  const tools = [
    { name: "mongodb__find" },
    { name: "mongodb__atlas_local_connect" },
  ];
  const model = { id: "orchestrator-model" };
  const checkpointer = { id: "platform-checkpointer" };
  const graph = { id: "atlas-graph" };
  const legacyHitlMiddleware = { name: "langchain-hitl" };
  const magentaReviewMiddleware = { name: "magenta-tool-review" };

  return {
    tools,
    model,
    checkpointer,
    graph,
    legacyHitlMiddleware,
    magentaReviewMiddleware,
    humanInTheLoopMiddleware: vi.fn(() => legacyHitlMiddleware),
    startupEvents: [] as string[],
    agentWorkdirAtAppConstruction: undefined as string | undefined,
    appName: undefined as string | undefined,
    builder: undefined as (() => unknown) | undefined,
    buildLLM: vi.fn((_options: unknown) => model),
    deepAgent: vi.fn((_model: unknown, _options: unknown) => graph),
    run: vi.fn(),
  };
});

vi.mock("langchain", async (importOriginal) => {
  const actual = await importOriginal<typeof import("langchain")>();
  return {
    ...actual,
    humanInTheLoopMiddleware: harness.humanInTheLoopMiddleware,
  };
});

vi.mock("./toolReview.js", () => ({
  mutativeToolReviewMiddleware: harness.magentaReviewMiddleware,
}));

vi.mock("@magenta/magenta-sdklanggraph-ts", () => ({
  MagentaToolPodBackend: class {
    readonly id = "magenta-toolpod";

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

    getTools(): readonly { name: string }[] {
      return harness.tools;
    }

    checkpointer(): object {
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

vi.mock("./llm.js", () => ({
  buildLLM: harness.buildLLM,
}));

describe("Atlas Explorer graph assembly", () => {
  beforeEach(() => {
    harness.buildLLM.mockClear();
    harness.deepAgent.mockClear();
    harness.humanInTheLoopMiddleware.mockClear();
  });

  it("builds a single Magenta deep agent with MCP tools, skills, and platform checkpoints", async () => {
    const previousAgentWorkdir = process.env.AGENTIC_AGENT_WORKDIR;
    delete process.env.AGENTIC_AGENT_WORKDIR;

    const { app } = await import("./main.js");

    expect(app).toBeDefined();
    expect(harness.appName).toBe("atlas-explorer");
    expect(harness.agentWorkdirAtAppConstruction).toBe(process.cwd());
    expect(harness.startupEvents).toEqual(["app"]);
    expect(harness.builder).toBeTypeOf("function");

    harness.builder!();

    expect(harness.buildLLM).toHaveBeenCalledWith({
      provider: "openai",
      model: "gpt-5.6-luna",
    });
    expect(harness.deepAgent).toHaveBeenCalledWith(
      harness.model,
      expect.objectContaining({
        tools: [harness.tools[0]],
        skills: ["skills"],
        checkpointer: harness.checkpointer,
        middleware: expect.arrayContaining([
          expect.objectContaining({ name: "stripOpenAIToolEcho" }),
          harness.magentaReviewMiddleware,
        ]),
      }),
    );
    expect(harness.deepAgent.mock.calls[0]?.[1]).not.toHaveProperty(
      "subagents",
    );
    expect(harness.humanInTheLoopMiddleware).not.toHaveBeenCalled();
    const backend = (
      harness.deepAgent.mock.calls[0]?.[1] as {
        backend?: { id?: string; execute?: unknown };
      }
    ).backend;
    expect(backend?.id).toBe("magenta-toolpod");
    expect(backend?.execute).toBeUndefined();

    if (previousAgentWorkdir === undefined) {
      delete process.env.AGENTIC_AGENT_WORKDIR;
    } else {
      process.env.AGENTIC_AGENT_WORKDIR = previousAgentWorkdir;
    }
  });
});
