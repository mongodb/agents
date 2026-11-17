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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setKnowledgeFetch } from "../tests/support/knowledgeFetchStub.js";

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

const fetchMock = vi.fn();

function jsonResponse(
  body: unknown,
  init: { ok?: boolean; statusText?: string } = {},
): {
  ok: boolean;
  statusText: string;
  json: () => Promise<unknown>;
} {
  return {
    ok: init.ok ?? true,
    statusText: init.statusText ?? "OK",
    json: async () => body,
  };
}

describe("knowledge tool wrapper", () => {
  beforeEach(() => {
    setKnowledgeFetch(fetchMock);
  });

  afterEach(() => {
    fetchMock.mockReset();
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
    expect(
      registered.find(
        (entry) => entry.options.name === LIST_KNOWLEDGE_SOURCES_TOOL_NAME,
      )?.options.description,
    ).toContain(SEARCH_KNOWLEDGE_TOOL_NAME);
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

  it("posts the search query through the packaged tool", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        results: [
          {
            url: "https://www.mongodb.com/docs/aggregation",
            title: "Aggregation",
            text: "pipeline",
            metadata: { tags: [] },
          },
        ],
      }),
    );

    const text = await knowledgeTool(SEARCH_KNOWLEDGE_TOOL_NAME).invoke({
      query: "aggregation pipeline",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, request] = fetchMock.mock.calls[0] as [
      URL,
      { method?: string; headers?: Headers; body?: string },
    ];
    expect(String(url)).toBe(
      "https://knowledge.mongodb.com/api/v1/content/search",
    );
    expect(request.method).toBe("POST");
    expect(request.headers?.get("content-type")).toBe("application/json");
    expect(JSON.parse(request.body ?? "")).toEqual({
      query: "aggregation pipeline",
      limit: 5,
    });
    expect(text).toContain(
      "Found 1 results in the MongoDB Assistant knowledge base.",
    );
    expect(text).toContain("title: Aggregation");
  });

  it("lists knowledge sources through the packaged tool", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        dataSources: [
          {
            id: "docs",
            type: "docs",
            versions: [{ label: "8.0", isCurrent: true }],
          },
        ],
      }),
    );

    const text = await knowledgeTool(LIST_KNOWLEDGE_SOURCES_TOOL_NAME).invoke();

    const [url, request] = fetchMock.mock.calls[0] as [
      URL,
      { method?: string },
    ];
    expect(String(url)).toBe(
      "https://knowledge.mongodb.com/api/v1/content/sources",
    );
    expect(request.method).toBe("GET");
    expect(text).toContain(
      "Found 1 data sources in the MongoDB Assistant knowledge base.",
    );
    expect(text).toContain('currentVersion: "8.0"');
  });

  it("throws when the knowledge API returns an error", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({}, { ok: false, statusText: "Not Found" }),
    );

    await expect(
      knowledgeTool(SEARCH_KNOWLEDGE_TOOL_NAME).invoke({ query: "test query" }),
    ).rejects.toThrow("Failed to search knowledge base: Not Found");
  });

  it("throws when the knowledge API request fails", async () => {
    fetchMock.mockRejectedValue(new Error("Connection timeout"));

    await expect(
      knowledgeTool(LIST_KNOWLEDGE_SOURCES_TOOL_NAME).invoke(),
    ).rejects.toThrow("Connection timeout");
  });
});
