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

import { isDeepStrictEqual } from "node:util";

import type {
  ConversationEvalCaseExpectedWithCustom,
  ConversationEvalScorer,
} from "mongodb-assistant-eval/eval";

import { createIndexKeys, parseQueryInsightsReport } from "./queryInsightsReport.js";
import type { CustomExpected } from "./schemas.js";
import type { AgentTaskInput, AgentTaskOutput } from "./task.js";

type Expected = ConversationEvalCaseExpectedWithCustom<CustomExpected>;
type Scorer = ConversationEvalScorer<AgentTaskInput, AgentTaskOutput, Expected>;

const MAX_AREAS = 2;
const PA_LEAD = /^the performance advisor recommends an index on\b/i;

interface Check {
  readonly name: string;
  readonly passed: boolean;
}

/** The share of checks that passed, with the failed ones named in metadata. */
function checksScore(name: string, checks: readonly Check[]) {
  const failed = checks.filter((c) => !c.passed).map((c) => c.name);
  return {
    name,
    score: (checks.length - failed.length) / checks.length,
    metadata: { failedChecks: failed },
  };
}

/**
 * Whether the final answer has the layout the Query Insights prompt asks
 * for: a summary, then one `### Shape <n>: <command> on <namespace>` section
 * per shape, each with a `javascript` query block and at most two numbered
 * areas worth investigating, each led by a bold sentence. JSON fails.
 *
 * Scores the share of checks passed. Runs on cases with
 * `expected.custom.queryInsights`.
 */
export const ReportShape: Scorer = ({ output, expected }) => {
  if (!expected.custom?.queryInsights) return { name: "ReportShape", score: null };
  const text = output.assistantMessageContent;
  const report = parseQueryInsightsReport(text);

  const checks: Check[] = [
    { name: "summary before the first shape", passed: report.summary.length > 0 },
    { name: "at least one shape section", passed: report.sections.length > 0 },
    { name: "no JSON", passed: !/```json/i.test(text) && !isJson(text) },
  ];
  for (const section of report.sections) {
    const shape = `shape ${section.rank}`;
    checks.push(
      { name: `${shape}: javascript query block`, passed: /```javascript/.test(section.body) },
      { name: `${shape}: areas worth investigating`, passed: section.areas.length > 0 },
      { name: `${shape}: at most ${MAX_AREAS} areas`, passed: section.areas.length <= MAX_AREAS },
      {
        name: `${shape}: bold lead sentences`,
        passed: section.areas.every((area) => area.startsWith("**")),
      },
    );
  }
  return checksScore("ReportShape", checks);
};

function isJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether each shape section uses the Performance Advisor's suggested index
 * for its namespace, and invents none where there is no suggestion.
 *
 * - With a suggestion: the first area leads with "The Performance Advisor
 *   recommends an index on", and the section has a `createIndex` call with
 *   the suggested keys in order (`PA_FIRST_ITEM_RESERVED`,
 *   `PA_INDEX_SUGGESTION_CTA`).
 * - Without one: no area claims a Performance Advisor recommendation and the
 *   section has no `createIndex` call (`ALL_PA_FLAGS_OFF`).
 *
 * Scores the share of checks passed. A report with no shape section scores
 * 0. Runs on cases with `expected.custom.queryInsights`.
 */
export const SuggestedIndexUsage: Scorer = ({ output, expected }) => {
  const expectations = expected.custom?.queryInsights;
  if (!expectations) return { name: "SuggestedIndexUsage", score: null };
  const report = parseQueryInsightsReport(output.assistantMessageContent);
  if (!report.sections.length) {
    return {
      name: "SuggestedIndexUsage",
      score: 0,
      metadata: { failedChecks: ["no shape section"] },
    };
  }

  const checks: Check[] = [];
  for (const section of report.sections) {
    const shape = `shape ${section.rank} (${section.namespace})`;
    const suggestion = expectations.suggestedIndexes.find(
      (s) => s.namespace === section.namespace,
    );
    const calls = createIndexKeys(section.body);
    const leadsWithPa = (area: string | undefined) =>
      area !== undefined && PA_LEAD.test(area.replace(/\*\*/g, "").trim());
    if (suggestion) {
      checks.push(
        { name: `${shape}: first area is the suggestion`, passed: leadsWithPa(section.areas[0]) },
        {
          name: `${shape}: createIndex with the suggested keys`,
          passed: calls.some((keys) => isDeepStrictEqual(keys, suggestion.index)),
        },
      );
    } else {
      checks.push(
        {
          name: `${shape}: no Performance Advisor recommendation`,
          passed: !section.areas.some(leadsWithPa),
        },
        { name: `${shape}: no createIndex`, passed: calls.length === 0 },
      );
    }
  }
  return checksScore("SuggestedIndexUsage", checks);
};
