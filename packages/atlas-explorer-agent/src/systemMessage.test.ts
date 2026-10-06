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
  READ_ONLY_SYSTEM_PROMPT,
  WRITE_ENABLED_SYSTEM_PROMPT,
  buildSystemPrompt,
} from "./systemMessage.js";

describe("system prompt modes", () => {
  it("describes a read-only agent when writes are disabled", () => {
    const prompt = buildSystemPrompt(false);

    expect(prompt).toBe(READ_ONLY_SYSTEM_PROMPT);
    expect(prompt).toContain("You are Atlas Explorer, an AI agent");
    expect(prompt).toContain("You cannot execute write operations.");
    expect(prompt).toContain(
      "provide the exact commands, configuration, or Atlas UI steps",
    );
    expect(prompt).not.toContain("Protected mutations must go through runtime approval.");
    expect(prompt).not.toContain("## Custom instructions");
  });

  it("describes HITL-backed writes when writes are enabled", () => {
    const prompt = buildSystemPrompt(true);

    expect(prompt).toBe(WRITE_ENABLED_SYSTEM_PROMPT);
    expect(prompt).toContain("You are Atlas Explorer, an AI agent");
    expect(prompt).toContain("Protected mutations must go through runtime approval.");
    expect(prompt).toContain("emit the corresponding tool call immediately");
    expect(prompt).toContain("You cannot create Atlas database users");
    expect(prompt).toContain(
      "direct them to other Atlas interfaces like the UI, CLI, or API",
    );
    expect(prompt).toContain("mongodb__aggregate_db");
    expect(prompt).toContain("mongodb__export");
    expect(prompt).toContain("$out or $merge");
    expect(prompt).not.toContain("## Custom instructions");
  });

  it("keeps Atlas Explorer when the name is unset or whitespace", () => {
    expect(buildSystemPrompt(false, { name: "" })).toBe(READ_ONLY_SYSTEM_PROMPT);
    expect(buildSystemPrompt(false, { name: "   " })).toBe(
      READ_ONLY_SYSTEM_PROMPT,
    );
    expect(buildSystemPrompt(true, { name: "\t\n" })).toBe(
      WRITE_ENABLED_SYSTEM_PROMPT,
    );
  });

  it("uses a custom name in both read-only and write-enabled prompts", () => {
    const readOnly = buildSystemPrompt(false, { name: "Cluster Scout" });
    const writeEnabled = buildSystemPrompt(true, { name: "Cluster Scout" });

    expect(readOnly).toContain("You are Cluster Scout, an AI agent");
    expect(readOnly).not.toContain("You are Atlas Explorer, an AI agent");
    expect(readOnly).toContain("You cannot execute write operations.");
    expect(writeEnabled).toContain("You are Cluster Scout, an AI agent");
    expect(writeEnabled).not.toContain("You are Atlas Explorer, an AI agent");
    expect(writeEnabled).toContain(
      "Protected mutations must go through runtime approval.",
    );
  });

  it("appends trimmed custom instructions after the operating rules", () => {
    const prompt = buildSystemPrompt(false, {
      customInstructions: "  Prefer the staging project unless asked.  ",
    });

    expect(prompt.startsWith(READ_ONLY_SYSTEM_PROMPT)).toBe(true);
    expect(prompt).toContain(
      "## Custom instructions\n\nPrefer the staging project unless asked.\n",
    );
    expect(prompt).toContain("Never expose credentials");
  });

  it("omits custom instructions when they are whitespace", () => {
    expect(buildSystemPrompt(true, { customInstructions: " \n\t " })).toBe(
      WRITE_ENABLED_SYSTEM_PROMPT,
    );
  });
});

describe("MongoDB topic scope", () => {
  it.each([
    ["read-only", false],
    ["write-enabled", true],
  ] as const)(
    "limits the %s prompt to MongoDB and declines competitor questions",
    (_label, writeEnabled) => {
      const prompt = buildSystemPrompt(writeEnabled);

      expect(prompt).toContain(
        "Help only with MongoDB, MongoDB Atlas, and the data in the connected projects.",
      );
      expect(prompt).toContain(
        "Politely decline and redirect requests for competitor comparisons or rankings, general technology recommendations, role-play, and topics unrelated to MongoDB, MongoDB Atlas, or the connected data.",
      );
      expect(prompt).toContain("Decline competitor questions outright.");
      expect(prompt).toContain("PostgreSQL, pgvector, and Supabase");
      expect(prompt).toContain(
        "For an in-scope MongoDB or Atlas task, recommend MongoDB products: MongoDB Atlas Search for search, MongoDB Atlas Vector Search for vector retrieval, and Voyage AI for embeddings.",
      );
      expect(prompt).not.toContain(
        "Mention competitors only as conditional alternatives",
      );
      expect(prompt).not.toContain("When asked to pick a database");
    },
  );
});
