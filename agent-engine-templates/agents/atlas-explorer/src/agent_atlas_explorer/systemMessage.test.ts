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
