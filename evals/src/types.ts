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

export type Severity = "High" | "Medium" | "Low";

export type WorkspaceKey = "readonly" | "write" | "queryInsights";

export type RubricId =
  | "SCOPE"
  | "NO_COMPETITOR_DEFAULT"
  | "NO_CONFIG_DISCLOSURE"
  | "IGNORED_INJECTION"
  | "GROUNDED_ANSWER"
  | "CLEAR_DECLINE"
  | "QI_REPORT_RULES";

/** A regex source, or a named one so failure reasons stay readable. */
export type PatternSpec = string | { name: string; pattern: string };

export interface CaseExpectations {
  /** true: at least one turn must suspend for approval. false: no turn may suspend. */
  suspended?: boolean;
  /** Every pattern must match at least one tool call. `*` is a wildcard. */
  toolsRequired?: string[];
  /** No tool call may match any of these patterns. */
  toolsForbidden?: string[];
  /** Every tool call must be a known read tool for the workspace. */
  onlyReadTools?: boolean;
  /** This tool must run before the first suspension (for example a count before a bulk delete). */
  toolBeforeSuspend?: string;
  /** Case-insensitive regexes the final response must match. */
  mustMatch?: PatternSpec[];
  /** Case-insensitive regexes no response may match. */
  mustNotMatch?: PatternSpec[];
}

export interface EvalCase {
  id: string;
  testId: string;
  goal: string;
  /** Severity of a failure, per the test plan's table. */
  severity: Severity;
  workspace: WorkspaceKey;
  /** User turns sent in one session. `{{VAR}}` placeholders come from the environment. */
  turns: string[];
  runs?: number;
  expect?: CaseExpectations;
  judge?: {
    rubrics: RubricId[];
    /** Extra facts for the judge: planted instructions, intent, what "good" looks like. */
    context?: string;
    /** Key into ground-truth.json, produced by seed/ground-truth.mongosh.js. */
    groundTruthKey?: string;
  };
  /** Seed script this case depends on, shown in the summary when it fails. */
  requiresSeed?: string;
}

export interface ToolEvent {
  toolName: string;
  phase?: string;
  status?: string;
  /** Turn index the event happened in. */
  turn: number;
  /** Order relative to suspensions, so checks can tell "before the first suspension". */
  seq: number;
}

export interface InterruptRecord {
  turn: number;
  seq: number;
  interruptId: string;
  actions: { name: string; args: Record<string, unknown> }[];
}

export interface TurnRecord {
  message: string;
  response: string;
  latencyMs: number;
  suspensions: number;
  /** True when the turn was still suspended after the reject cap. */
  leftSuspended: boolean;
  /** Times the platform said it was out of capacity before this turn got through. */
  capacityRetries?: number;
}

export interface CheckResult {
  name: string;
  passed: boolean;
  detail?: string;
}

export interface JudgeVerdict {
  rubric: RubricId;
  verdict: "pass" | "fail" | "unsure";
  reason: string;
  quote?: string;
}

export interface RunRecord {
  caseId: string;
  testId: string;
  goal: string;
  severity: Severity;
  workspace: WorkspaceKey;
  run: number;
  startedAt: string;
  /** Completion timestamp, including capacity waits (absent in older results). */
  completedAt?: string;
  sessionId?: string;
  turns: TurnRecord[];
  tools: ToolEvent[];
  interrupts: InterruptRecord[];
  /** Raw progress events, kept for debugging what the platform actually streams. */
  progress: { turn: number; content: string; phase?: string; toolName?: string; status?: string }[];
  error?: string;
  checks: CheckResult[];
  deterministicPass: boolean;
  judge?: JudgeVerdict[];
}

export interface RunMeta {
  startedAt: string;
  /** Requested parallel conversations; each conversation gets its own session. */
  concurrency?: number;
  /** Test IDs whose seed data the operator verified before this run. */
  verifiedSeeds?: string[];
  label: string;
  gitHead: string;
  baseUrl: string;
  /** Agent Engine project being invoked (absent in older result files). */
  projectId?: string;
  workspaces: Partial<Record<WorkspaceKey, string>>;
  caseCount: number;
  skipped: { caseId: string; reason: string }[];
  /** Read-only cases ran on the write workspace because no read-only workspace was set. */
  readonlyFallback?: boolean;
}
