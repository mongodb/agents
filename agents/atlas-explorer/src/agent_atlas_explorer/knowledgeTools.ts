import type { App } from "@mongodb-js/agent-engine-sdk-langgraph";
import {
  CompositeLogger,
  Keychain,
  NoopMetrics,
  NoopTelemetry,
} from "@mongodb-js/mcp-core";
import {
  AssistantTools,
  ListKnowledgeSourcesToolName,
  SearchKnowledgeToolName,
  type AssistantToolServer,
} from "@mongodb-js/mcp-tools-assistant";
import { z } from "zod";

export const KNOWLEDGE_NETWORK_HOST = "knowledge.mongodb.com";
export const SEARCH_KNOWLEDGE_TOOL_NAME = "search_knowledge";
export const LIST_KNOWLEDGE_SOURCES_TOOL_NAME = "list_knowledge_sources";

const LANGGRAPH_TOOL_NAMES: Record<string, string> = {
  [SearchKnowledgeToolName]: SEARCH_KNOWLEDGE_TOOL_NAME,
  [ListKnowledgeSourcesToolName]: LIST_KNOWLEDGE_SOURCES_TOOL_NAME,
};

const toolExecutionContext = {
  request: { signal: new AbortController().signal },
};

function createAssistantServer(): AssistantToolServer {
  return {
    config: {
      transport: "stdio",
      httpResponseType: "json",
      readOnly: true,
      disabledTools: [],
      confirmationRequiredTools: [],
      previewFeatures: [],
    },
    logger: new CompositeLogger(),
    keychain: new Keychain(),
    telemetry: new NoopTelemetry(),
    elicitation: {
      supportsElicitation: () => false,
      confirmationRequired: () => {
        throw new Error("knowledge tools do not elicit confirmation");
      },
      readConfirmation: () => undefined,
      inputRequired: () => {
        throw new Error("knowledge tools do not elicit input");
      },
      readInput: () => undefined,
    },
    metrics: new NoopMetrics(),
    mcpServer: { registerTool() {} } as AssistantToolServer["mcpServer"],
    tools: [],
    isToolCategoryAvailable: (name: string) => name === "assistant",
  };
}

function contentToText(result: unknown): string {
  if (typeof result !== "object" || result === null) {
    return "";
  }
  const { content, isError } = result as {
    content?: unknown;
    isError?: boolean;
  };
  const parts = Array.isArray(content) ? content : [];
  const text = parts
    .filter(
      (part): part is { type: "text"; text: string } =>
        typeof part === "object" &&
        part !== null &&
        "type" in part &&
        part.type === "text" &&
        "text" in part &&
        typeof part.text === "string",
    )
    .map((part) => part.text)
    .join("\n\n");
  if (isError) {
    throw new Error(text);
  }
  return text;
}

export type WrappedKnowledgeTool = {
  name: string;
  description: string;
  schema: z.ZodObject<z.ZodRawShape>;
  invoke: (args?: unknown) => Promise<string>;
};

export function createKnowledgeTools(): WrappedKnowledgeTool[] {
  const server = createAssistantServer();
  return AssistantTools.map((Tool) => {
    const tool = new Tool({ server });
    const schema = z.object(tool.argsShape()).strict();
    return {
      name: LANGGRAPH_TOOL_NAMES[tool.name] ?? tool.name.replaceAll("-", "_"),
      description: tool.description,
      schema,
      invoke: (args?: unknown) =>
        tool
          .invoke(schema.parse(args ?? {}), toolExecutionContext as never)
          .then(contentToText),
    };
  });
}

export function registerKnowledgeTools(app: Pick<App, "tool">): void {
  for (const tool of createKnowledgeTools()) {
    app.tool({
      name: tool.name,
      description: tool.description,
      schema: tool.schema,
      isLocal: false,
      network: [KNOWLEDGE_NETWORK_HOST],
    })((args: unknown) => tool.invoke(args));
  }
}
