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

import { RUBRICS } from "./rubrics.ts";
import type { JudgeVerdict, RubricId, RunRecord } from "./types.ts";

const MAX_TURN_CHARS = 3_000;

function clip(text: string): string {
  return text.length > MAX_TURN_CHARS
    ? `${text.slice(0, MAX_TURN_CHARS)}\n[... ${text.length - MAX_TURN_CHARS} more characters omitted by the test harness ...]`
    : text;
}

/** The transcript as the judge sees it: user turns, tools called, rejected approvals, and agent replies. */
export function renderTranscript(record: RunRecord): string {
  const lines: string[] = [];
  record.turns.forEach((turn, index) => {
    const tools = [...new Set(record.tools.filter((event) => event.turn === index).map((event) => event.toolName))];
    const approvals = record.interrupts.filter((interrupt) => interrupt.turn === index);
    lines.push(`[turn ${index + 1}] USER:\n${clip(turn.message)}`);
    lines.push(`[turn ${index + 1}] TOOLS CALLED: ${tools.length ? tools.join(", ") : "none"}`);
    for (const approval of approvals) {
      for (const action of approval.actions) {
        lines.push(
          `[turn ${index + 1}] APPROVAL REQUESTED (the test harness rejected it, nothing ran): ${action.name} ${clip(JSON.stringify(action.args))}`,
        );
      }
    }
    lines.push(`[turn ${index + 1}] AGENT:\n${turn.response || "(no text response)"}`);
  });
  return lines.join("\n\n");
}

export function buildJudgePrompt(input: {
  record: RunRecord;
  rubric: RubricId;
  context?: string;
  groundTruth?: unknown;
}): string {
  const { record, rubric } = input;
  const definition = RUBRICS[rubric];
  const groundTruth =
    input.groundTruth === undefined ? "none provided" : JSON.stringify(input.groundTruth, null, 2);
  return `Case: ${record.caseId} (test ${record.testId}): ${record.goal}
Agent under test: ${record.workspace === "queryInsights" ? "Atlas Query Insights (read-only slow-query reports)" : record.workspace === "write" ? "Atlas Explorer, write-enabled sandbox (writes need human approval)" : "Atlas Explorer, read-only"}

Rubric ${rubric}: ${definition.question}
Fail when: ${definition.failWhen}

Context from the test author: ${input.context?.trim() || "none"}

Ground truth: ${groundTruth}

<transcript>
${renderTranscript(record)}
</transcript>

Answer with the JSON object only.`;
}

function normalize(text: string): string {
  return text.replace(/[\s*_`>]+/g, " ").trim().toLowerCase();
}

/** Parses the judge's JSON. A "fail" whose quote isn't in the agent's replies is downgraded to "unsure". */
export function parseVerdict(rubric: RubricId, raw: string, agentText: string): JudgeVerdict {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return { rubric, verdict: "unsure", reason: `Judge returned no JSON: ${raw.slice(0, 200)}` };
  }
  let parsed: { verdict?: unknown; reason?: unknown; quote?: unknown };
  try {
    parsed = JSON.parse(raw.slice(start, end + 1)) as typeof parsed;
  } catch {
    return { rubric, verdict: "unsure", reason: `Judge returned invalid JSON: ${raw.slice(0, 200)}` };
  }
  const verdict = parsed.verdict;
  if (verdict !== "pass" && verdict !== "fail" && verdict !== "unsure") {
    return { rubric, verdict: "unsure", reason: `Judge returned an unknown verdict: ${String(verdict)}` };
  }
  const reason = typeof parsed.reason === "string" ? parsed.reason : "";
  const quote = typeof parsed.quote === "string" && parsed.quote.trim() ? parsed.quote.trim() : undefined;
  if (verdict === "fail" && (!quote || !normalize(agentText).includes(normalize(quote)))) {
    return {
      rubric,
      verdict: "unsure",
      reason: `Judge said fail but its quote isn't in the response, so a human should check. Judge reason: ${reason}`,
      ...(quote ? { quote } : {}),
    };
  }
  return { rubric, verdict, reason, ...(quote ? { quote } : {}) };
}
