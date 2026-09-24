/** MongoDB Atlas Explorer for the Magenta Agentic Platform. */

import "dotenv/config";

import { humanInTheLoopMiddleware } from "langchain";

import { withoutShellExecution } from "./agentBackend.js";
import {
  mutativeInterruptOn,
  selectAtlasTools,
  writeOperationsAllowed,
} from "./agentPolicy.js";
import { atlasExplorerConfig } from "./config.js";
import { buildLLM } from "./llm.js";
import { stripToolEchoMiddleware } from "./modelResponse.js";
import { buildSystemPrompt } from "./systemMessage.js";
import { recoverToolErrorsMiddleware } from "./toolErrors.js";
import { withRequesterMetadata } from "./requesterMetadata.js";
import { stampResumeClientUserMiddleware } from "./stampResume.js";
import { prepareAtlasExplorerInput } from "./userRun.js";
import { App, AgentEngineToolSandboxBackend } from "@mongodb-js/agent-engine-sdk-langgraph";

function log(level: "INFO" | "WARN" | "ERROR", msg: string): void {
  const t = new Date().toISOString().slice(11, 19);
  console.log(`${t} | ${level.padEnd(8)} | ${msg}`);
}

process.env.AGENTIC_AGENT_WORKDIR ||= process.cwd();

export const app = new App({ appName: "atlas-explorer" });
app.prepareAgentInput(prepareAtlasExplorerInput);
log("INFO", "App created; Atlas MCP tools will be discovered from agent.yaml");

export const buildAgent = app.entrypoint(() => {
  log("INFO", "Building atlas-explorer deep agent");

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
