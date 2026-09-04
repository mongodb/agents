/** MongoDB Atlas Explorer for the Magenta Agentic Platform. */

import "dotenv/config";

import { withoutShellExecution } from "./agentBackend.js";
import { selectAtlasTools } from "./agentPolicy.js";
import { buildLLM } from "./llm.js";
import { stripToolEchoMiddleware } from "./modelResponse.js";
import { SYSTEM_PROMPT } from "./systemMessage.js";
import { recoverToolErrorsMiddleware } from "./toolErrors.js";
import { mutativeToolReviewMiddleware } from "./toolReview.js";

function log(level: "INFO" | "WARN" | "ERROR", msg: string): void {
  const t = new Date().toISOString().slice(11, 19);
  console.log(`${t} | ${level.padEnd(8)} | ${msg}`);
}

// The Tool Pod snapshots its read-only skill roots while the Magenta modules
// load. Establish the source root first so bundled skills remain readable
// through the audited filesystem tools in local and deployed runtimes.
process.env.AGENTIC_AGENT_WORKDIR ||= process.cwd();
const { App, MagentaToolPodBackend } =
  await import("@magenta/magenta-sdklanggraph-ts");

export const app = new App({ appName: "atlas-explorer" });
log("INFO", "App created; Atlas MCP tools will be discovered from agent.yaml");

export const buildAgent = app.entrypoint(() => {
  log("INFO", "Building atlas-explorer deep agent");

  const allTools = selectAtlasTools(
    app.getTools() as readonly { name: string }[],
  );
  const saver = app.checkpointer();

  return app.deepAgent(
    buildLLM({
      provider: "openai",
      model: "gpt-5.6-luna",
    }),
    {
      tools: allTools as never,
      systemPrompt: SYSTEM_PROMPT,
      skills: ["skills"],
      backend: withoutShellExecution(new MagentaToolPodBackend()) as never,
      checkpointer: (saver ?? false) as never,
      middleware: [
        stripToolEchoMiddleware,
        mutativeToolReviewMiddleware,
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
