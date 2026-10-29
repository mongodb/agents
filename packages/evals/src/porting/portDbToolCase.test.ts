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
import { parse } from "yaml";

import { parseAgentCases } from "../cases.js";
import { renderPortedCases } from "./portAssistantCase.js";
import { portDbToolCase } from "./portDbToolCase.js";

const LIST_DATABASES = parse(`
name: list_databases_available
description: should call list-databases to enumerate the available databases
input:
  messages:
    - { role: user, content: What databases are available on this deployment? }
  custom:
    customData: { databaseName: sample_mflix }
tags: [mcp_db_read_only, list-databases, single-tool]
expected:
  outputMessages:
    - { role: user }
    - role: assistant-tool
      toolCalls: [{ name: list-databases }]
    - { role: tool }
    - { role: assistant }
ci: true
`);

const FIND_BY_YEAR = parse(`
name: find_movies_by_year
input:
  messages:
    - { role: user, content: Find the movies in my database that were released in 1999. }
  custom:
    customData: { databaseName: sample_mflix, collectionName: movies }
tags: [mcp_db_read_only, find, single-tool]
expected:
  outputMessages:
    - { role: user }
    - role: assistant-tool
      toolCalls:
        - name: find
          arguments:
            - { name: database, type: string, value: sample_mflix }
            - { name: filter, type: object, size: { gte: 1 } }
    - { role: assistant }
ci: true
`);

const SCHEMA_THEN_FIND = parse(`
name: schema_then_find_movies
description: Custom tools are client-executed, so generation stops at the first tool turn.
input:
  messages:
    - { role: user, content: First show me the schema of movies, then find a couple of documents. }
  custom:
    customData: { databaseName: sample_mflix, collectionName: movies }
expected:
  outputMessages:
    - { role: user }
    - role: assistant-tool
      toolCalls:
        - { name: collection-schema }
        - { name: find }
    - { role: assistant }
`);

describe("portDbToolCase", () => {
  it("renames the tool and keeps the question, tags and default data", () => {
    const ported = portDbToolCase(LIST_DATABASES);

    expect(ported).toMatchObject({
      name: "list_databases_available",
      description:
        "should call list-databases to enumerate the available databases",
      tags: ["list-databases", "single-tool"],
      input: {
        messages: [
          {
            role: "user",
            content: "What databases are available on this deployment?",
          },
        ],
        custom: { defaultData: { databaseName: "sample_mflix" } },
      },
    });
    expect(ported.expected.outputMessages).toEqual([
      { role: "user" },
      {
        role: "assistant-tool",
        toolCalls: [{ name: "mongodb__list_databases" }],
      },
      { role: "tool" },
      { role: "assistant" },
    ]);
  });

  it("reads the sample-mflix fixture and runs in read-only mode", () => {
    const { custom } = portDbToolCase(FIND_BY_YEAR).input;

    expect(custom.toolSetup).toEqual({ localMongo: "sample-mflix" });
    expect(custom).not.toHaveProperty("allowWrites");
  });

  it("keeps expected arguments, including size constraints", () => {
    const [, toolMessage] = portDbToolCase(FIND_BY_YEAR).expected
      .outputMessages as { toolCalls: unknown[] }[];

    expect(toolMessage.toolCalls).toEqual([
      {
        name: "mongodb__find",
        arguments: [
          { name: "database", type: "string", value: "sample_mflix" },
          { name: "filter", type: "object", size: { gte: 1 } },
        ],
      },
    ]);
  });

  it("keeps two calls in one turn in order, and adds the missing tool result", () => {
    const messages = portDbToolCase(SCHEMA_THEN_FIND).expected
      .outputMessages as { role: string; toolCalls?: { name: string }[] }[];

    expect(messages.map((m) => m.role)).toEqual([
      "user",
      "assistant-tool",
      "tool",
      "assistant",
    ]);
    expect(messages[1].toolCalls?.map((c) => c.name)).toEqual([
      "mongodb__collection_schema",
      "mongodb__find",
    ]);
  });

  it("produces cases the loader accepts", () => {
    const yaml = renderPortedCases(
      [LIST_DATABASES, FIND_BY_YEAR, SCHEMA_THEN_FIND].map((source) => ({
        file: "mongodb_mcp_tools_db_read_only.yml",
        case: portDbToolCase(source),
      })),
      "Adapted from ai-assistant.",
    );

    const cases = parseAgentCases(yaml, "ported");

    expect(cases.map((c) => c.name)).toEqual([
      "list_databases_available",
      "find_movies_by_year",
      "schema_then_find_movies",
    ]);
  });

  it.each([
    [
      "a case that expects no tool call",
      {
        ...LIST_DATABASES,
        expected: { outputMessages: [{ role: "user" }, { role: "assistant" }] },
      },
      /expects no tool call, which needs a hand port/,
    ],
    [
      "a tool the agents do not expose",
      {
        ...LIST_DATABASES,
        expected: {
          outputMessages: [
            { role: "assistant-tool", toolCalls: [{ name: "connect" }] },
          ],
        },
      },
      /expects tool "connect", which needs a hand port/,
    ],
    [
      "a custom system prompt",
      {
        ...LIST_DATABASES,
        input: {
          ...LIST_DATABASES.input,
          custom: { customSystemPrompt: "Be a pirate." },
        },
      },
      /input\.custom\.customSystemPrompt has no counterpart/,
    ],
    [
      "more than one message",
      {
        ...LIST_DATABASES,
        input: {
          messages: [
            { role: "user", content: "a" },
            { role: "assistant", content: "b" },
            { role: "user", content: "c" },
          ],
        },
      },
      /single-message/,
    ],
  ])("refuses %s", (_label, source, message) => {
    expect(() => portDbToolCase(source)).toThrow(message);
  });
});
