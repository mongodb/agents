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

import { createIndexKeys, parseQueryInsightsReport } from "./queryInsightsReport.js";
import { ReportShape, SuggestedIndexUsage } from "./queryInsightsScorers.js";
import type { CustomExpected } from "./schemas.js";

type Args = Parameters<typeof ReportShape>[0];

type QueryInsightsExpected = NonNullable<CustomExpected["queryInsights"]>;
type Result = { name: string; score: number | null; metadata?: { failedChecks: string[] } };

const LOANS_INDEX: QueryInsightsExpected["suggestedIndexes"][number] = { namespace: "library.loans", index: [{ memberId: 1 }, { dueAt: -1 }] };

function args(
  text: string,
  queryInsights: QueryInsightsExpected | null = { suggestedIndexes: [LOANS_INDEX] },
): Args {
  return {
    input: { messages: [] },
    expected: { custom: queryInsights ? { queryInsights } : undefined },
    output: {
      messages: [],
      assistantMessageContent: text,
      allowedQuery: true,
      custom: { executed: [], approvalRequests: [], state: undefined, knowledgeErrors: [] },
    },
  } as unknown as Args;
}

const WITH_SUGGESTION = `Cluster0's sample of at most 50 recent slow query logs has one query shape, and I analyzed it. This is a sample, not a \`$queryStats\` aggregate.

### Shape 1: find on \`library.loans\`

This query finds loans for one member, newest due date first.

\`\`\`javascript
db.loans.find({ memberId: "<specified string>" }).sort({ dueAt: -1 })
\`\`\`

Areas worth investigating

1. **The Performance Advisor recommends an index on \`memberId\` and \`dueAt\`.** The \`planSummary\` is COLLSCAN, so the query did not use an index.

   \`\`\`javascript
   db.loans.createIndex({ memberId: 1, dueAt: -1 })
   \`\`\`

   This command has not been run.
2. **The sort runs in memory.** An index that matches the sort avoids it.
`;

const WITHOUT_SUGGESTION = `Cluster0's sample has one shape.

### Shape 1: find on library.loans

Finds loans for one member.

\`\`\`javascript
db.loans.find({ memberId: "<specified string>" })
\`\`\`

#### Areas worth investigating

1. **The query examines many documents.** The \`docsExamined\` is far above \`nreturned\`.
`;

const reportShape = (a: Args) => ReportShape(a) as Result;
const suggestedIndexUsage = (a: Args) => SuggestedIndexUsage(a) as Result;

