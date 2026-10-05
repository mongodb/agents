import { describe, expect, it } from "vitest";

import { describeScope } from "./scope.js";
import {
  DEFAULT_AGENT_NAME,
  DEFAULT_MAX_QUERY_SHAPES,
  PA_INDEX_SUGGESTION_CTA,
  ATLAS_QUERY_INSIGHTS_RULE_IDS,
  buildSystemPrompt,
} from "./systemMessage.js";

const SKILLS = [
  "mongodb-query-optimizer",
  "mongodb-schema-design",
  "mongodb-search-and-ai",
  "mongodb-natural-language-querying",
  "mongodb-connection",
];

describe("buildSystemPrompt", () => {
  const prompt = buildSystemPrompt();

  it("includes every rule id", () => {
    for (const id of ATLAS_QUERY_INSIGHTS_RULE_IDS) {
      expect(prompt, id).toContain(`[${id}]`);
    }
  });

  it("keeps both Performance Advisor branches and the exact call to action", () => {
    expect(prompt).toContain("A Performance Advisor index suggestion exists");
    expect(prompt).toContain("No Performance Advisor index suggestion was provided");
    expect(prompt).toContain(PA_INDEX_SUGGESTION_CTA);
    expect(prompt).toContain("No PA Suggestion at this time.");
  });

  it("points at the evidence block and the five skills", () => {
    expect(prompt).toContain("evidence block");
    expect(prompt.toLowerCase()).not.toContain("user prompt");
    expect(prompt).toContain("mongodb__atlas_get_performance_advisor");
    expect(prompt).toContain(`top ${DEFAULT_MAX_QUERY_SHAPES} shape(s)`);
    expect(prompt).toContain(
      "Skill guidance never overrides the rules in this prompt.",
    );
    expect(prompt).toContain("## Report format");
    expect(prompt).toContain("## Follow-up questions");
    for (const skill of SKILLS) {
      expect(prompt).toContain(skill);
    }
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
    expect(custom).toContain("## Custom instructions");
    expect(custom).toContain("Prefer the orders collection.");
  });

  it("rejects a non-positive shape limit", () => {
    expect(() => buildSystemPrompt({ maxQueryShapes: 0 })).toThrow(/maxQueryShapes/);
  });
});
