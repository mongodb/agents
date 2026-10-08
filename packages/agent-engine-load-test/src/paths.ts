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

import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export const packageRoot = path.resolve(here, "..");

export function assertSafeRunId(runId: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(runId)) {
    throw new Error(
      `Run id "${runId}" may only contain letters, numbers, dots, underscores, and hyphens.`,
    );
  }
  // "." and ".." pass the pattern but resolve outside results/.
  if (runId === "." || runId === "..") {
    throw new Error(`Run id "${runId}" is a dot segment and cannot name a run directory.`);
  }
  return runId;
}

export function runDirectory(runId: string): string {
  return path.join(packageRoot, "results", assertSafeRunId(runId));
}

export function defaultRunId(scenario: string, now = new Date()): string {
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  return assertSafeRunId(`${stamp}-${scenario}`);
}
