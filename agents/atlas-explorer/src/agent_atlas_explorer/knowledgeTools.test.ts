import { AssistantToolBase } from "@mongodb-js/mcp-tools-assistant";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  KNOWLEDGE_NETWORK_HOST,
  LIST_KNOWLEDGE_SOURCES_TOOL_NAME,
  SEARCH_KNOWLEDGE_TOOL_NAME,
  createKnowledgeTools,
  registerKnowledgeTools,
} from "./knowledgeTools.js";

type ToolOptions = {
  name?: string;
  description?: string;
  isLocal?: boolean;
  network?: readonly string[];
  schema?: unknown;
};

type RegisteredTool = {
  options: ToolOptions;
  fn: (...args: never[]) => unknown;
};

function createFakeApp(): {
  app: Parameters<typeof registerKnowledgeTools>[0];
  registered: RegisteredTool[];
} {
  const registered: RegisteredTool[] = [];
  function registerCapture(options: ToolOptions) {
    return (fn: RegisteredTool["fn"]) => {
      registered.push({ options, fn });
      return fn;
    };
  }
  return {
    app: {
      tool: registerCapture as Parameters<typeof registerKnowledgeTools>[0]["tool"],
    },
    registered,
  };
}

function knowledgeTool(name: string) {
  const tool = createKnowledgeTools().find((entry) => entry.name === name);
  if (!tool) {
    throw new Error(`missing knowledge tool ${name}`);
  }
  return tool;
}

describe("knowledge tool wrapper", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers both assistant tools as remote Tool Pod calls", () => {
    const { app, registered } = createFakeApp();
    registerKnowledgeTools(app);

    expect(registered.map((entry) => entry.options.name).sort()).toEqual([
      LIST_KNOWLEDGE_SOURCES_TOOL_NAME,
      SEARCH_KNOWLEDGE_TOOL_NAME,
    ]);
    expect(
      registered.every(
        (entry) =>
          entry.options.isLocal === false &&
          entry.options.network?.[0] === KNOWLEDGE_NETWORK_HOST &&
          entry.options.description?.includes("MongoDB Assistant knowledge base"),
      ),
    ).toBe(true);
  });

  it("keeps the package search schema", () => {
    const schema = knowledgeTool(SEARCH_KNOWLEDGE_TOOL_NAME).schema;

    expect(schema.safeParse({}).success).toBe(false);
    expect(schema.safeParse({ query: "x" }).success).toBe(true);
    expect(schema.parse({ query: "x" }).limit).toBe(5);
    expect(schema.safeParse({ query: "x", limit: 1 }).success).toBe(true);
    expect(
      schema.safeParse({
        query: "x",
        dataSources: [{ name: "node-driver" }],
      }).success,
    ).toBe(true);
  });

  const invalidArguments = [
    {},
    { query: 123 },
    { query: "test", limit: -1 },
    { query: "test", limit: 101 },
    { query: "test", dataSources: "invalid" },
    { query: "test", dataSources: [{ name: 123 }] },
    { query: "test", dataSources: [{}] },
  ] as unknown[];

  it.each(invalidArguments)("rejects invalid search arguments %j", (args) => {
    expect(
      knowledgeTool(SEARCH_KNOWLEDGE_TOOL_NAME).schema.safeParse(args).success,
    ).toBe(false);
  });

  it("joins MCP text content from the packaged tool", async () => {
    vi.spyOn(AssistantToolBase.prototype, "invoke").mockResolvedValue({
      content: [
        {
          type: "text",
          text: "Found 2 results in the MongoDB Assistant knowledge base.",
        },
        {
          type: "text",
          text: "<untrusted-user-data-abc>\ntitle: Aggregation\n</untrusted-user-data-abc>",
        },
      ],
    });

    const text = await knowledgeTool(SEARCH_KNOWLEDGE_TOOL_NAME).invoke({
      query: "aggregation pipeline",
    });

    expect(text).toContain(
      "Found 2 results in the MongoDB Assistant knowledge base.",
    );
    expect(text).toContain("title: Aggregation");
  });

  it("throws when the packaged tool reports an error", async () => {
    vi.spyOn(AssistantToolBase.prototype, "invoke").mockResolvedValue({
      content: [
        {
          type: "text",
          text: "Failed to search knowledge base: Not Found",
        },
      ],
      isError: true,
    });

    await expect(
      knowledgeTool(SEARCH_KNOWLEDGE_TOOL_NAME).invoke({ query: "test query" }),
    ).rejects.toThrow("Failed to search knowledge base: Not Found");
  });

  it("throws when the packaged tool throws", async () => {
    vi.spyOn(AssistantToolBase.prototype, "invoke").mockRejectedValue(
      new Error("Connection timeout"),
    );

    await expect(
      knowledgeTool(LIST_KNOWLEDGE_SOURCES_TOOL_NAME).invoke(),
    ).rejects.toThrow("Connection timeout");
  });
});
