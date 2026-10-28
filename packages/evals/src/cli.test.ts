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

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildEvalCli } from "./cli.js";
import { runEvalCliWithMockBraintrust } from "./offline/runEvalCliWithMockBraintrust.js";
import { createLocalToolProvider } from "./tools/localToolProvider.js";

const provider = createLocalToolProvider();

beforeAll(async () => {
  await provider.start?.();
});

afterAll(async () => {
  await provider.stop?.();
});

const run = (task: string, dataset: string, validator: string) =>
  runEvalCliWithMockBraintrust(() => buildEvalCli({ toolProvider: provider }), [
    "evaluation",
    "run",
    "--task",
    task,
    "--dataset",
    dataset,
    "--model",
    "scripted",
    "--validate",
    validator,
    "--task-concurrency",
    "2",
    "--trial-count",
    "1",
  ]);

describe("scripted smoke runs", () => {
  it("passes the explorer dataset", async () => {
    const { exitCode, braintrust } = await run(
      "explorer",
      "explorer-smoke",
      "smoke-explorer",
    );
    expect(exitCode).toBe(0);
    expect(braintrust.rows.length).toBeGreaterThan(0);
  }, 120_000);

  it("passes the query insights dataset", async () => {
    const { exitCode, braintrust } = await run(
      "query-insights",
      "query-insights-smoke",
      "smoke-query-insights",
    );
    expect(exitCode).toBe(0);
    expect(braintrust.rows.length).toBeGreaterThan(0);
  }, 120_000);
});
