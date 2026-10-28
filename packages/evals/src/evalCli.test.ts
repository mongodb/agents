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

import { createEvalCli } from "./evalCli.js";
import { runEvalCliOffline } from "./offline/runEvalCliOffline.js";

function smokeArgs(task: string, extra: string[] = []) {
  return [
    "evaluation",
    "run",
    "--task",
    task,
    "--dataset",
    "smoke",
    "--model",
    "scripted",
    "--validate",
    "smoke",
    "--trial-count",
    "1",
    ...extra,
  ];
}

describe("evaluation CLI smoke suite", () => {
  it.each(["explorer", "query-insights"])(
    "passes validation for the %s agent with the scripted model",
    async (task) => {
      const result = await runEvalCliOffline(createEvalCli, smokeArgs(task));
      expect(result.exitCode).toBe(0);
      const scored = result.braintrust.rows.filter(
        (row) => row.scores?.NonEmptyAnswer === 1,
      );
      expect(scored.length).toBeGreaterThan(0);
    },
    60_000,
  );
});
