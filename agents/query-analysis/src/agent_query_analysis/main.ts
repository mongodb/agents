/** Read-only Query Analysis agent for the Agentic Platform. */

import "dotenv/config";

import { App, AgentEngineToolSandboxBackend } from "@mongodb-js/agent-engine-sdk-langgraph";
import {
  annotatePerformanceAdvisorMiddleware,
  buildLLM,
  buildSystemPrompt,
  prepareAgentInput,
  recoverToolErrorsMiddleware,
  selectQueryAnalysisTools,
  stampResumeClientUserMiddleware,
  stripToolEchoMiddleware,
  withRequesterMetadata,
  withoutShellExecution,
} from "@repo/query-analysis-agent";

import { queryAnalysisConfig } from "./config.js";

function log(level: "INFO" | "WARN" | "ERROR", msg: string): void {
  const t = new Date().toISOString().slice(11, 19);
  console.log(`${t} | ${level.padEnd(8)} | ${msg}`);
}

process.env.AGENTIC_AGENT_WORKDIR ||= process.cwd();

export const app = new App({ appName: "query-analysis" });
app.prepareAgentInput(prepareAgentInput);
log("INFO", "App created; Atlas MCP tools will be discovered from agent.yaml");

export const buildAgent = app.entrypoint(() => {
  log("INFO", "Building query-analysis deep agent");
  const discoveredTools = app.getTools() as readonly { name: string }[];
  const availableTools = selectQueryAnalysisTools(discoveredTools);
  const platformSaver = app.checkpointer();
  const saver =
    platformSaver === null ? null : withRequesterMetadata(platformSaver);

  return app.deepAgent(
    buildLLM({
      provider: queryAnalysisConfig.llm.provider,
      model: queryAnalysisConfig.llm.model,
      logPrefix: "query-analysis",
    }),
    {
      tools: availableTools as never,
      systemPrompt: buildSystemPrompt({
        name: queryAnalysisConfig.systemPrompt.name,
        customInstructions: queryAnalysisConfig.systemPrompt.customInstructions,
        scope: queryAnalysisConfig.scope,
        maxQueryShapes: queryAnalysisConfig.maxQueryShapes,
      }),
      skills: ["skills"],
      backend: withoutShellExecution(new AgentEngineToolSandboxBackend()) as never,
      checkpointer: (saver ?? false) as never,
      middleware: [
        stampResumeClientUserMiddleware,
        stripToolEchoMiddleware,
        annotatePerformanceAdvisorMiddleware(),
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
