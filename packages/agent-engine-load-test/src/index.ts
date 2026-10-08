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

export { systemClock, type Clock } from "./clock.js";
export { readOrchestrationEngineImage } from "./engineImage.js";
export { gatewayConfigFromEnv } from "./gatewayConfig.js";
export {
  buildScenario,
  READ_ONLY_PROMPT,
  SCENARIO_NAMES,
  scenarioOptionsFromFlags,
  type Scenario,
  type ScenarioName,
  type ScenarioOptions,
} from "./load/scenarios.js";
export {
  readTurnLog,
  runScenario,
  type ScenarioInvoke,
} from "./load/runScenario.js";
export type { TurnResult } from "./load/turnResult.js";
export {
  fetchLogs,
  splitLogWindow,
  type CommandRunner,
} from "./logs/fetchLogs.js";
export {
  parseLogOutput,
  parseRuntimeDiagLogs,
  type DiagEvent,
  type PlatformLogRecord,
} from "./logs/parseRuntimeDiag.js";
export {
  buildReport,
  type FailureReport,
  type LoadReport,
  type RunMeta,
  type SessionReport,
  type TokenReport,
} from "./report/buildReport.js";
export { renderMarkdown } from "./report/renderMarkdown.js";
