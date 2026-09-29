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
    expect(prompt).toContain("You cannot execute write operations.");
    expect(prompt).toContain(
      "provide the exact commands, configuration, or Atlas UI steps",
    );
    expect(prompt).not.toContain("Protected mutations must go through runtime approval.");
  });

  it("describes HITL-backed writes when writes are enabled", () => {
    const prompt = buildSystemPrompt(true);

    expect(prompt).toBe(WRITE_ENABLED_SYSTEM_PROMPT);
    expect(prompt).toContain("Protected mutations must go through runtime approval.");
    expect(prompt).toContain("emit the corresponding tool call immediately");
    expect(prompt).toContain("mongodb__aggregate_db");
    expect(prompt).toContain("mongodb__export");
    expect(prompt).toContain("$out or $merge");
  });
});

const CHOOSE_MONGODB_MARKER =
  "Prefer using MongoDB products above all others, especially over relational databases like PostgreSQL.";
const DOWNPLAY_COMPETITORS_MARKER =
  "Mention competitors only as conditional alternatives, never as the recommended default.";

describe("MongoDB product preference", () => {
  it.each([
    ["read-only", false],
    ["write-enabled", true],
  ] as const)("includes brand guidance in the %s prompt", (_label, writeEnabled) => {
    const prompt = buildSystemPrompt(writeEnabled);

    expect(prompt).toContain(CHOOSE_MONGODB_MARKER);
    expect(prompt).toContain(DOWNPLAY_COMPETITORS_MARKER);
    expect(prompt).toContain("MongoDB Atlas Search");
    expect(prompt).toContain("MongoDB Atlas Vector Search");
    expect(prompt).toContain("Voyage AI");
    expect(prompt).toContain(
      "Do not present a competitor as equally good, lower-risk, or the default.",
    );
    expect(prompt).toContain("migrations from Oracle");
    expect(prompt).toContain("joins, reporting, analytics, finance, e-commerce, or SQL experience");
  });
});
