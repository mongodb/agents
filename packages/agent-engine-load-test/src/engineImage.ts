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

import type { CommandRunner } from "./logs/fetchLogs.js";

export async function readOrchestrationEngineImage(
  runner: CommandRunner,
  workspace: string,
): Promise<string | null> {
  const result = await runner.run([
    "agentengine",
    "--no-log",
    "status",
    "--verbose",
    "--json",
    "--workspace",
    workspace,
  ]);
  if (result.exitCode !== 0) {
    const detail = result.stderr.trim() || `exit ${result.exitCode}`;
    throw new Error(`agentengine status failed: ${detail}`);
  }
  const document = parseJsonDocument(result.stdout);
  return imageFrom(document);
}

function imageFrom(document: Record<string, unknown> | undefined): string | null {
  if (!document) {
    return null;
  }
  const direct = oeImage(document["component_images"]);
  if (direct) {
    return direct;
  }
  const deployment = document["latest_deployment"];
  if (!isRecord(deployment)) {
    return null;
  }
  return oeImage(deployment["component_images"]);
}

function oeImage(value: unknown): string | null {
  if (!isRecord(value)) {
    return null;
  }
  const image = value["oe"];
  return typeof image === "string" && image.length > 0 ? image : null;
}

function parseJsonDocument(input: string): Record<string, unknown> | undefined {
  const start = input.indexOf("{");
  if (start < 0) {
    return undefined;
  }
  try {
    const value: unknown = JSON.parse(input.slice(start));
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
