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

import { randomUUID } from "node:crypto";
import { Command } from "@langchain/langgraph";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { BraintrustLangChainCallbackHandler } from "braintrust";
import { buildLLM } from "@repo/agent-engine-core";
import type {
  ConversationEvalCaseInputWithCustom,
  ConversationTaskOutputWithCustom,
} from "mongodb-assistant-eval/eval";
import type { EvalTask } from "mongodb-assistant-eval/cli";
import { ScriptedChatModel } from "../scriptedModel.js";
import { toEvalMessages } from "../messageMapper.js";
import { buildLocalAgent, prepareInput, type AgentKind } from "./localAgents.js";
import {
  discoverRealMcpTools,
  mockAdvisorTools,
  mockAtlasTools,
  sharedMcpTools,
  type CaseTools,
} from "./tools.js";
import type { CustomInput } from "./schemas.js";

export type Input = ConversationEvalCaseInputWithCustom<CustomInput>;

export interface OutputCustom extends Record<string, unknown> {
  /** Tool calls that really ran (a hidden or rejected tool never shows here). */
  executed: { name: string; args: unknown }[];
  /** Tool names the agent paused on for human approval, in order. */
  approvalRequests: string[];
  state: unknown;
}
export type Output = ConversationTaskOutputWithCustom<OutputCustom>;

/** One entry per `--model`. `scripted` needs no key; `llm` is the real thing. */
export type ModelConfig =
  | { kind: "scripted" }
  | { kind: "llm"; provider: string; model: string };

export interface GlobalContext {
  mcpTools?: StructuredToolInterface[];
}

const MAX_APPROVAL_ROUNDS = 5;

function makeLlm(input: Input, cfg: ModelConfig): BaseChatModel {
  if (cfg.kind === "scripted") {
    const script = input.custom?.script;
    if (!script?.length) {
      throw new Error("scripted model needs input.custom.script");
    }
    // `true`: emit Responses-API-style content blocks, like gpt-6 does.
    return new ScriptedChatModel(script as never, true);
  }
  return buildLLM({ provider: cfg.provider, model: cfg.model, logPrefix: "eval" });
}

function makeCaseTools(input: Input, ctx?: GlobalContext): CaseTools {
  const c = input.custom!;
  switch (c.toolSource) {
    case "mock-atlas":
      return mockAtlasTools();
    case "mock-advisor":
      return mockAdvisorTools(c.advisorOutput ?? "");
    case "mcp":
      if (!ctx?.mcpTools) {
        throw new Error("toolSource=mcp but no MCP tools in globalContext");
      }
      return sharedMcpTools(ctx.mcpTools);
  }
}

export function makeAgentTask(
  kind: AgentKind,
  opts: { mcpConfig?: Parameters<typeof discoverRealMcpTools>[0] } = {},
): EvalTask<Input, Output, ModelConfig, GlobalContext> {
  return {
    description: `Local ${kind} deep agent, traced to Braintrust`,

    // Discover MCP tools once: each process mints its own Atlas OAuth token.
    async globalSetup() {
      return opts.mcpConfig
        ? { mcpTools: await discoverRealMcpTools(opts.mcpConfig) }
        : {};
    },

    async run({ input, modelConfig, globalContext }) {
      const custom = input.custom ?? ({ toolSource: "mock-atlas" } as CustomInput);
      const caseTools = makeCaseTools(input, globalContext);
      const agent = buildLocalAgent(kind, {
        llm: makeLlm(input, modelConfig),
        tools: caseTools.tools,
        allowWrites: custom.allowWrites,
        defaultData: custom.defaultData,
      }) as unknown as {
        invoke: (i: unknown, cfg: unknown) => Promise<Record<string, any>>;
      };

      const lastUser = input.messages.findLast((m) => m.role === "user");
      if (!lastUser) throw new Error("case has no user message");

      const threadId = randomUUID();
      const config = {
        // Spans nest under the Eval task span; LangGraph/model/tool calls
        // become children automatically.
        callbacks: [new BraintrustLangChainCallbackHandler()],
        configurable: { thread_id: threadId },
      };

      let result = await agent.invoke(prepareInput(lastUser.content, threadId), config);

      const approvalRequests: string[] = [];
      for (let round = 0; result.__interrupt__ && round < MAX_APPROVAL_ROUNDS; round++) {
        const actions: { name: string }[] =
          result.__interrupt__[0]?.value?.actionRequests ?? [];
        approvalRequests.push(...actions.map((a) => a.name));
        const decision =
          custom.approval === "reject"
            ? { type: "reject", message: "Rejected by eval harness" }
            : { type: "approve" };
        result = await agent.invoke(
          new Command({ resume: { decisions: actions.map(() => decision) } }),
          config,
        );
      }

      const messages = toEvalMessages(result.messages);
      const lastAssistant = messages.findLast((m) => m.role === "assistant");
      return {
        messages,
        assistantMessageContent: lastAssistant?.content ?? "",
        // Required by the library's output type; agent guardrails are scored
        // by our own scorers, not by the library's AllowedQuery.
        allowedQuery: true,
        custom: {
          executed: caseTools.executed(),
          approvalRequests,
          state: caseTools.state(),
        },
      };
    },
  };
}

