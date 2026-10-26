import { tool, type StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";
import {
  callMcpTool,
  discoverMcpTools,
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
 * Real MCP tools, same discovery code the platform runs (`registerMcpTools`),
 * minus the platform wrappers. Call once in `globalSetup` and share: each
 * process mints its own Atlas OAuth token (100 per service account).
 */
export async function discoverRealMcpTools(mcpConfig: Parameters<typeof discoverMcpTools>[0]) {
  const bindings = await discoverMcpTools(mcpConfig);
  const tools = bindings.map(
    (b: MCPToolBinding) =>
      tool(
        async (args: Record<string, unknown>) => {
          const result = await callMcpTool(b, args);
          return JSON.stringify(result.structuredContent ?? result.content);
        },
        {
          name: b.sdkToolName,
          description: b.description,
          schema: b.inputSchema as never,
        },
      ) as unknown as StructuredToolInterface,
  );
  return tools;
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
