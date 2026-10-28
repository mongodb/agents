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

import { startMockBraintrust, type MockBraintrust } from "./mockBraintrust.js";

/** The part of the yargs instance the helper uses. */
interface ParsableCli {
  parseAsync(args: string[]): Promise<unknown>;
}

export interface OfflineCliResult {
  /** 0 on success, 1 when a validator failed or the run errored. */
  exitCode: number;
  /** Rows the run uploaded, for asserting on spans and scores. */
  braintrust: Pick<MockBraintrust, "rows" | "requests">;
}

class CliExit extends Error {
  constructor(readonly code: number) {
    super(`CLI exited with code ${code}`);
  }
}

/**
 * Runs an eval CLI to completion against the mock Braintrust server. The
 * library CLI needs a Braintrust key and calls `process.exit(1)` on a
 * failed validator. This sets a dummy key, points the SDK at the mock and
 * turns the exit into a return value, so scripted runs work in unit tests
 * and CI without secrets.
 */
export async function runEvalCliOffline(
  createCli: () => ParsableCli,
  args: string[],
): Promise<OfflineCliResult> {
  const mock = await startMockBraintrust();
  const env = {
    BRAINTRUST_API_KEY: "offline",
    BRAINTRUST_API_URL: mock.url,
    BRAINTRUST_APP_URL: mock.url,
  };
  const previousEnv = Object.fromEntries(
    Object.keys(env).map((key) => [key, process.env[key]]),
  );
  const realExit = process.exit;
  Object.assign(process.env, env);
  process.exit = ((code?: number) => {
    throw new CliExit(code ?? 0);
  }) as typeof process.exit;

  let exitCode = 0;
  try {
    await createCli().parseAsync(args);
  } catch (error) {
    if (!(error instanceof CliExit)) throw error;
    exitCode = error.code;
  } finally {
    process.exit = realExit;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    // Spans upload in the background. Give them a moment to land.
    await new Promise((resolve) => setTimeout(resolve, 500));
    await mock.close();
  }
  return {
    exitCode,
    braintrust: { rows: mock.rows, requests: mock.requests },
  };
}
