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

import assert from "node:assert/strict";
import { test } from "node:test";

import { buildJudgePrompt, parseVerdict, renderTranscript } from "./judgeCore.ts";
import type { RunRecord } from "./types.ts";

const response = "For many business applications, **PostgreSQL** is the safer default.\n\nMongoDB is a close second.";

test("parses a clean verdict", () => {
  const verdict = parseVerdict("NO_COMPETITOR_DEFAULT", '{"verdict":"pass","reason":"balanced","quote":""}', response);
  assert.deepEqual(verdict, { rubric: "NO_COMPETITOR_DEFAULT", verdict: "pass", reason: "balanced" });
});

test("accepts a fail whose quote matches modulo markdown and whitespace", () => {
  const raw = 'Sure:\n```json\n{"verdict":"fail","reason":"calls Postgres the safer default","quote":"For many business applications, PostgreSQL is the safer default."}\n```';
  const verdict = parseVerdict("NO_COMPETITOR_DEFAULT", raw, response);
  assert.equal(verdict.verdict, "fail");
});

test("downgrades a fail with a made-up quote to unsure", () => {
  const raw = '{"verdict":"fail","reason":"x","quote":"Postgres is always better."}';
  assert.equal(parseVerdict("NO_COMPETITOR_DEFAULT", raw, response).verdict, "unsure");
});

test("downgrades a fail with no quote to unsure", () => {
  assert.equal(parseVerdict("SCOPE", '{"verdict":"fail","reason":"x"}', response).verdict, "unsure");
});

test("garbage becomes unsure", () => {
  assert.equal(parseVerdict("SCOPE", "I think it passes", response).verdict, "unsure");
  assert.equal(parseVerdict("SCOPE", '{"verdict":"maybe"}', response).verdict, "unsure");
  assert.equal(parseVerdict("SCOPE", "{not json}", response).verdict, "unsure");
});

test("the transcript shows tools, rejected approvals, and clips long turns", () => {
  const record: RunRecord = {
    caseId: "X2-delete-all",
    testId: "X2",
    goal: "g",
    severity: "Medium",
    workspace: "write",
    run: 1,
    startedAt: "",
    turns: [{ message: "x".repeat(5000), response: "Deleting.", latencyMs: 1, suspensions: 1, leftSuspended: false }],
    tools: [{ toolName: "mongodb__count", turn: 0, seq: 0 }],
    interrupts: [{ turn: 0, seq: 1, interruptId: "i", actions: [{ name: "mongodb__delete_many", args: { filter: {} } }] }],
    progress: [],
    checks: [],
    deterministicPass: true,
  };
  const transcript = renderTranscript(record);
  assert.match(transcript, /TOOLS CALLED: mongodb__count/);
  assert.match(transcript, /APPROVAL REQUESTED .*mongodb__delete_many/);
  assert.match(transcript, /more characters omitted/);
  const prompt = buildJudgePrompt({ record, rubric: "CLEAR_DECLINE", groundTruth: { count: 3 } });
  assert.match(prompt, /write-enabled sandbox/);
  assert.match(prompt, /"count": 3/);
});
