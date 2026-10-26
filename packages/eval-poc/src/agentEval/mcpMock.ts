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

import { tool, type StructuredToolInterface } from "@langchain/core/tools";
import {
  callMcpTool,
  MCPToolError,
  type MCPToolBinding,
} from "@mongodb-js/agent-engine-runner-shared";
import type { CaseTools } from "./tools.js";

/** One entry of a recorded `tools/list`; names are already `<server>__<tool>`. */
export interface ToolSnapshotEntry {
  name: string;
  description: string;
  inputSchema: unknown;
}

/** What `callMcpTool` returns, and what the model sees as the tool result. */
export interface McpEnvelope {
  content: unknown[];
  structuredContent: Record<string, unknown> | null;
  isError: boolean;
}

/**
 * One canned tool call. First mock whose `tool` matches and whose `args` are a
 * subset of the call's arguments wins. `text` is shorthand for a text-only
 * envelope, `envelope` replays a recorded result verbatim, `error` behaves
 * like an MCP error result.
 */
export interface ToolMock {
  tool: string;
  args?: Record<string, unknown>;
  text?: string;
  envelope?: McpEnvelope;
  error?: string;
}

export function snapshotFromBindings(bindings: MCPToolBinding[]): ToolSnapshotEntry[] {
  return bindings.map((b) => ({
    name: b.sdkToolName,
    description: b.description,
    inputSchema: b.inputSchema,
  }));
}

const isSubset = (want: unknown, got: unknown): boolean => {
  if (want === null || typeof want !== "object") return want === got;
  if (got === null || typeof got !== "object") return false;
  return Object.entries(want).every(([k, v]) =>
    isSubset(v, (got as Record<string, unknown>)[k]),
  );
};

/**
 * Tools with the real names and schemas (from the snapshot) whose calls return
 * canned results. Results go through the same envelope and error behavior as
 * `callMcpTool`, so middleware and the model see what they see in production.
 * A call with no matching mock throws and is listed in `state().unmocked`.
 */
export function mockMcpTools(
  snapshot: ToolSnapshotEntry[],
  mocks: ToolMock[],
): CaseTools {
  const executed: { name: string; args: unknown }[] = [];
  const unmocked: { name: string; args: unknown }[] = [];

  const tools = snapshot.map(
    (entry) =>
      tool(
        async (args: Record<string, unknown>) => {
          executed.push({ name: entry.name, args });
          const mock = mocks.find(
            (m) => m.tool === entry.name && isSubset(m.args ?? {}, args),
          );
          if (!mock) {
            unmocked.push({ name: entry.name, args });
            throw new MCPToolError(
              `No mock for ${entry.name}(${JSON.stringify(args)})`,
            );
          }
          if (mock.error !== undefined) {
            throw new MCPToolError(`MCP tool returned error: ${mock.error}`);
          }
          return (
            mock.envelope ?? {
              content: [{ type: "text", text: mock.text ?? "" }],
              structuredContent: null,
              isError: false,
            }
          );
        },
        {
          name: entry.name,
          description: entry.description.trim(),
          schema: entry.inputSchema as never,
        },
      ) as unknown as StructuredToolInterface,
  );

  return { tools, executed: () => executed, state: () => ({ unmocked }) };
}

/**
 * Record mode: real tools that also append `{tool, args, envelope}` to `sink`.
 * Save the sink as the case's `mocks` to replay the run offline.
 */
export function recordingMcpTools(
  bindings: MCPToolBinding[],
  sink: ToolMock[],
): StructuredToolInterface[] {
  return bindings.map(
    (b) =>
      tool(
        async (args: Record<string, unknown>) => {
          try {
            const envelope = (await callMcpTool(b, args)) as McpEnvelope;
            sink.push({ tool: b.sdkToolName, args, envelope });
            return envelope;
          } catch (e) {
            sink.push({
              tool: b.sdkToolName,
              args,
              error: String(e instanceof Error ? e.message : e).replace(
                /^MCP tool returned error: /,
                "",
              ),
            });
            throw e;
          }
        },
        {
          name: b.sdkToolName,
          description: b.description.trim(),
          schema: b.inputSchema as never,
        },
      ) as unknown as StructuredToolInterface,
  );
}
