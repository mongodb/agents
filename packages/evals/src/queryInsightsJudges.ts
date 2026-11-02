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

import type {
  ConversationEvalCaseExpectedWithCustom,
  ConversationEvalScorer,
} from "mongodb-assistant-eval/eval";
import type { JudgeModelConfig } from "mongodb-assistant-eval/scorers";

import type { CustomExpected } from "./schemas.js";
import type { AgentTaskInput, AgentTaskOutput } from "./task.js";

type Expected = ConversationEvalCaseExpectedWithCustom<CustomExpected>;
type Scorer = ConversationEvalScorer<AgentTaskInput, AgentTaskOutput, Expected>;

const SELECT_CHOICE = "select_choice";

export interface Verdict {
  readonly choice: string;
  readonly rationale: string;
}

/**
 * Asks the judge model to pick one of `choices` for `prompt`, by calling a
 * tool whose schema allows only those choices. The rationale comes first in
 * the schema so the model reasons before it answers. Throws when the model
 * returns no verdict or one outside the choices, so a judge failure is not
 * scored as a 0.
 */
export async function judgeChoice(
  judge: JudgeModelConfig,
  prompt: string,
  choices: readonly string[],
): Promise<Verdict> {
  const response = await judge.client.chat.completions.create({
    model: judge.modelId,
    messages: [{ role: "user", content: prompt }],
    tools: [
      {
        type: "function",
        function: {
          name: SELECT_CHOICE,
          description: "Records the judge's verdict.",
          strict: true,
          parameters: {
            type: "object",
            properties: {
              rationale: {
                type: "string",
                description: "Step-by-step justification for the choice, written first.",
              },
              choice: { type: "string", enum: [...choices] },
            },
            required: ["rationale", "choice"],
            additionalProperties: false,
          },
        },
      },
    ],
    tool_choice: { type: "function", function: { name: SELECT_CHOICE } },
  });
  const call = response.choices[0]?.message.tool_calls?.[0];
  if (!call || call.type !== "function") {
    throw new Error("The judge returned no verdict");
  }
  const verdict = JSON.parse(call.function.arguments) as Partial<Verdict>;
  if (typeof verdict.choice !== "string" || !choices.includes(verdict.choice)) {
    throw new Error(`The judge returned an unknown choice: ${String(verdict.choice)}`);
  }
  return { choice: verdict.choice, rationale: String(verdict.rationale ?? "") };
}

function userRequest(input: AgentTaskInput): string {
  return input.messages.map((m) => m.content).join("\n\n");
}

/** Every tool result the agent saw, in order, named by tool. */
function toolOutputs(output: AgentTaskOutput): string {
  const results = output.messages.filter((m) => m.role === "tool");
  if (!results.length) return "(The agent called no tools.)";
  return results
    .map((m) => `[${("name" in m && m.name) || "tool"}]\n${String(m.content ?? "")}`)
    .join("\n\n");
}

const FACTUALITY_SCORES: Readonly<Record<string, number>> = {
  "1.0": 1,
  "0.75": 0.75,
  "0.5": 0.5,
  "0.25": 0.25,
  "0.0": 0,
};

const FACTUALITY_RUBRIC = `You are grading a MongoDB query performance report for factual accuracy.

The Tool Output is ground truth. It holds the Performance Advisor's suggested indexes (## Suggested Indexes) and a sample of recent slow query logs (## Slow Query Logs). Each slow-log line describes one execution: docsExamined, nreturned, keysExamined and millis are values for that execution, not totals across executions. A number that is restated in words or with thousands separators is still accurate. Ignore style, grammar and formatting. Judge factual accuracy only.

Semantics to apply:
- planSummary COLLSCAN means the query did not use an index. A plan that includes IXSCAN, IDHACK, COUNT_SCAN, DISTINCT_SCAN, EXPRESS_IXSCAN or CLUSTERED_IXSCAN means an index was used.
- hasSortStage: true means the sort ran in memory, not from index order. It can appear with an index scan: an index can serve the filter while the sort still runs in memory.
- A suggested index applies to a slow log only when its namespace matches the log's namespace.
- Query values printed as placeholders (?string, ?number, ?bool) are unknown values. Writing them as "<specified string>" and so on is accurate.

Judge claims at the strength they are asserted. Hedged words ("may", "might", "could", "suggests", "likely") make a weaker claim. Do not mark a hedged claim as a false implication unless even the hedged claim does not follow from its premise.

Select one score:
1.0: No factual issues. Every claim is grounded in the Tool Output and MongoDB behavior, metrics are used correctly, and nothing is fabricated.
0.75: Substantively accurate. At most one claim is vague or slightly under-supported, and nothing is wrong or fabricated.
0.5: One or more claims misuse a metric (criterion 2), are unsupported, or draw a false implication (criterion 5). Nothing is fabricated and nothing contradicts the Tool Output.
0.25: A claim contradicts the Tool Output (criterion 1), cites a metric value or name that is not in it (criterion 3), or asserts a fabricated fact or one that contradicts MongoDB documentation (criterion 4). A report with any contradiction of the Tool Output cannot score above 0.25.
0.0: The report is fundamentally unreliable: several fabrications or contradictions dominate it.

Deduction criteria. Cite the one that drives your score, or "unlisted":
1. (CONTRADICTS_INPUT) A claim contradicts a fact in the Tool Output, such as the plan, a printed metric, or a suggested index. This caps the score at 0.25.
2. (METRIC_MISUSE) A claim misreads a metric, attributes it to the wrong quantity, or compares metrics in a way that is not valid, such as treating one execution's values as lifetime totals.
3. (HALLUCINATED_METRIC) A claim cites a metric value or name that does not appear in the Tool Output, including a computed total, ratio or percentage.
4. (HALLUCINATED_FACT) A claim asserts a fact not grounded in the Tool Output, such as an index the Performance Advisor did not suggest, or a fact that contradicts MongoDB documentation.
5. (FALSE_IMPLICATION) A claim draws a conclusion that does not follow from its true premise.

Keep the rationale brief: state only the penalties applied and the criterion number (or "unlisted") for each. If the score is 1.0, write "No penalties."`;