describe("parseQueryInsightsReport", () => {
  it("splits the summary, sections and areas", () => {
    const report = parseQueryInsightsReport(WITH_SUGGESTION);

    expect(report.summary).toMatch(/^Cluster0's sample/);
    expect(report.sections).toHaveLength(1);
    const [section] = report.sections;
    expect(section).toMatchObject({ rank: 1, command: "find", namespace: "library.loans" });
    expect(section.areas).toHaveLength(2);
    expect(section.areas[0]).toMatch(/^\*\*The Performance Advisor recommends/);
    expect(section.areas[0]).toContain("This command has not been run.");
    expect(section.areas[0]).not.toContain("createIndex");
  });

  it("finds no sections in text without shape headings", () => {
    expect(parseQueryInsightsReport("Your queries look fine.")).toEqual({
      summary: "Your queries look fine.",
      sections: [],
    });
  });
});

describe("createIndexKeys", () => {
  it("reads keys in order, quoted or not", () => {
    expect(
      createIndexKeys(`db.a.createIndex({ memberId: 1, "dueAt": -1 })
db.b.createIndex({'title': "text"}, { collation: { locale: "en" } })`),
    ).toEqual([[{ memberId: 1 }, { dueAt: -1 }], [{ title: "text" }]]);
  });

  it("keeps quoted field names whole", () => {
    expect(createIndexKeys(`createIndex({ "member-id": 1, 'due at': -1 })`)).toEqual([
      [{ "member-id": 1 }, { "due at": -1 }],
    ]);
  });

  it("gives an empty list for a call whose keys cannot be read", () => {
    expect(
      createIndexKeys(`db.a.createIndex(keys)
db.b.createIndex ({ memberId: 1 })
db.c.createIndex({ memberId: 1, extra: direction })`),
    ).toEqual([[], [{ memberId: 1 }], []]);
  });
});

describe("ReportShape", () => {
  it("scores 1 for a report in the prompt's layout", () => {
    expect(reportShape(args(WITH_SUGGESTION))).toEqual({
      name: "ReportShape",
      score: 1,
      metadata: { failedChecks: [] },
    });
    expect(reportShape(args(WITHOUT_SUGGESTION)).score).toBe(1);
  });

  it("names each failed check", () => {
    const threeAreas = WITHOUT_SUGGESTION.replace(
      "\n1. **The query",
      "\n1. **One.** a\n2. two\n3. **Three.** c\n4. **The query",
    ).replace("```javascript", "```js");
    const result = reportShape(args(threeAreas));

    expect(result.metadata?.failedChecks).toEqual([
      "shape 1: javascript query block",
      "shape 1: at most 2 areas",
      "shape 1: bold lead sentences",
    ]);
    expect(result.score).toBeCloseTo(4 / 7);
  });

  it("fails a section whose only javascript block is in the areas", () => {
    const noQueryBlock = WITH_SUGGESTION.replace(
      '```javascript\ndb.loans.find({ memberId: "<specified string>" }).sort({ dueAt: -1 })\n```',
      "",
    );
    expect(reportShape(args(noQueryBlock)).metadata?.failedChecks).toEqual([
      "shape 1: javascript query block",
    ]);
  });

  it("fails an unclosed bold lead", () => {
    const unclosed = WITHOUT_SUGGESTION.replace(
      "**The query examines many documents.**",
      "**The query examines many documents.",
    );
    expect(reportShape(args(unclosed)).metadata?.failedChecks).toEqual([
      "shape 1: bold lead sentences",
    ]);
  });

  it("fails JSON and text with no sections", () => {
    const json = JSON.stringify({ queryOverview: "x", areasWorthInvestigating: [] });
    expect(reportShape(args(json)).metadata?.failedChecks).toEqual([
      "at least one shape section",
      "no JSON",
    ]);
  });

  it("does not run on cases without Query Insights expectations", () => {
    expect(reportShape(args(WITH_SUGGESTION, null)).score).toBeNull();
  });
});

describe("SuggestedIndexUsage", () => {
  it("scores 1 when the suggestion leads and the createIndex matches", () => {
    expect(suggestedIndexUsage(args(WITH_SUGGESTION))).toEqual({
      name: "SuggestedIndexUsage",
      score: 1,
      metadata: { failedChecks: [] },
    });
  });

  it("fails keys in the wrong order and a suggestion that is not first", () => {
    const swapped = WITH_SUGGESTION.replace(
      "createIndex({ memberId: 1, dueAt: -1 })",
      "createIndex({ dueAt: -1, memberId: 1 })",
    ).replace("1. **The Performance", "1. **The sort.** x\n2. **The Performance");

    expect(suggestedIndexUsage(args(swapped)).metadata?.failedChecks).toEqual([
      "shape 1 (library.loans): first area is the suggestion",
      "shape 1 (library.loans): createIndex with the suggested keys",
    ]);
  });

  it("scores 1 when there is no suggestion and the report invents none", () => {
    expect(
      suggestedIndexUsage(args(WITHOUT_SUGGESTION, { suggestedIndexes: [] })).score,
    ).toBe(1);
  });

  it("fails an invented index", () => {
    const result = suggestedIndexUsage(args(WITH_SUGGESTION, { suggestedIndexes: [] }));
    expect(result.metadata?.failedChecks).toEqual([
      "shape 1 (library.loans): no Performance Advisor recommendation",
      "shape 1 (library.loans): no createIndex",
    ]);
    expect(result.score).toBe(0);
  });

  it("scores 0 when the report has no shape section", () => {
    expect(suggestedIndexUsage(args("Add an index on memberId."))).toMatchObject({
      score: 0,
      metadata: { failedChecks: ["no shape section"] },
    });
  });

  it("does not run on cases without Query Insights expectations", () => {
    expect(suggestedIndexUsage(args(WITH_SUGGESTION, null)).score).toBeNull();
  });
});
