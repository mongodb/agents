/** Read-only Atlas Query Insights agent for the Agentic Platform. */

import "dotenv/config";

import { App, AgentEngineToolSandboxBackend } from "@mongodb-js/agent-engine-sdk-langgraph";
import {
  annotatePerformanceAdvisorMiddleware,
  buildLLM,
  buildSystemPrompt,
  prepareAgentInput,
  recoverToolErrorsMiddleware,
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
app.prepareAgentInput(prepareAgentInput);
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
        scope: atlasQueryInsightsConfig.scope,
        maxQueryShapes: atlasQueryInsightsConfig.maxQueryShapes,
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
