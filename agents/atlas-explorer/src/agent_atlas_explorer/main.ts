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

/** MongoDB Atlas Explorer agent for Agent Engine. */

import "dotenv/config";

import { humanInTheLoopMiddleware } from "langchain";

import { App, AgentEngineToolSandboxBackend } from "@mongodb-js/agent-engine-sdk-langgraph";
import {
  approveAggregateWritesMiddleware,
  buildLLM,
  buildSystemPrompt,
  mutativeInterruptOn,
  prepareAtlasExplorerInput,
  recoverToolErrorsMiddleware,
  selectAtlasTools,
  stampResumeClientUserMiddleware,
  startRuntimeDiagnostics,
  stripToolEchoMiddleware,
  withRequesterMetadata,
  withoutShellExecution,
  writeOperationsAllowed,
} from "@repo/atlas-explorer-agent";

import { atlasExplorerConfig } from "./config.js";

function log(level: "INFO" | "WARN" | "ERROR", msg: string): void {
  const t = new Date().toISOString().slice(11, 19);
  console.log(`${t} | ${level.padEnd(8)} | ${msg}`);
}

process.env.AGENTIC_AGENT_WORKDIR ||= process.cwd();

export const app = new App({ appName: "atlas-explorer" });
const diagnostics = atlasExplorerConfig.diagnostics.logRuntimeLifecycle
  ? startRuntimeDiagnostics({
      mcpServers: app.agentConfig.mcp.servers,
      log: (msg) => log("INFO", msg),
    })
  : undefined;
app.prepareAgentInput((input, ctx) => {
  diagnostics?.recordExecution(ctx.sessionId);
  return prepareAtlasExplorerInput(input, ctx);
});
log("INFO", "App created; Atlas MCP tools will be discovered from agent.yaml");

export const buildAgent = app.entrypoint(() => {
  log("INFO", "Building atlas-explorer deep agent");
  diagnostics?.recordGraphBuild();

  const allowWriteOperations = writeOperationsAllowed();
  log(
    "INFO",
    allowWriteOperations
      ? "Write operations enabled; non-read MCP tools require HITL approval"
      : "Read-only tool policy; write MCP tools are hidden",
  );
  const discoveredTools = app.getTools() as readonly { name: string }[];
  const availableAtlasTools = selectAtlasTools(
    discoveredTools,
    allowWriteOperations,
  );
  const platformSaver = app.checkpointer();
  const saver =
    platformSaver === null ? null : withRequesterMetadata(platformSaver);
  const mutativeToolReview = humanInTheLoopMiddleware({
    interruptOn: allowWriteOperations
      ? mutativeInterruptOn(availableAtlasTools)
      : {},
    descriptionPrefix: "MongoDB or Atlas operation pending approval",
  });

  return app.deepAgent(
    buildLLM({
      provider: atlasExplorerConfig.llm.provider,
      model: atlasExplorerConfig.llm.model,
      logPrefix: "atlas-explorer",
    }),
    {
      tools: availableAtlasTools as never,
      systemPrompt: buildSystemPrompt(
        allowWriteOperations,
        atlasExplorerConfig.systemPrompt,
      ),
      skills: ["skills"],
      backend: withoutShellExecution(new AgentEngineToolSandboxBackend()) as never,
      checkpointer: (saver ?? false) as never,
      middleware: [
        stampResumeClientUserMiddleware,
        stripToolEchoMiddleware,
        mutativeToolReview,
        approveAggregateWritesMiddleware,
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
