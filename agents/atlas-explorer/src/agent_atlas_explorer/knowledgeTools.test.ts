import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parse as yamlParse } from "yaml";
import { ZodError } from "zod";

import {
  KNOWLEDGE_BASE_URL,
  KNOWLEDGE_NETWORK_HOST,
  LIST_KNOWLEDGE_SOURCES_DESCRIPTION,
  LIST_KNOWLEDGE_SOURCES_TOOL_NAME,
  SEARCH_KNOWLEDGE_DESCRIPTION,
  SEARCH_KNOWLEDGE_TOOL_NAME,
  listKnowledgeSources,
  listKnowledgeSourcesSchema,
  registerKnowledgeTools,
  searchKnowledge,
  searchKnowledgeSchema,
  type SearchKnowledgeArgs,
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

function getDataFromUntrustedContent(content: string): string {
  const regex =
    /^[ \t]*<untrusted-user-data-[0-9a-f\\-]*>(?<data>.*)^[ \t]*<\/untrusted-user-data-[0-9a-f\\-]*>/gms;
  const match = regex.exec(content);
  if (!match?.groups?.data) {
    throw new Error("Could not find untrusted user data in content");
  }
  return match.groups.data.trim();
}

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
    app: { tool: registerCapture as Parameters<typeof registerKnowledgeTools>[0]["tool"] },
    registered,
  };
}

function mockOkJson(payload: unknown): Response {
  return {
    ok: true,
    json: () => Promise.resolve(payload),
  } as Response;
}

function mockApiError(status: number, statusText: string): Response {
  return {
    ok: false,
    status,
    statusText,
  } as Response;
}

describe("list-knowledge-sources", () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("registers metadata for a remote Tool Pod call", () => {
    const { app, registered } = createFakeApp();
    registerKnowledgeTools(app);

    const tool = registered.find(
      (entry) => entry.options.name === LIST_KNOWLEDGE_SOURCES_TOOL_NAME,
    );
    expect(tool).toBeDefined();
    expect(tool?.options.description).toBe(LIST_KNOWLEDGE_SOURCES_DESCRIPTION);
    expect(tool?.options.isLocal).toBe(false);
    expect(tool?.options.network).toEqual([KNOWLEDGE_NETWORK_HOST]);
    expect(tool?.options.schema).toBe(listKnowledgeSourcesSchema);
  });

  describe("happy path", () => {
    it("returns list of data sources with metadata", async () => {
      const mockSources = [
        {
          id: "mongodb-manual",
          type: "documentation",
          versions: [
            { label: "7.0", isCurrent: true },
            { label: "6.0", isCurrent: false },
          ],
        },
        {
          id: "node-driver",
          type: "driver",
          versions: [
            { label: "6.0", isCurrent: true },
            { label: "5.0", isCurrent: false },
          ],
        },
      ];

      mockFetch.mockResolvedValueOnce(mockOkJson({ dataSources: mockSources }));

      const text = await listKnowledgeSources();

      expect(text).toContain(
        "Found 2 data sources in the MongoDB Assistant knowledge base.",
      );
      expect(text).toContain("<untrusted-user-data-");
      const yamlData = getDataFromUntrustedContent(text);
      const dataSources = yamlParse(yamlData) as Array<Record<string, unknown>>;

      expect(dataSources[0]).toMatchObject({
        id: "mongodb-manual",
        type: "documentation",
        currentVersion: "7.0",
        versions: [
          { label: "7.0", isCurrent: true },
          { label: "6.0", isCurrent: false },
        ],
      });
      expect(dataSources[1]).toMatchObject({
        id: "node-driver",
        type: "driver",
        currentVersion: "6.0",
        versions: [
          { label: "6.0", isCurrent: true },
          { label: "5.0", isCurrent: false },
        ],
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, init] = mockFetch.mock.calls[0] as [URL, RequestInit];
      expect(url).toBeInstanceOf(URL);
      expect(url.href).toBe(`${KNOWLEDGE_BASE_URL}content/sources`);
      expect(init.method).toBe("GET");
      expect(init.body).toBeUndefined();
      const headers = new Headers(init.headers);
      expect(headers.get("x-request-origin")).toBe("atlas-explorer");
      expect(headers.get("user-agent")).toBe("atlas-explorer");
    });

    it("handles empty data sources list", async () => {
      mockFetch.mockResolvedValueOnce(mockOkJson({ dataSources: [] }));

      const text = await listKnowledgeSources();

      expect(text).toContain(
        "Found 0 data sources in the MongoDB Assistant knowledge base.",
      );
      expect(text).toContain("<untrusted-user-data-");
    });
  });

  describe("error handling", () => {
    it("handles API error responses", async () => {
      mockFetch.mockResolvedValueOnce(
        mockApiError(500, "Internal Server Error"),
      );

      await expect(listKnowledgeSources()).rejects.toThrow(
        "Failed to list knowledge sources: Internal Server Error",
      );
    });

    it("handles network errors", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network connection failed"));

      await expect(listKnowledgeSources()).rejects.toThrow(
        "Network connection failed",
      );
    });
  });
});

