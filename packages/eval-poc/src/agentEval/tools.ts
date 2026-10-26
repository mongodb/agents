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
import { z } from "zod";
import {
  discoverMcpTools,
  makeMcpToolCallable,
  type MCPToolBinding,
} from "@mongodb-js/agent-engine-runner-shared";
import { makeMockAtlas, type MockAtlasState } from "../mockAtlasTools.js";

export interface CaseTools {
  tools: StructuredToolInterface[];
  /** Calls that actually executed (not merely requested by the model). */
  executed: () => { name: string; args: unknown }[];
  /** End state for scorers. */
  state: () => unknown;
}

/** Stateful mock Atlas account; a fresh instance per case (cases run in parallel). */
export function mockAtlasTools(): CaseTools {
  const atlas = makeMockAtlas();
  return {
    tools: atlas.tools,
    executed: () => atlas.state.calls,
    state: () => atlas.state satisfies MockAtlasState,
  };
}

/**
 * Query Insights reads everything from get_performance_advisor, so a case is
 * "canned tool output" (the `## Suggested Indexes` / `## Slow Query Logs`
 * markdown the real tool returns).
 */
export function mockAdvisorTools(advisorOutput: string): CaseTools {
  const calls: { name: string; args: unknown }[] = [];
  const advisor = tool(
    async (args) => {
      calls.push({ name: "mongodb__atlas_get_performance_advisor", args });
      return advisorOutput;
    },
    {
      name: "mongodb__atlas_get_performance_advisor",
      description: "Get Atlas Performance Advisor suggestions and slow query logs",
      schema: z.object({
        projectId: z.string(),
        clusterName: z.string(),
        operations: z.array(z.string()).optional(),
      }),
    },
  );
  return {
    tools: [advisor as unknown as StructuredToolInterface],
    executed: () => calls,
    state: () => ({}),
  };
}

/**
 * Real MCP tools, built the way `App.registerMcpTools` builds them: same
 * discovery, same `<server>__<tool>` names, same result envelope
 * (`{content, structuredContent, isError}`) the model sees in production.
 * Call once in `globalSetup` and share across cases.
 *
 * `mcpConfig` is the `mcp` block of the agent's `agent.yaml`, e.g.
 * `loadRuntimeAgentConfig(agentDir).mcp`, so the harness and prod read one
 * source of truth.
 */
export async function discoverRealMcpTools(mcpConfig: Parameters<typeof discoverMcpTools>[0]) {
  const bindings = await discoverMcpTools(mcpConfig);
  return bindings.map((b: MCPToolBinding) => {
    const callable = makeMcpToolCallable(b);
    return tool((args: Record<string, unknown>) => callable(args), {
      name: b.sdkToolName,
      description: b.description.trim(),
      schema: b.inputSchema as never,
    }) as unknown as StructuredToolInterface;
  });
}

/** Wrap shared real tools so each case still gets its own executed-call log. */
export function sharedMcpTools(shared: StructuredToolInterface[]): CaseTools {
  const calls: { name: string; args: unknown }[] = [];
  const tools = shared.map((t) =>
    tool(
      async (args: unknown) => {
        calls.push({ name: t.name, args });
        return t.invoke(args as never);
      },
      { name: t.name, description: t.description, schema: t.schema as never },
    ) as unknown as StructuredToolInterface,
  );
  return { tools, executed: () => calls, state: () => ({}) };
}
