import path from "node:path";
import { humanInTheLoopMiddleware } from "langchain";
import { MemorySaver } from "@langchain/langgraph";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { createDeepAgent, FilesystemBackend } from "deepagents";
import type { DataAccessConfig } from "@repo/agent-engine-core";
import * as explorer from "@repo/atlas-explorer-agent";
import * as insights from "@repo/atlas-query-insights-agent";

export type AgentKind = "atlas-explorer" | "atlas-query-insights";

export interface LocalAgentOptions {
  llm: BaseChatModel;
  tools: StructuredToolInterface[];
  allowWrites?: boolean;
  dataAccess?: DataAccessConfig;
  defaultData?: { projectId?: string; clusterName?: string };
}

const REPO_ROOT = path.resolve(import.meta.dirname, "../../../..");
const agentDir = (kind: AgentKind) =>
  path.join(REPO_ROOT, "agents", kind);

/**
 * Local twin of each agents/<name>/src/.../main.ts `buildAgent`.
 * Only platform plumbing is swapped (app.llm / app.deepAgent /
 * AgentEngineToolSandboxBackend / app.checkpointer). In the real change these
 * lists move into each agent package so main.ts and the eval share one copy.
 */
export function buildLocalAgent(kind: AgentKind, o: LocalAgentOptions) {
  const dataAccess = o.dataAccess ?? {};
  const backend = explorer.withoutShellExecution(
    new FilesystemBackend({ rootDir: agentDir(kind), virtualMode: true }),
  );

  if (kind === "atlas-explorer") {
    const writes = o.allowWrites ?? false;
    const tools = explorer.selectAtlasTools(
      o.tools as unknown as { name: string }[],
      writes,
    );
    return createDeepAgent({
      model: o.llm,
      tools: tools as never,
      systemPrompt: explorer.buildSystemPrompt(writes, {
        dataAccess,
        defaultData: o.defaultData,
      }),
      skills: ["skills"],
      backend: backend as never,
      checkpointer: new MemorySaver(),
      middleware: [
        explorer.createInputRefusalMiddleware({ mode: "enforce" }),
        explorer.stampResumeClientUserMiddleware,
        explorer.stripToolEchoMiddleware,
        explorer.redactSecretsMiddleware,
        explorer.clusterAllowlistMiddleware(dataAccess),
        humanInTheLoopMiddleware({
          interruptOn: writes ? explorer.mutativeInterruptOn(tools) : {},
          descriptionPrefix: "MongoDB or Atlas operation pending approval",
        }),
        explorer.approveAggregateWritesMiddleware,
        explorer.databaseAllowlistMiddleware(dataAccess.databaseNames),
        explorer.recoverToolErrorsMiddleware,
      ] as never,
    });
  }

  const tools = insights.selectAtlasQueryInsightsTools(
    o.tools as unknown as { name: string }[],
  );
  return createDeepAgent({
    model: o.llm,
    tools: tools as never,
    systemPrompt: insights.buildSystemPrompt({
      dataAccess,
      defaultData: o.defaultData,
    }),
    skills: ["skills"],
    backend: backend as never,
    checkpointer: new MemorySaver(),
    middleware: [
      insights.createInputRefusalMiddleware({ mode: "enforce" }),
      insights.stampResumeClientUserMiddleware,
      insights.stripToolEchoMiddleware,
      insights.redactSecretsMiddleware,
      insights.clusterAllowlistMiddleware(dataAccess),
      insights.databaseAllowlistMiddleware(dataAccess.databaseNames),
      insights.rejectAggregateWritesMiddleware,
      insights.recoverToolErrorsMiddleware,
    ] as never,
  });
}

/** Same input hook the platform runs before the graph (secret redaction). */
export function prepareInput(message: string, sessionId: string) {
  return explorer.prepareAtlasExplorerInput(
    { payload: { message } } as never,
    { userId: "eval-user", sessionId },
    { redactMessage: explorer.createInputRedactor("enforce") },
  );
}