describe("search-knowledge", () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("registers metadata and schema fields for a remote Tool Pod call", () => {
    const { app, registered } = createFakeApp();
    registerKnowledgeTools(app);

    const tool = registered.find(
      (entry) => entry.options.name === SEARCH_KNOWLEDGE_TOOL_NAME,
    );
    expect(tool).toBeDefined();
    expect(tool?.options.description).toBe(SEARCH_KNOWLEDGE_DESCRIPTION);
    expect(tool?.options.isLocal).toBe(false);
    expect(tool?.options.network).toEqual([KNOWLEDGE_NETWORK_HOST]);
    expect(tool?.options.schema).toBe(searchKnowledgeSchema);

    const shape = searchKnowledgeSchema.shape;
    expect(shape.query.description).toBe(
      "A natural language query to search for in the MongoDB Assistant knowledge base. This should be a single question or a topic that is relevant to the user's MongoDB use case.",
    );
    expect(shape.limit.description).toBe(
      "The maximum number of results to return",
    );
    expect(shape.dataSources.description).toContain(LIST_KNOWLEDGE_SOURCES_TOOL_NAME);

    expect(searchKnowledgeSchema.safeParse({}).success).toBe(false);
    expect(searchKnowledgeSchema.safeParse({ query: "x" }).success).toBe(true);
    expect(searchKnowledgeSchema.parse({ query: "x" }).limit).toBe(5);
    expect(
      searchKnowledgeSchema.safeParse({ query: "x", limit: 1 }).success,
    ).toBe(true);
    expect(
      searchKnowledgeSchema.safeParse({
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

  it.each(invalidArguments)(
    "rejects invalid arguments %j",
    async (args) => {
      expect(() => searchKnowledgeSchema.parse(args)).toThrow(ZodError);

      const { app, registered } = createFakeApp();
      registerKnowledgeTools(app);
      const tool = registered.find(
        (entry) => entry.options.name === SEARCH_KNOWLEDGE_TOOL_NAME,
      );
      await expect(
        (tool?.fn as (input: unknown) => Promise<string>)(args),
      ).rejects.toThrow(ZodError);
    },
  );

  describe("success cases", () => {
    it("searches with query only", async () => {
      const mockResults = [
        {
          url: "https://docs.mongodb.com/manual/aggregation/",
          title: "Aggregation Pipeline",
          text: "The aggregation pipeline is a framework for data aggregation modeled on the concept of data processing pipelines.",
          metadata: {
            tags: ["aggregation", "pipeline"],
            source: "mongodb-manual",
          },
        },
        {
          url: "https://docs.mongodb.com/manual/reference/operator/aggregation/",
          title: "Aggregation Pipeline Operators",
          text: "Aggregation pipeline operations have an array of operators available.",
          metadata: {
            tags: ["aggregation", "operators"],
            source: "mongodb-manual",
          },
        },
      ];

      mockFetch.mockResolvedValueOnce(mockOkJson({ results: mockResults }));

      const text = await searchKnowledge({ query: "aggregation pipeline" });

      expect(text).toContain(
        "Found 2 results in the MongoDB Assistant knowledge base.",
      );
      expect(text).toContain("<untrusted-user-data-");
      const yamlData = getDataFromUntrustedContent(text);
      const results = yamlParse(yamlData) as Array<Record<string, unknown>>;

      expect(results[0]).toMatchObject({
        url: "https://docs.mongodb.com/manual/aggregation/",
        title: "Aggregation Pipeline",
        text: "The aggregation pipeline is a framework for data aggregation modeled on the concept of data processing pipelines.",
        metadata: {
          tags: ["aggregation", "pipeline"],
          source: "mongodb-manual",
        },
      });
      expect(results[1]).toMatchObject({
        url: "https://docs.mongodb.com/manual/reference/operator/aggregation/",
        title: "Aggregation Pipeline Operators",
        text: "Aggregation pipeline operations have an array of operators available.",
        metadata: {
          tags: ["aggregation", "operators"],
          source: "mongodb-manual",
        },
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, init] = mockFetch.mock.calls[0] as [URL, RequestInit];
      expect(url.href).toBe(`${KNOWLEDGE_BASE_URL}content/search`);
      expect(init.method).toBe("POST");
      expect(JSON.parse(String(init.body))).toEqual({
        query: "aggregation pipeline",
        limit: 5,
      });
      const headers = new Headers(init.headers);
      expect(headers.get("x-request-origin")).toBe("atlas-explorer");
      expect(headers.get("user-agent")).toBe("atlas-explorer");
      expect(headers.get("content-type")).toBe("application/json");
    });

    it("searches with query, limit, and dataSources", async () => {
      const mockResults = [
        {
          url: "https://mongodb.github.io/node-mongodb-native/",
          title: "Node.js Driver",
          text: "The official MongoDB driver for Node.js provides a high-level API on top of mongodb-core.",
          metadata: {
            tags: ["driver", "nodejs"],
            source: "node-driver",
          },
        },
      ];

      mockFetch.mockResolvedValueOnce(mockOkJson({ results: mockResults }));

      const args: SearchKnowledgeArgs = {
        query: "node.js driver",
        limit: 1,
        dataSources: [{ name: "node-driver", versionLabel: "6.0" }],
      };
      const text = await searchKnowledge(args);

      expect(text).toContain(
        "Found 1 results in the MongoDB Assistant knowledge base.",
      );
      const yamlData = getDataFromUntrustedContent(text);
      const results = yamlParse(yamlData) as Array<Record<string, unknown>>;
      expect(results[0]).toMatchObject({
        url: "https://mongodb.github.io/node-mongodb-native/",
        title: "Node.js Driver",
        text: "The official MongoDB driver for Node.js provides a high-level API on top of mongodb-core.",
        metadata: {
          tags: ["driver", "nodejs"],
          source: "node-driver",
        },
      });

      const [, init] = mockFetch.mock.calls[0] as [URL, RequestInit];
      expect(JSON.parse(String(init.body))).toEqual({
        query: "node.js driver",
        limit: 1,
        dataSources: [{ name: "node-driver", versionLabel: "6.0" }],
      });
    });

    it("handles empty search results", async () => {
      mockFetch.mockResolvedValueOnce(mockOkJson({ results: [] }));

      const text = await searchKnowledge({ query: "nonexistent topic" });

      expect(text).toContain(
        "Found 0 results in the MongoDB Assistant knowledge base.",
      );
      expect(text).toContain("<untrusted-user-data-");
    });

    it("uses default limit when not specified", async () => {
      const mockResults = Array(5)
        .fill(null)
        .map((_, i) => ({
          url: `https://docs.mongodb.com/result${i}`,
          title: `Result ${i}`,
          text: `Search result number ${i}`,
          metadata: { tags: [`tag${i}`] },
        }));

      mockFetch.mockResolvedValueOnce(mockOkJson({ results: mockResults }));

      const text = await searchKnowledge({ query: "test query" });

      expect(text).toContain(
        "Found 5 results in the MongoDB Assistant knowledge base.",
      );
      const yamlData = getDataFromUntrustedContent(text);
      const results = yamlParse(yamlData) as unknown[];
      expect(results).toHaveLength(5);

      const [, init] = mockFetch.mock.calls[0] as [URL, RequestInit];
      expect(JSON.parse(String(init.body))).toEqual({
        query: "test query",
        limit: 5,
      });
    });
  });

  describe("error handling", () => {
    it("handles API error responses", async () => {
      mockFetch.mockResolvedValueOnce(mockApiError(404, "Not Found"));

      await expect(
        searchKnowledge({ query: "test query" }),
      ).rejects.toThrow("Failed to search knowledge base: Not Found");
    });

    it("handles network errors", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Connection timeout"));

      await expect(
        searchKnowledge({ query: "test query" }),
      ).rejects.toThrow("Connection timeout");
    });
  });
});
