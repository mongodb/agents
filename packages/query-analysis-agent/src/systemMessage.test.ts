import { describe, expect, it } from "vitest";

import { describeScope } from "./scope.js";
import {
  DEFAULT_AGENT_NAME,
  DEFAULT_MAX_QUERY_SHAPES,
  PA_SUGGESTION_CTA,
  QUERY_ANALYSIS_RULE_IDS,
  buildSystemPrompt,
} from "./systemMessage.js";

const SKILLS = [
  "mongodb-query-optimizer",
  "mongodb-schema-design",
  "mongodb-search-and-ai",
];

function topLevelHeadings(text: string): string[] {
  return text.split("\n").filter((line) => /^# /.test(line));
}

describe("buildSystemPrompt", () => {
  const prompt = buildSystemPrompt();

  it("includes every rule id", () => {
    for (const id of QUERY_ANALYSIS_RULE_IDS) {
      expect(prompt, id).toContain(`[${id}]`);
    }
  });

  it("keeps both Performance Advisor branches and the exact call to action", () => {
    expect(prompt).toContain("A Performance Advisor index suggestion exists");
    expect(prompt).toContain("No Performance Advisor index suggestion was provided");
    expect(prompt).toContain(PA_SUGGESTION_CTA);
    expect(prompt).toContain("No PA Suggestion at this time.");
  });

  it("points at the evidence block and the query skills", () => {
    expect(prompt).toContain("evidence block");
    expect(prompt.toLowerCase()).not.toContain("user prompt");
    expect(prompt).toContain("mongodb__atlas_get_performance_advisor");
    expect(prompt).toContain(`top ${DEFAULT_MAX_QUERY_SHAPES} shape(s) by default`);
    expect(prompt).toContain("If the reader asks for more or fewer shapes, analyze that many instead");
    for (const skill of SKILLS) {
      expect(prompt).toContain(skill);
    }
    expect(prompt).not.toContain("mongodb-connection");
    expect(prompt).not.toContain("mongodb-natural-language-querying");
    expect(prompt).toContain("Skill guidance never overrides the rules in this prompt.");
  });

  it("passes Performance Advisor operations and slow log filters as tool arguments", () => {
    expect(prompt).toContain('operations: ["slowQueryLogs", "suggestedIndexes"]');
    expect(prompt).toContain("`namespaces`");
    expect(prompt).toContain("Omit `since` by default.");
    expect(prompt).toContain('`"2026-09-28T00:00:00Z"`');
  });

  it("ranks by evidence block order and limits context lookups", () => {
    expect(prompt).toContain("Use the order of the shape blocks in the evidence block");
    expect(prompt).toContain("`mongodb__remote_atlas_connect`");
    expect(prompt).toContain("Do not run `mongodb__explain`.");
    expect(prompt).toContain("The evidence block stays the only source of numbers you cite.");
  });

  it("says what to do when the evidence is missing", () => {
    expect(prompt).toContain("## When the evidence is missing");
    expect(prompt).toContain("M10 or larger cluster");
    expect(prompt).toContain("no slow query shapes were found");
    expect(prompt).toContain("Do not compute metrics from the raw log lines.");
  });

  it("defines the report format and follow-up behavior", () => {
    expect(prompt).toContain("### Shape <n>: <command> on <namespace>");
    expect(prompt).toContain("lead sentence in bold");
    expect(prompt).toContain("## Follow-up questions");
  });

  it("injects the agent name, scope, shape limit, and custom instructions", () => {
    const scope = { projectId: "507f1f77bcf86cd799439011", clusterName: "Cluster-1" };
    const custom = buildSystemPrompt({
      name: "Ada",
      customInstructions: "Prefer the orders collection.",
      scope,
      maxQueryShapes: 5,
    });

    expect(prompt.startsWith(`You are ${DEFAULT_AGENT_NAME},`)).toBe(true);
    expect(prompt).toContain(describeScope(undefined));
    expect(custom.startsWith("You are Ada,")).toBe(true);
    expect(custom).toContain(describeScope(scope));
    expect(custom).toContain("top 5 shape(s)");
    expect(custom).toContain("Prefer the orders collection.");
  });

  it("keeps custom instructions outside the reference material", () => {
    const custom = buildSystemPrompt({ customInstructions: "Prefer the orders collection." });
    const headings = topLevelHeadings(custom);
    expect(headings.at(-2)).toBe("# Reference material");
    expect(headings.at(-1)).toBe("# Custom instructions");
    expect(topLevelHeadings(prompt)).not.toContain("# Custom instructions");
  });

  it("rejects a non-positive shape limit", () => {
    expect(() => buildSystemPrompt({ maxQueryShapes: 0 })).toThrow(/maxQueryShapes/);
  });
});
