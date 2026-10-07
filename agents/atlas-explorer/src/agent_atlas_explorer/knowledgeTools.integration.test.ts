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

import { describe, expect, it } from "vitest";

import {
  LIST_KNOWLEDGE_SOURCES_TOOL_NAME,
  SEARCH_KNOWLEDGE_TOOL_NAME,
  createKnowledgeTools,
} from "./knowledgeTools.js";

function knowledgeTool(name: string) {
  const tool = createKnowledgeTools().find((entry) => entry.name === name);
  if (!tool) {
    throw new Error(`missing knowledge tool ${name}`);
  }
  return tool;
}

describe("knowledge tools against knowledge.mongodb.com", () => {
  it("lists live knowledge sources", async () => {
    const text = await knowledgeTool(LIST_KNOWLEDGE_SOURCES_TOOL_NAME).invoke();

    expect(text).toMatch(
      /Found [1-9]\d* data sources in the MongoDB Assistant knowledge base\./,
    );
    expect(text).toContain("id: docs");
    expect(text).toContain("productName: MongoDB Server");
    expect(text).toMatch(/currentVersion:/);
  });

  it("searches the docs source for compound indexes", async () => {
    const text = await knowledgeTool(SEARCH_KNOWLEDGE_TOOL_NAME).invoke({
      query: "compound index",
      limit: 1,
      dataSources: [{ name: "docs" }],
    });

    expect(text).toContain(
      "Found 1 results in the MongoDB Assistant knowledge base.",
    );
    expect(text).toMatch(/<untrusted-user-data-[0-9a-f-]+>/);
    expect(text).toMatch(/url: \S*mongodb\.com\/docs\//);
    expect(text).toMatch(/^ {2}title: .+$/m);
    expect(text.toLowerCase()).toContain("compound index");
  });
});
