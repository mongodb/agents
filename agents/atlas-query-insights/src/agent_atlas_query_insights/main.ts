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

/** Read-only Atlas Query Insights agent for the Agentic Platform. */

import "dotenv/config";

import { App, AgentEngineToolSandboxBackend } from "@mongodb-js/agent-engine-sdk-langgraph";
import { registerKnowledgeTools } from "@repo/agent-engine-core";
import {
  clusterAllowlistMiddleware,
  rejectAggregateWritesMiddleware,
  surfaceTokenMintFailures,
  buildLLM,
  buildSystemPrompt,
  createInputRefusalMiddleware,
  createInputRedactor,
  databaseAllowlistMiddleware,
  prepareAgentInput,
  recoverToolErrorsMiddleware,
  redactSecretsMiddleware,
  selectAtlasQueryInsightsTools,
  stampResumeClientUserMiddleware,
  stripToolEchoMiddleware,
  withRequesterMetadata,
  withoutShellExecution,
} from "@repo/atlas-query-insights-agent";

import { atlasQueryInsightsConfig } from "./config.js";

function log(level: "INFO" | "WARN" | "ERROR", msg: string): void {
  const t = new Date().toISOString().slice(11, 19);
  console.log(`${t} | ${level.padEnd(8)} | ${msg}`);
}

process.env.AGENTIC_AGENT_WORKDIR ||= process.cwd();

export const app = new App({ appName: "atlas-query-insights" });
surfaceTokenMintFailures(app);
registerKnowledgeTools(app);
const redactMessage = createInputRedactor(
  atlasQueryInsightsConfig.inputGuard.mode,
);
app.prepareAgentInput((input, ctx) =>
  prepareAgentInput(input, ctx, { redactMessage }),
);
log("INFO", "App created; Atlas MCP tools will be discovered from agent.yaml");

export const buildAgent = app.entrypoint(() => {
  log("INFO", "Building atlas-query-insights deep agent");
  const discoveredTools = app.getTools() as readonly { name: string }[];
  const availableTools = selectAtlasQueryInsightsTools(discoveredTools);
  const platformSaver = app.checkpointer();
  const saver =
    platformSaver === null ? null : withRequesterMetadata(platformSaver);

  return app.deepAgent(
    buildLLM({
      provider: atlasQueryInsightsConfig.llm.provider,
      model: atlasQueryInsightsConfig.llm.model,
      logPrefix: "atlas-query-insights",
    }),
    {
      tools: availableTools as never,
      systemPrompt: buildSystemPrompt({
        name: atlasQueryInsightsConfig.systemPrompt.name,
        customInstructions: atlasQueryInsightsConfig.systemPrompt.customInstructions,
        dataAccess: atlasQueryInsightsConfig.dataAccess,
        databaseNames: atlasQueryInsightsConfig.databaseNames,
        maxQueryShapes: atlasQueryInsightsConfig.maxQueryShapes,
      }),
      skills: ["skills"],
      backend: withoutShellExecution(new AgentEngineToolSandboxBackend()) as never,
      checkpointer: (saver ?? false) as never,
      middleware: [
        createInputRefusalMiddleware({
          mode: atlasQueryInsightsConfig.inputGuard.mode,
        }),
        stampResumeClientUserMiddleware,
        stripToolEchoMiddleware,
        redactSecretsMiddleware,
        clusterAllowlistMiddleware(atlasQueryInsightsConfig.dataAccess),
        databaseAllowlistMiddleware(atlasQueryInsightsConfig.databaseNames),
        rejectAggregateWritesMiddleware,
        recoverToolErrorsMiddleware,
      ] as never,
    },
  ) as unknown;
});

export function main(): void {
  app.run();
}

const isDirectInvocation =
  typeof process !== "undefined" &&
  process.argv[1] &&
  (process.argv[1].endsWith("main.ts") || process.argv[1].endsWith("main.js"));

if (isDirectInvocation) {
  try {
    main();
  } catch (err) {
    const e = err as Error;
    log("ERROR", e.stack ?? e.message);
    process.exit(1);
  }
}
