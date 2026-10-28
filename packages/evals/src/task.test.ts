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

import fs from "node:fs";
import path from "node:path";

import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import type { BaseMessage } from "@langchain/core/messages";
import { tool, type StructuredToolInterface } from "@langchain/core/tools";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { atlasExplorerAgent } from "./agents/atlasExplorer.js";
import { atlasQueryInsightsAgent } from "./agents/atlasQueryInsights.js";
import type { CustomInput } from "./schemas.js";
import {
  makeAgentTask,
  type AgentTaskInput,
  type AgentTaskOptions,
} from "./task.js";
import type {
  CaseTools,
  CaseToolsRequest,
  ToolProvider,
} from "./tools/types.js";

interface StaticToolSpec {
  readonly name: string;
  readonly description?: string;
  readonly schema: z.ZodObject<z.ZodRawShape>;
  /** Result the model sees. A thrown error becomes a tool error. */
  readonly result: (args: Record<string, unknown>) => string | Promise<string>;
}

/**
 * Canned tools, so these tests exercise the task without starting an MCP
 * server or a database. A fresh set is built for every case.
 */
function staticToolProvider(
  specs: readonly StaticToolSpec[],
  state: () => unknown = () => ({}),
): ToolProvider {
  return {
    async forCase(_request: CaseToolsRequest): Promise<CaseTools> {
      return {
        tools: specs.map(
          (spec) =>
            tool(async (args: Record<string, unknown>) => spec.result(args), {
              name: spec.name,
              description: spec.description ?? spec.name,
              schema: spec.schema as never,
            }) as unknown as StructuredToolInterface,
        ),
        state,
        dispose: async () => {},
      };
    },
  };
}

const LIST_PROJECTS = "mongodb__atlas_list_projects";
const PAUSE_CLUSTER = "mongodb__atlas_pause_resume_cluster";
const AGGREGATE = "mongodb__aggregate";

const toolProvider = staticToolProvider([
  {
    name: LIST_PROJECTS,
    schema: z.object({}),
    result: () => JSON.stringify([{ id: "p1", name: "Project One" }]),
  },
  {
    name: PAUSE_CLUSTER,
    schema: z.object({
      projectId: z.string(),
      clusterName: z.string(),
      action: z.string(),
    }),
    result: () => "paused",
  },
  {
    name: AGGREGATE,
    schema: z.object({
      database: z.string(),
      collection: z.string(),
      pipeline: z.array(z.record(z.string(), z.unknown())),
    }),
    result: () => "written",
  },
  {
    name: "mongodb__atlas_get_performance_advisor",
    schema: z.object({ projectId: z.string(), clusterName: z.string() }),
    result: () => "## Suggested Indexes\nNone",
  },
]);

class ModelInputCapture extends BaseCallbackHandler {
  name = "model-input-capture";
  awaitHandlers = true;
  readonly prompts: BaseMessage[][] = [];
  handleChatModelStart(_llm: unknown, messages: BaseMessage[][]): void {
    this.prompts.push(...messages);
  }
}

function caseInput(
  text: string,
  custom: CustomInput | undefined,
): AgentTaskInput {
  return { messages: [{ role: "user", content: text }], custom };
}

function run(
  definition: typeof atlasExplorerAgent,
  input: AgentTaskInput,
  options: Partial<AgentTaskOptions> = {},
) {
  const task = makeAgentTask(definition, {
    toolProvider,
    callbacks: () => [],
    ...options,
  });
  return task.run({
    input,
    modelName: "scripted",
    modelConfig: { kind: "scripted" },
  });
}

const pauseCall = {
  name: PAUSE_CLUSTER,
  args: { projectId: "p1", clusterName: "c1", action: "pause" },
};

