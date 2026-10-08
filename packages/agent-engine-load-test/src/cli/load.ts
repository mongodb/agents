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

import { AgentEngineClient } from "@repo/agent-engine-chat/agent-engine";

import { execCommand } from "../command.js";
import { systemClock } from "../clock.js";
import { readOrchestrationEngineImage } from "../engineImage.js";
import { gatewayConfigFromEnv, loadEnvFile } from "../gatewayConfig.js";
import { buildScenario, scenarioOptionsFromFlags } from "../load/scenarios.js";
import { runScenario } from "../load/runScenario.js";
import type { CommandRunner } from "../logs/fetchLogs.js";
import { defaultRunId, packageRoot, runDirectory } from "../paths.js";
import type { RunMeta } from "../report/buildReport.js";
import type { LoadCommandOptions } from "../cli.js";
import { writeRunMeta } from "./meta.js";

export async function runLoad(
  options: LoadCommandOptions,
  runner: CommandRunner = { run: execCommand },
): Promise<string> {
  loadEnvFile(path.join(packageRoot, ".env"));
  const config = gatewayConfigFromEnv(process.env);
  if (config.invokeTarget !== "gateway") {
    throw new Error("Load tests invoke the gateway, not a local agent");
  }
  const scenario = buildScenario(
    options.scenario,
    scenarioOptionsFromFlags(options),
  );
  const runId = options.runId ?? defaultRunId(options.scenario);
  const directory = runDirectory(runId);
  const observedAt = new Date();
  const image = await readOrchestrationEngineImage(runner, options.workspace);
  const client = new AgentEngineClient(config);
  const startedAt = new Date();
  await runScenario({
    scenario,
    clock: systemClock,
    clientLogPath: path.join(directory, "client.jsonl"),
    invoke: async (input) => {
      const result = await client.invokeStream({
        message: input.message,
        actorId: "load-test",
        client: "agent-engine-load-test",
        ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      });
      return {
        kind: result.kind,
        sessionId: result.sessionId,
        ...(result.executionId ? { executionId: result.executionId } : {}),
      };
    },
  });
  const endedAt = new Date();
  const meta: RunMeta = {
    runId,
    scenario: scenario.name,
    workspace: options.workspace,
    workspaceId: config.workspaceId,
    since: startedAt.toISOString(),
    until: endedAt.toISOString(),
    orchestrationEngineImage: image,
    engineImageObservedAt: observedAt.toISOString(),
    prompt: scenario.prompt,
  };
  writeRunMeta(directory, meta);
  console.log(`Run ${runId}`);
  console.log(
    `Orchestration Engine: ${image ?? "unknown"}`,
  );
  console.log(`Client log: ${path.join(directory, "client.jsonl")}`);
  console.log(
    "Wait about a minute for logs to land, then run fetch-logs and report.",
  );
  return runId;
}
