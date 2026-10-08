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

import * as fs from "node:fs";
import * as path from "node:path";

import type { RunMeta } from "../report/buildReport.js";

export function writeRunMeta(directory: string, meta: RunMeta): void {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, "meta.json"),
    `${JSON.stringify(meta, null, 2)}\n`,
  );
}

export function readRunMeta(directory: string): RunMeta {
  const file = path.join(directory, "meta.json");
  if (!fs.existsSync(file)) {
    throw new Error(
      `No meta.json in ${directory}. Run load, or report with --since and --until.`,
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    throw new Error(`Could not parse ${file}`);
  }
  if (!isRunMeta(value)) {
    throw new Error(`${file} is missing required fields`);
  }
  return value;
}

function isRunMeta(value: unknown): value is RunMeta {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const meta = value as Record<string, unknown>;
  return (
    typeof meta["runId"] === "string" &&
    typeof meta["workspace"] === "string" &&
    typeof meta["since"] === "string" &&
    typeof meta["until"] === "string" &&
    (meta["orchestrationEngineImage"] === null ||
      typeof meta["orchestrationEngineImage"] === "string") &&
    (meta["engineImageObservedAt"] === null ||
      typeof meta["engineImageObservedAt"] === "string")
  );
}
