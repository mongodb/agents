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

import { AssertionError } from "node:assert";
import { randomUUID } from "node:crypto";

import type { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import type { BaseMessage } from "@langchain/core/messages";
import { Command, MemorySaver } from "@langchain/langgraph";
import { createAgentEngineDeepAgent } from "@mongodb-js/agent-engine-sdk-langgraph";
import {
  prepareAgentInput,
  createInputRedactor,
} from "@repo/agent-engine-core";
import { BraintrustLangChainCallbackHandler } from "braintrust";
import type { EvalTask } from "mongodb-assistant-eval/cli";
import type {
  ConversationEvalCaseInputWithCustom,
  ConversationTaskOutputWithCustom,
} from "mongodb-assistant-eval/eval";

import type { AgentDefinition } from "./agents/definition.js";
import { convertLangchainMessagesToAssistantEvalMessages } from "./convertLangchainMessagesToAssistantEvalMessages.js";
import { ExecutionRecorder, type ExecutedToolCall } from "./executionRecorder.js";
import {
  knowledgeSourceUrls,
  knowledgeToolErrors,
  type KnowledgeToolError,
} from "./knowledgeSources.js";
import { readAgentFiles } from "./agentFiles.js";
import { makeChatModel, type ModelConfig } from "./models.js";
import { MONGO_CHECKS, type MongoCheck } from "./mongoChecks/index.js";
import type { CustomInput } from "./schemas.js";
import type { CaseTools, ToolProvider } from "./tools/types.js";

export type AgentTaskInput = ConversationEvalCaseInputWithCustom<CustomInput>;

export interface AgentTaskOutputCustom extends Record<string, unknown> {
  /** Tool calls that ran. A hidden or refused tool never shows here. */
  executed: ExecutedToolCall[];
  /** Tools the agent paused on for approval, in order. */
  approvalRequests: string[];
  /** End state from the tool provider. */
  state: unknown;
  /** Knowledge tool calls that failed, so a low score can be told from an outage. */
  knowledgeErrors: KnowledgeToolError[];
  /** The case's Mongo check, when it names one. */
  mongoCheck?: MongoCheckResult;
}

export interface MongoCheckResult {
  readonly name: string;
  readonly passed: boolean;
  /** The assertion's message, when the check did not pass. */
  readonly failure?: string;
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
  /** Checks a case can name. Defaults to the repo's own. Tests pass stubs. */
  readonly mongoChecks?: Readonly<Record<string, MongoCheck>>;
}

const MAX_APPROVAL_ROUNDS = 5;
const EVAL_USER_ID = "eval-user";

interface Interrupt {
  id: string;
  value?: { actionRequests?: { name: string }[] };
}

interface AgentResult {
  messages: BaseMessage[];
  __interrupt__?: Interrupt[];
}

interface InvokableAgent {
  invoke(input: unknown, config: unknown): Promise<AgentResult>;
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

const MAX_FAILURE_LENGTH = 2000;

/**
 * Runs the check a case names against its live database. An assertion that
 * does not hold is a failed check. Any other error propagates, so a lost
 * connection fails the case instead of scoring 0.
 */
async function runMongoCheck(
  name: string,
  caseTools: CaseTools,
  checks: Readonly<Record<string, MongoCheck>>,
): Promise<MongoCheckResult> {
  const check = Object.hasOwn(checks, name) ? checks[name] : undefined;
  if (!check) throw new Error(`Unknown mongoCheck "${name}"`);
  if (!caseTools.withMongo) {
    throw new Error(`mongoCheck "${name}" needs toolSetup.localMongo`);
  }
  try {
    await caseTools.withMongo(check);
    return { name, passed: true };
  } catch (error) {
    if (!(error instanceof AssertionError)) throw error;
    return {
      name,
      passed: false,
      failure: error.message.slice(0, MAX_FAILURE_LENGTH),
    };
  }
}

/**
 * Runs one of the repo's agents against a case. The agent is the production
 * one: its prompt, tool policy, and middleware come from the same builder
 * `main.ts` uses. Only the model, tools, checkpointer, and filesystem are
 * local.
 */
export function makeAgentTask(
  definition: AgentDefinition,
  { toolProvider, callbacks, mongoChecks = MONGO_CHECKS }: AgentTaskOptions,
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
          undefined,
          {
            tools: options.tools as never,
            systemPrompt: options.systemPrompt,
            skills: options.skills.map((skill) => `/${skill}`),
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

        const input = prepareAgentInput(
          { payload: { message } } as never,
          { userId: EVAL_USER_ID, sessionId: threadId },
          { redactMessage: createInputRedactor(definition.inputGuardMode) },
        );
        let result = await agent.invoke(
          { ...input, files: readAgentFiles(definition.agentDir) },
          config,
        );

        const approvalRequests: string[] = [];
        for (
          let round = 0;
          result.__interrupt__ !== undefined && round < MAX_APPROVAL_ROUNDS;
          round++
        ) {
          const decision =
            custom?.approval === "reject"
              ? { type: "reject", message: "Rejected by eval harness" }
              : { type: "approve" };
          // Parallel tool calls can each pause on their own interrupt. LangGraph
          // resumes them only from a map keyed by interrupt id.
          const resume: Record<string, { decisions: unknown[] }> = {};
          for (const interrupt of result.__interrupt__) {
            const actions = interrupt.value?.actionRequests ?? [];
            approvalRequests.push(...actions.map((a) => a.name));
            resume[interrupt.id] = { decisions: actions.map(() => decision) };
          }
          result = await agent.invoke(new Command({ resume }), config);
        }
        if (result.__interrupt__) {
          throw new Error(
            `Agent still waiting for approval after ${MAX_APPROVAL_ROUNDS} rounds`,
          );
        }

        const mongoCheck =
          custom?.mongoCheck === undefined
            ? undefined
            : await runMongoCheck(custom.mongoCheck, caseTools, mongoChecks);

        const messages = convertLangchainMessagesToAssistantEvalMessages(
          result.messages,
        );
        const lastAssistant = messages
          .filter((m) => m.role === "assistant")
          .at(-1);
        return {
          messages,
          assistantMessageContent: lastAssistant?.content ?? "",
          // Required by the library's output type. The library's own
          // AllowedQuery scorer is not used for these agents.
          allowedQuery: true,
          urls: knowledgeSourceUrls(result.messages),
          custom: {
            executed: recorder.calls,
            approvalRequests,
            state: await caseTools.state(),
            knowledgeErrors: knowledgeToolErrors(result.messages),
            ...(mongoCheck && { mongoCheck }),
          },
        };
      } finally {
        await caseTools.dispose();
      }
    },
  };
}
