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

import { parse } from "yaml";
import { describe, expect, it } from "vitest";

import { parseAgentCases } from "../cases.js";
import { portKnowledgeCase, renderPortedCases } from "./portAssistantCase.js";

const GENERAL = parse(`
name: Explain what a replica set is
description: |
  Explains replica sets.
tags: [web]
ci: true
input:
  messages:
    - { role: user, content: What is a replica set? }
expected:
  referenceAnswer: >
    A replica set is a group of mongod processes that keep the same data.
  links:
    - https://www.mongodb.com/docs/manual/replication/
  promptAdherence: Mentions failover.
`);

const VERSIONED = parse(`
name: new_feature_this_version
ci: true
input:
  messages:
    - { role: user, content: How do I read two collections in Spark Connector 10.3? }
expected:
  referenceAnswer: List the names, comma-separated, in the collection option.
  links: [https://www.mongodb.com/docs/spark-connector/v10.x/streaming-mode/]
  outputMessages:
    - { role: user }
    - role: assistant-tool
      toolCalls:
        - name: legacy_content_search
          arguments: [{ name: version, type: string, value: 10.x }]
    - { role: tool }
    - { role: assistant }
`);

describe("portKnowledgeCase", () => {
  it("keeps the question, reference answer and links", () => {
    const ported = portKnowledgeCase(GENERAL);
    expect(ported).toMatchObject({
      name: "Explain what a replica set is",
      description: "Explains replica sets.",
      tags: ["web"],
      input: {
        messages: [{ role: "user", content: "What is a replica set?" }],
      },
      expected: {
        referenceAnswer:
          "A replica set is a group of mongod processes that keep the same data.",
        links: ["https://www.mongodb.com/docs/manual/replication/"],
      },
    });
  });

  it("expects a name-only search_knowledge call", () => {
    expect(portKnowledgeCase(GENERAL).expected.outputMessages).toEqual([
      { role: "user" },
      { role: "assistant-tool", toolCalls: [{ name: "search_knowledge" }] },
      { role: "tool" },
      { role: "assistant" },
    ]);
  });

  it("renames the source's search tool and drops its version argument", () => {
    const ported = portKnowledgeCase(VERSIONED);
    expect(ported.expected.outputMessages).toEqual(
      portKnowledgeCase(GENERAL).expected.outputMessages,
    );
    expect(JSON.stringify(ported)).not.toContain("legacy_content_search");
    expect(JSON.stringify(ported.expected.outputMessages)).not.toContain(
      "arguments",
    );
  });

  it("drops fields the agents' suites do not score", () => {
    const ported = portKnowledgeCase(GENERAL);
    expect(ported).not.toHaveProperty("ci");
    expect(ported.expected).not.toHaveProperty("promptAdherence");
  });

  it("omits links when the source has none", () => {
    const { expected } = portKnowledgeCase({
      ...GENERAL,
      expected: { referenceAnswer: "An answer." },
    });
    expect(expected).not.toHaveProperty("links");
  });

  it.each([
    [
      "a multi-turn conversation",
      {
        ...GENERAL,
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
    [
      "a case with no reference answer",
      { ...GENERAL, expected: {} },
      /no referenceAnswer/,
    ],
    [
      "a case that expects another tool",
      {
        ...VERSIONED,
        expected: {
          ...VERSIONED.expected,
          outputMessages: [
            { role: "assistant-tool", toolCalls: [{ name: "atlas-list-clusters" }] },
          ],
        },
      },
      /"atlas-list-clusters", which needs a hand port/,
    ],
  ])("refuses %s", (_label, source, message) => {
    expect(() => portKnowledgeCase(source)).toThrow(message);
  });
});

describe("renderPortedCases", () => {
  const rendered = renderPortedCases(
    [
      { file: "conversations.yml", case: portKnowledgeCase(GENERAL) },
      {
        file: "version_q_and_a_conversations.yml",
        case: portKnowledgeCase(VERSIONED),
      },
    ],
    "Adapted from ai-assistant.\nApache-2.0.",
  );

  it("opens with the header and names each case's source", () => {
    expect(rendered.startsWith("# Adapted from ai-assistant.\n# Apache-2.0.")).toBe(
      true,
    );
    expect(rendered).toContain(
      '# Source: conversations.yml, "Explain what a replica set is"',
    );
    expect(rendered).toContain(
      '# Source: version_q_and_a_conversations.yml, "new_feature_this_version"',
    );
  });

  it("names the source case when the ported case was renamed", () => {
    const text = renderPortedCases(
      [
        {
          file: "version_q_and_a_conversations.yml",
          sourceName: "new_feature_this_version",
          case: { ...portKnowledgeCase(VERSIONED), name: "Spark 10.3 streams" },
        },
      ],
      "Header.",
    );
    expect(text).toContain(
      '# Source: version_q_and_a_conversations.yml, "new_feature_this_version"',
    );
    expect(text).toContain("- name: Spark 10.3 streams");
  });

  it("produces a dataset the case loader accepts", () => {
    const cases = parseAgentCases(rendered, "ported.yml");
    expect(cases.map((c) => c.name)).toEqual([
      "Explain what a replica set is",
      "new_feature_this_version",
    ]);
    expect(cases[0].expected.referenceAnswer).toContain("replica set");
  });
});
