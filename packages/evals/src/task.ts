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

import type { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import type { BaseMessage } from "@langchain/core/messages";
import { Command, MemorySaver } from "@langchain/langgraph";
import { createAgentEngineDeepAgent } from "@mongodb-js/agent-engine-sdk-langgraph";
import { prepareAgentInput, createInputRedactor } from "@repo/agent-engine-core";
import { BraintrustLangChainCallbackHandler } from "braintrust";
import type { EvalTask } from "mongodb-assistant-eval/cli";
import type {
  ConversationEvalCaseInputWithCustom,
  ConversationTaskOutputWithCustom,
} from "mongodb-assistant-eval/eval";

import type { AgentDefinition } from "./agents/definition.js";
import { convertLangchainMessagesToAssistantEvalMessages } from "./convertLangchainMessagesToAssistantEvalMessages.js";
import { ExecutionRecorder, type ExecutedToolCall } from "./executionRecorder.js";
import { makeChatModel, type ModelConfig } from "./models.js";
import { readOnlyAgentBackend } from "./readOnlyBackend.js";
import type { CustomInput } from "./schemas.js";
import type { ToolProvider } from "./tools/types.js";

export type AgentTaskInput = ConversationEvalCaseInputWithCustom<CustomInput>;

export interface AgentTaskOutputCustom extends Record<string, unknown> {
  /** Tool calls that ran. A hidden or refused tool never shows here. */
  executed: ExecutedToolCall[];
  /** Tools the agent paused on for approval, in order. */
  approvalRequests: string[];
  /** End state from the tool provider. */
  state: unknown;
}

export type AgentTaskOutput =
  ConversationTaskOutputWithCustom<AgentTaskOutputCustom>;

export interface AgentTaskOptions {
  readonly toolProvider: ToolProvider;
  /**
   * Extra callbacks for every run. Defaults to the Braintrust handler, which
   * nests model and tool spans under the case's task span.
   */
  readonly callbacks?: () => BaseCallbackHandler[];
}

const MAX_APPROVAL_ROUNDS = 5;
const EVAL_USER_ID = "eval-user";

interface Interrupt {
  value?: { actionRequests?: { name: string }[] };
}

interface InvokableAgent {
  invoke(input: unknown, config: unknown): Promise<Record<string, unknown>>;
}

function singleUserMessage(input: AgentTaskInput): string {
  const { messages } = input;
  if (messages.length !== 1 || messages[0].role !== "user") {
    throw new Error(
      "Agent cases take exactly one user message. Multi-turn cases are not supported.",
    );
  }
  return messages[0].content;
}

/**
 * Runs one of the repo's agents against a case. The agent is the production
 * one: its prompt, tool policy, and middleware come from the same builder
 * `main.ts` uses. Only the model, tools, checkpointer, and filesystem are
 * local.
 */
export function makeAgentTask(
  definition: AgentDefinition,
  { toolProvider, callbacks }: AgentTaskOptions,
): EvalTask<AgentTaskInput, AgentTaskOutput, ModelConfig> {
  return {
    description: `${definition.name} deep agent, traced to Braintrust`,

    async globalSetup() {
      await toolProvider.start?.();
    },

    async globalTeardown() {
      await toolProvider.stop?.();
    },

    async run({ input, modelConfig }) {
      const custom = input.custom;
      const allowWrites = custom?.allowWrites ?? false;
      if (allowWrites && !definition.supportsWrites) {
        throw new Error(`${definition.name} is read-only: drop allowWrites`);
      }
      const message = singleUserMessage(input);
      const model = makeChatModel(custom, modelConfig);

      const caseTools = await toolProvider.forCase({
        allowWrites,
        setup: custom?.toolSetup,
      });
      try {
        const options = definition.buildOptions({
          tools: caseTools.tools,
          allowWrites,
          defaultData: custom?.defaultData,
        });
        const agent = createAgentEngineDeepAgent(
          model,
          readOnlyAgentBackend(definition.agentDir) as never,
          {
            tools: options.tools as never,
            systemPrompt: options.systemPrompt,
            // Relative: the backend is rooted at the agent directory.
            skills: options.skills,
            middleware: options.middleware as never,
            checkpointer: new MemorySaver(),
          },
        ) as unknown as InvokableAgent;

        const recorder = new ExecutionRecorder();
        const threadId = randomUUID();
        const config = {
          callbacks: [
            recorder,
            ...(callbacks?.() ?? [new BraintrustLangChainCallbackHandler()]),
          ],
          configurable: { thread_id: threadId },
        };

        let result = await agent.invoke(
          prepareAgentInput(
            { payload: { message } } as never,
            { userId: EVAL_USER_ID, sessionId: threadId },
            { redactMessage: createInputRedactor(definition.inputGuardMode) },
          ),
          config,
        );

        const approvalRequests: string[] = [];
        for (
          let round = 0;
          Array.isArray(result.__interrupt__) && round < MAX_APPROVAL_ROUNDS;
          round++
        ) {
          const actions =
            (result.__interrupt__[0] as Interrupt | undefined)?.value
              ?.actionRequests ?? [];
          approvalRequests.push(...actions.map((a) => a.name));
          const decision =
            custom?.approval === "reject"
              ? { type: "reject", message: "Rejected by eval harness" }
              : { type: "approve" };
          result = await agent.invoke(
            new Command({ resume: { decisions: actions.map(() => decision) } }),
            config,
          );
        }
        if (result.__interrupt__) {
          throw new Error(
            `Agent still waiting for approval after ${MAX_APPROVAL_ROUNDS} rounds`,
          );
        }

        const messages = convertLangchainMessagesToAssistantEvalMessages(
          result.messages as BaseMessage[],
        );
        const lastAssistant = messages.findLast((m) => m.role === "assistant");
        return {
          messages,
          assistantMessageContent: lastAssistant?.content ?? "",
          // Required by the library's output type. The library's own
          // AllowedQuery scorer is not used for these agents.
          allowedQuery: true,
          custom: {
            executed: recorder.calls,
            approvalRequests,
            state: await caseTools.state(),
          },
        };
      } finally {
        await caseTools.dispose();
      }
    },
  };
}
