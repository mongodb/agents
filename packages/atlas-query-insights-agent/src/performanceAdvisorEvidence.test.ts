import { readFileSync } from "node:fs";

import { ToolMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";

import {
  PERFORMANCE_ADVISOR_TOOL,
  annotatePerformanceAdvisorCall,
  annotatePerformanceAdvisorMiddleware,
  buildPerformanceAdvisorEvidence,
} from "./performanceAdvisorEvidence.js";

const sample = JSON.parse(
  readFileSync(
    new URL("../fixtures/atlasPerformanceAdvisor.json", import.meta.url),
    "utf8",
  ),
) as { slowQueryLogs: unknown; suggestedIndexes: unknown };

const LEGACY_LINE =
  '2026-05-06T10:23:45.447+0000 I COMMAND [conn10614] command mydb.orders appName: "MongoDB Shell" command: find { find: "orders", filter: { status: "pending", customerId: 12345 }, sort: { createdAt: -1 } } planSummary: COLLSCAN keysExamined:0 docsExamined:50000 nreturned:100 executionTimeMillis:1247';

function section(evidence: string, heading: string): string {
  const start = evidence.indexOf(heading);
  expect(start).toBeGreaterThanOrEqual(0);
  const next = evidence.indexOf("\n## ", start + heading.length);
  return evidence.slice(start, next === -1 ? undefined : next);
}

describe("buildPerformanceAdvisorEvidence", () => {
  const evidence = buildPerformanceAdvisorEvidence(sample);

  it("groups a namespace and redacts literals before formatting ratios", () => {
    expect(evidence).not.toBeNull();
    const text = evidence ?? "";
    expect(text).toContain("sample of at most 50 recent log lines");
    expect(text).toContain("not a `$queryStats` aggregate");
    expect(text).toContain("3 log line(s) and 2 query shape(s)");
    expect(text).not.toContain("archived");
    expect(text).not.toContain("session");

    const firstShape = text.slice(0, text.indexOf("Shape 2 of 2"));
    expect(firstShape).toContain("namespace: highImpact.dbA");
    expect(firstShape).toContain('"?string"');
    expect(firstShape).toContain("- Command: find");
    expect(firstShape).toContain("- Execution count: 2");
    expect(firstShape).toContain("- Docs examined: 4.01 k");
    expect(firstShape).toContain("- Docs returned: 10");
    expect(firstShape).toContain("- Docs examined:returned ratio: 401.00");
    expect(firstShape).toContain("- Avg working time: 450 ms");
    expect(firstShape).toContain("- Last execution time: 500 ms");
    expect(firstShape).toContain("- Has sort stage: false");
    expect(firstShape).toContain("- Uses index: false");
    expect(firstShape).toContain("- numYields: 3");
    expect(section(firstShape, "## Performance Advisor Suggestion")).toContain(
      '{"status":1}',
    );
    expect(firstShape).not.toContain("unusedField");
  });

  it("marks an index scan with a sort and keeps the suggestion collation", () => {
    const text = evidence ?? "";
    const secondShape = text.slice(text.indexOf("Shape 2 of 2"));
    expect(secondShape).toContain("namespace: highImpact.dbB");
    expect(secondShape).toContain('"createdAt":-1');
    expect(secondShape).toContain("- Has sort stage: true");
    expect(secondShape).toContain("- Uses index: true");
    expect(secondShape).toContain('{"type":1,"createdAt":-1}');
    expect(secondShape).toContain('Collation: {"locale":"en"}');
  });

  it("reads the markdown text the MCP tool returns", () => {
    const markdown = [
      "## Suggested Indexes",
      'Note: The "Weight" field is measured in bytes.',
      JSON.stringify(sample.suggestedIndexes),
      "",
      "## Slow Query Logs",
      "Please notify the user that the MCP server tool limits slow query logs.",
      JSON.stringify(sample.slowQueryLogs),
    ].join("\n");

    expect(buildPerformanceAdvisorEvidence(markdown)).toBe(evidence);
  });

  it("parses a legacy text log line", () => {
    const text = buildPerformanceAdvisorEvidence({
      slowQueryLogs: [{ namespace: "mydb.orders", line: LEGACY_LINE }],
      suggestedIndexes: [],
    });
    expect(text).toContain("namespace: mydb.orders");
    expect(text).toContain("- Docs examined: 50 k");
    expect(text).toContain("- Docs returned: 100");
    expect(text).toContain("- Uses index: false");
    expect(text).toContain("- Has sort stage: false");
    expect(text).toContain('"?string"');
    expect(text).not.toContain("pending");
    expect(text).toContain("No PA Suggestion at this time.");
  });

  it("says when the sample has no shapes", () => {
    expect(
      buildPerformanceAdvisorEvidence({ slowQueryLogs: [], suggestedIndexes: [] }),
    ).toContain("No slow query shapes were found in this sample.");
  });

  it("returns null when the result is not Performance Advisor output", () => {
    expect(buildPerformanceAdvisorEvidence("hello")).toBeNull();
    expect(
      buildPerformanceAdvisorEvidence({
        slowQueryLogs: [{ namespace: "db.coll", line: "not a slow query log" }],
      }),
    ).toBeNull();
  });
});

describe("annotatePerformanceAdvisorCall", () => {
  it("appends evidence to the Performance Advisor tool message", async () => {
    const result = await annotatePerformanceAdvisorCall(
      { toolCall: { name: PERFORMANCE_ADVISOR_TOOL } },
      async () =>
        new ToolMessage({
          content: JSON.stringify(sample),
          tool_call_id: "call-1",
          name: PERFORMANCE_ADVISOR_TOOL,
        }),
    );

    expect(result).toBeInstanceOf(ToolMessage);
    expect((result as ToolMessage).content).toContain("# Query analysis evidence");
    expect((result as ToolMessage).content).toContain("highImpact.dbA");
  });

  it("leaves other tools and error results unchanged", async () => {
    const original = new ToolMessage({
      content: "rows",
      tool_call_id: "call-2",
      name: "mongodb__find",
    });
    await expect(
      annotatePerformanceAdvisorCall(
        { toolCall: { name: "mongodb__find" } },
        async () => original,
      ),
    ).resolves.toBe(original);

    const failed = new ToolMessage({
      content: "nope",
      tool_call_id: "call-3",
      name: PERFORMANCE_ADVISOR_TOOL,
      status: "error",
    });
    await expect(
      annotatePerformanceAdvisorCall(
        { toolCall: { name: PERFORMANCE_ADVISOR_TOOL } },
        async () => failed,
      ),
    ).resolves.toBe(failed);
  });

  it("passes the original result through when parsing fails", async () => {
    const original = new ToolMessage({
      content: "not advisor output",
      tool_call_id: "call-4",
      name: PERFORMANCE_ADVISOR_TOOL,
    });
    await expect(
      annotatePerformanceAdvisorCall(
        { toolCall: { name: PERFORMANCE_ADVISOR_TOOL } },
        async () => original,
      ),
    ).resolves.toBe(original);
  });

  it("names the middleware the app wires in", () => {
    expect(annotatePerformanceAdvisorMiddleware().name).toBe(
      "annotatePerformanceAdvisor",
    );
  });
});
