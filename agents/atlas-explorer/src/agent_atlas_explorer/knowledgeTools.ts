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

import type { App } from "@mongodb-js/agent-engine-sdk-langgraph";
import {
  ListKnowledgeSourcesTool,
  ListKnowledgeSourcesToolName,
  SearchKnowledgeTool,
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

const packagedTools = [SearchKnowledgeTool, ListKnowledgeSourcesTool] as const;

type PackagedKnowledgeTool = InstanceType<(typeof packagedTools)[number]>;

/**
 * `execute` is the knowledge-base call. The public `invoke` method is the MCP
 * server lifecycle and needs telemetry, metrics, and elicitation.
 */
type KnowledgeToolExecute = {
  execute(args: Record<string, unknown>): Promise<unknown>;
};

function knowledgeToolServer(): AssistantToolServer {
  return {
    config: {},
    logger: { debug() {} },
  } as AssistantToolServer;
}

function langGraphName(packageName: string): string {
  return LANGGRAPH_TOOL_NAMES[packageName] ?? packageName.replaceAll("-", "_");
}

function langGraphDescription(description: string): string {
  return description
    .replaceAll(SearchKnowledgeToolName, SEARCH_KNOWLEDGE_TOOL_NAME)
    .replaceAll(
      ListKnowledgeSourcesToolName,
      LIST_KNOWLEDGE_SOURCES_TOOL_NAME,
    );
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
  const server = knowledgeToolServer();
  return packagedTools.map((Tool) => {
    const tool: PackagedKnowledgeTool = new Tool({ server });
    const schema = z.object(tool.argsShape()).strict();
    return {
      name: langGraphName(tool.name),
      description: langGraphDescription(tool.description),
      schema,
      invoke: (args?: unknown) =>
        (tool as unknown as KnowledgeToolExecute)
          .execute(schema.parse(args ?? {}))
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