const COVERAGE_SCORES: Readonly<Record<string, number>> = {
  EQUIVALENT: 1,
  MOSTLY_ALIGNED: 0.75,
  PARTIALLY_ALIGNED: 0.5,
  BARELY_ALIGNED: 0.25,
  UNRELATED: 0,
};

const COVERAGE_RUBRIC = `You are comparing a MongoDB query performance report with an expert reference analysis of the same query.

Judge how closely the report matches the reference in coverage and emphasis: does it name the same causes and recommendations, and prioritize them the same way? Ignore wording, style and formatting, and ignore numbers the report cites that the reference does not. Do not judge factual correctness. The User Request is context only.

Select one option:
(EQUIVALENT) The same observations with the same emphasis and priorities.
(MOSTLY_ALIGNED) Small omissions or harmless extras. The core observations match, with at most minor differences in emphasis.
(PARTIALLY_ALIGNED) Covers some key reference observations but misses, dilutes or substantially reorders others.
(BARELY_ALIGNED) Mostly different content with minor overlap.
(UNRELATED) A different analysis entirely.`;

/**
 * The two LLM judges for Query Insights reports, adapted from the rubrics of
 * the source query insights evals (a factuality rubric and a reference
 * similarity rubric). They run as separate calls with separate
 * rubrics, so they cross-check each other.
 *
 * - `ReportFactuality`: is the report grounded in the tool output, with no
 *   contradiction or invented fact. Runs on cases with
 *   `expected.custom.queryInsights`.
 * - `ReferenceCoverage`: does the report cover the causes and
 *   recommendations of `expected.custom.queryInsights.reference`, with
 *   similar emphasis. Runs on cases that have a reference.
 *
 * Each records the judge's choice and rationale in its metadata.
 */
export function makeQueryInsightsJudges(judge: JudgeModelConfig): {
  ReportFactuality: Scorer;
  ReferenceCoverage: Scorer;
} {
  const ReportFactuality: Scorer = async ({ input, output, expected }) => {
    const name = "ReportFactuality";
    if (!expected.custom?.queryInsights) return { name, score: null };
    const prompt = `[User Request]
${userRequest(input)}

[Tool Output]
${toolOutputs(output)}

[Report]
${output.assistantMessageContent}

${FACTUALITY_RUBRIC}`;
    const verdict = await judgeChoice(judge, prompt, Object.keys(FACTUALITY_SCORES));
    return { name, score: FACTUALITY_SCORES[verdict.choice], metadata: { ...verdict } };
  };

  const ReferenceCoverage: Scorer = async ({ input, output, expected }) => {
    const name = "ReferenceCoverage";
    const reference = expected.custom?.queryInsights?.reference;
    if (!reference) return { name, score: null };
    const prompt = `[User Request]
${userRequest(input)}

[Expert Reference]
${reference}

[Report]
${output.assistantMessageContent}

${COVERAGE_RUBRIC}`;
    const verdict = await judgeChoice(judge, prompt, Object.keys(COVERAGE_SCORES));
    return { name, score: COVERAGE_SCORES[verdict.choice], metadata: { ...verdict } };
  };

  return { ReportFactuality, ReferenceCoverage };
}