describe("makeAgentTask", () => {
  it("runs the agent and maps the trajectory", async () => {
    const output = await run(
      atlasExplorerAgent,
      caseInput("List my projects", {
        script: [
          { toolCalls: [{ name: LIST_PROJECTS, args: {} }] },
          { text: "You have Project One." },
        ],
      }),
    );

    expect(output.assistantMessageContent).toBe("You have Project One.");
    expect(output.allowedQuery).toBe(true);
    expect(output.messages.map((m) => m.role)).toEqual([
      "user",
      "assistant",
      "tool",
      "assistant",
    ]);
    expect(output.messages[1]).toMatchObject({
      toolCalls: [{ function: { name: LIST_PROJECTS } }],
    });
    expect(output.custom?.executed).toEqual([
      { name: LIST_PROJECTS, args: {} },
    ]);
    expect(output.custom?.approvalRequests).toEqual([]);
  });

  it("does not record a tool the agent was not given", async () => {
    const output = await run(
      atlasExplorerAgent,
      caseInput("Pause c1", {
        script: [{ toolCalls: [pauseCall] }, { text: "Could not pause." }],
      }),
    );

    expect(output.custom?.executed).toEqual([]);
    expect(output.custom?.approvalRequests).toEqual([]);
  });

  it("pauses a write for approval, then runs it", async () => {
    const output = await run(
      atlasExplorerAgent,
      caseInput("Pause c1", {
        allowWrites: true,
        script: [{ toolCalls: [pauseCall] }, { text: "Paused c1." }],
      }),
    );

    expect(output.custom?.approvalRequests).toEqual([PAUSE_CLUSTER]);
    expect(output.custom?.executed).toEqual([pauseCall]);
    expect(output.assistantMessageContent).toBe("Paused c1.");
  });

  it("answers every approval when writes run in parallel", async () => {
    const outCall = (collection: string) => ({
      name: AGGREGATE,
      args: {
        database: "db",
        collection,
        pipeline: [{ $out: `${collection}_copy` }],
      },
    });
    const output = await run(
      atlasExplorerAgent,
      caseInput("Copy both collections", {
        allowWrites: true,
        script: [
          { toolCalls: [outCall("a"), outCall("b")] },
          { text: "Copied both." },
        ],
      }),
    );

    expect(output.custom?.approvalRequests).toEqual([AGGREGATE, AGGREGATE]);
    expect(output.custom?.executed).toEqual([outCall("a"), outCall("b")]);
    expect(output.assistantMessageContent).toBe("Copied both.");
  });

  it("does not run a rejected write", async () => {
    const output = await run(
      atlasExplorerAgent,
      caseInput("Pause c1", {
        allowWrites: true,
        approval: "reject",
        script: [{ toolCalls: [pauseCall] }, { text: "Understood." }],
      }),
    );

    expect(output.custom?.approvalRequests).toEqual([PAUSE_CLUSTER]);
    expect(output.custom?.executed).toEqual([]);
  });

  it("puts per-case default data in the system prompt", async () => {
    const capture = new ModelInputCapture();
    await run(
      atlasExplorerAgent,
      caseInput("How is my cluster?", {
        script: [{ text: "Fine." }],
        defaultData: { projectId: "proj-from-case", clusterName: "c-case" },
      }),
      { callbacks: () => [capture] },
    );

    const system = capture.prompts[0].find((m) => m.type === "system");
    expect(JSON.stringify(system?.content)).toContain("proj-from-case");
    expect(JSON.stringify(system?.content)).toContain("c-case");
  });

  it("loads the agent's skills into the prompt", async () => {
    const capture = new ModelInputCapture();
    await run(
      atlasExplorerAgent,
      caseInput("Hi", { script: [{ text: "Hello." }] }),
      { callbacks: () => [capture] },
    );

    const system = capture.prompts[0].find((m) => m.type === "system");
    expect(JSON.stringify(system?.content)).toContain(
      "mongodb-query-optimizer",
    );
  });

  it("lets the agent read its skills from memory", async () => {
    const output = await run(
      atlasExplorerAgent,
      caseInput("Read the skill", {
        script: [
          {
            toolCalls: [
              {
                name: "read_file",
                args: { file_path: "/skills/mongodb-query-optimizer/SKILL.md" },
              },
            ],
          },
          { text: "Read it." },
        ],
      }),
    );

    const toolMessage = output.messages.find((m) => m.role === "tool");
    expect(JSON.stringify(toolMessage)).toContain("mongodb-query-optimizer");
  });

  it("keeps filesystem writes in the case and off the disk", async () => {
    const skillFile = path.join(
      atlasExplorerAgent.agentDir,
      "skills",
      "eval-scratch.md",
    );
    const write = {
      name: "write_file",
      args: {
        file_path: "/skills/eval-scratch.md",
        content: "written-by-first-case",
      },
    };
    const read = {
      name: "read_file",
      args: { file_path: "/skills/eval-scratch.md" },
    };

    const first = await run(
      atlasExplorerAgent,
      caseInput("Write", {
        script: [{ toolCalls: [write] }, { toolCalls: [read] }, { text: "Ok" }],
      }),
    );
    const second = await run(
      atlasExplorerAgent,
      caseInput("Read", {
        script: [{ toolCalls: [read] }, { text: "Ok" }],
      }),
    );

    expect(fs.existsSync(skillFile)).toBe(false);
    const readBack = (messages: typeof first.messages) =>
      JSON.stringify(messages.filter((m) => m.role === "tool").at(-1));
    expect(readBack(first.messages)).toContain("written-by-first-case");
    expect(readBack(second.messages)).not.toContain("written-by-first-case");
  });

  it("redacts pasted secrets before the model sees them", async () => {
    const capture = new ModelInputCapture();
    const secret =
      "mongodb+srv://admin:hunter2pass@cluster0.example.mongodb.net";
    await run(
      atlasExplorerAgent,
      caseInput(`Connect with ${secret}`, { script: [{ text: "No." }] }),
      { callbacks: () => [capture] },
    );

    expect(JSON.stringify(capture.prompts)).not.toContain("hunter2pass");
  });

  it("runs the query insights agent read-only", async () => {
    const output = await run(
      atlasQueryInsightsAgent,
      caseInput("Any slow queries?", {
        script: [
          {
            toolCalls: [
              {
                name: "mongodb__atlas_get_performance_advisor",
                args: { projectId: "p1", clusterName: "c1" },
              },
            ],
          },
          { text: "No suggestions." },
        ],
      }),
    );

    expect(output.custom?.executed).toHaveLength(1);
    await expect(
      run(
        atlasQueryInsightsAgent,
        caseInput("Pause c1", { allowWrites: true, script: [{ text: "x" }] }),
      ),
    ).rejects.toThrow(/read-only/);
  });

  it("rejects cases that are not a single user message", async () => {
    await expect(
      run(atlasExplorerAgent, {
        messages: [
          { role: "user", content: "a" },
          { role: "assistant", content: "b" },
          { role: "user", content: "c" },
        ],
        custom: { script: [{ text: "x" }] },
      }),
    ).rejects.toThrow(/exactly one user message/);
  });

  it("needs a script for the scripted model", async () => {
    await expect(
      run(atlasExplorerAgent, caseInput("Hi", undefined)),
    ).rejects.toThrow(/input\.custom\.script/);
  });

  it("builds fresh tool state per case", async () => {
    let created = 0;
    let disposed = 0;
    const counting: ToolProvider = {
      async forCase(request) {
        const id = ++created;
        const inner: CaseTools = await toolProvider.forCase(request);
        return {
          ...inner,
          state: () => ({ id }),
          dispose: async () => {
            disposed++;
          },
        };
      },
    };
    const script = { script: [{ text: "ok" }] };

    const [a, b] = await Promise.all([
      run(atlasExplorerAgent, caseInput("a", script), {
        toolProvider: counting,
      }),
      run(atlasExplorerAgent, caseInput("b", script), {
        toolProvider: counting,
      }),
    ]);
    expect(new Set([a.custom?.state, b.custom?.state]).size).toBe(2);
    expect(disposed).toBe(created);
  });

  it("disposes case tools when the run fails", async () => {
    let disposed = 0;
    const failing: ToolProvider = {
      async forCase(request) {
        const inner = await toolProvider.forCase(request);
        return {
          ...inner,
          state: () => {
            throw new Error("state failed");
          },
          dispose: async () => {
            disposed++;
          },
        };
      },
    };

    await expect(
      run(atlasExplorerAgent, caseInput("a", { script: [{ text: "ok" }] }), {
        toolProvider: failing,
      }),
    ).rejects.toThrow("state failed");
    expect(disposed).toBe(1);
  });

  it("starts and stops the tool provider around the run", async () => {
    const events: string[] = [];
    const task = makeAgentTask(atlasExplorerAgent, {
      toolProvider: {
        start: async () => void events.push("start"),
        stop: async () => void events.push("stop"),
        forCase: toolProvider.forCase,
      },
    });
    await task.globalSetup?.();
    await task.globalTeardown?.();
    expect(events).toEqual(["start", "stop"]);
  });

  it("runs with the default Braintrust callback handler", async () => {
    const output = await run(
      atlasExplorerAgent,
      caseInput("Hi", { script: [{ text: "Hello." }] }),
      { callbacks: undefined },
    );
    expect(output.assistantMessageContent).toBe("Hello.");
  });
});
