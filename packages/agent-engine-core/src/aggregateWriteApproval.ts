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

import { ToolMessage } from "@langchain/core/messages";
import { interrupt } from "@langchain/langgraph";
import { createMiddleware } from "langchain";

/**
 * Atlas labels aggregate tools read-only, but `$out` and `$merge` write.
 * Tool-name HITL never sees those calls, so this middleware approves the
 * pipeline argument before the tool runs.
 */
export const AGGREGATE_WRITE_TOOLS: ReadonlySet<string> = new Set([
  "mongodb__aggregate",
  "mongodb__aggregate_db",
]);

const WRITE_STAGE_KEYS = new Set(["$out", "$merge"]);
const ALLOWED_DECISIONS = ["approve", "edit", "reject"] as const;

const DESCRIPTION_PREFIX = "MongoDB or Atlas operation pending approval";

interface AggregateToolCall {
  id?: string;
  name: string;
  args?: unknown;
}

interface AggregateToolRequest {
  toolCall?: AggregateToolCall;
}

interface EditedAction {
  name?: unknown;
  args?: unknown;
}

type ApprovalDecision =
  | { type: "approve" }
  | { type: "edit"; editedAction?: EditedAction }
  | { type: "reject"; message?: unknown };

export function aggregatePipelineWrites(pipeline: unknown): boolean {
  const parsed = unwrapJson(pipeline);
  if (typeof parsed === "string") {
    return unparsedPipelineMayWrite(parsed);
  }
  const stages = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed)
      ? [parsed]
      : null;
  if (!stages) return false;
  return stages.some(stageWrites);
}

export function aggregateCallNeedsApproval(
  request: AggregateToolRequest,
): boolean {
  const toolCall = request.toolCall;
  if (!toolCall || !AGGREGATE_WRITE_TOOLS.has(toolCall.name)) return false;
  return aggregatePipelineWrites(readPipeline(toolCall.args));
}

export async function guardAggregateWrite<
  TRequest extends AggregateToolRequest,
  TResult,
>(
  request: TRequest,
  handler: (request: TRequest) => TResult | Promise<TResult>,
): Promise<TResult | ToolMessage> {
  if (!aggregateCallNeedsApproval(request)) {
    return handler(request);
  }

  const toolCall = request.toolCall;
  if (!toolCall) return handler(request);

  const resumed = await interrupt({
    actionRequests: [
      {
        name: toolCall.name,
        args: toolArgsRecord(toolCall.args),
        description: describeWriteAggregate(toolCall.name, toolCall.args),
      },
    ],
    reviewConfigs: [
      {
        actionName: toolCall.name,
        allowedDecisions: [...ALLOWED_DECISIONS],
      },
    ],
  });
  const decision = readDecision(resumed, toolCall.name);

  if (decision.type === "approve") {
    return handler(request);
  }

  if (decision.type === "reject") {
    return rejectToolCall(toolCall, decision.message);
  }

  const edited = editedToolCall(toolCall, decision.editedAction);
  return handler({
    ...request,
    toolCall: edited,
  });
}

export const approveAggregateWritesMiddleware = createMiddleware({
  name: "approveAggregateWrites",
  wrapToolCall: async (request, handler) =>
    guardAggregateWrite(request, (next) => handler(next)),
});

const READ_ONLY_REJECTION =
  "This agent is read-only. $out and $merge write data and cannot be run.";

export async function rejectAggregateWrite<
  TRequest extends AggregateToolRequest,
  TResult,
>(
  request: TRequest,
  handler: (request: TRequest) => TResult | Promise<TResult>,
): Promise<TResult | ToolMessage> {
  if (!aggregateCallNeedsApproval(request)) {
    return handler(request);
  }

  const toolCall = request.toolCall;
  if (!toolCall?.id) {
    throw new Error(
      `Cannot reject "${toolCall?.name ?? "aggregate"}" without a tool call id.`,
    );
  }

  return new ToolMessage({
    content: `Tool "${toolCall.name}" was rejected. ${READ_ONLY_REJECTION}`,
    name: toolCall.name,
    tool_call_id: toolCall.id,
    status: "error",
  });
}

export const rejectAggregateWritesMiddleware = createMiddleware({
  name: "rejectAggregateWrites",
  wrapToolCall: async (request, handler) =>
    rejectAggregateWrite(request, (next) => handler(next)),
});

function describeWriteAggregate(name: string, args: unknown): string {
  return (
    `${DESCRIPTION_PREFIX}\n\n` +
    `Tool: ${name}\n` +
    "This aggregation includes a $out or $merge stage, which writes data.\n" +
    `Args: ${JSON.stringify(args, null, 2)}`
  );
}

function readPipeline(args: unknown): unknown {
  const record = asRecord(unwrapJson(args));
  if (!record || !("pipeline" in record)) return undefined;
  return record.pipeline;
}

function stageWrites(stage: unknown): boolean {
  const parsed = unwrapJson(stage);
  if (typeof parsed === "string") return unparsedPipelineMayWrite(parsed);
  if (Array.isArray(parsed)) return parsed.some(stageWrites);
  if (!isRecord(parsed)) return false;
  return Object.entries(parsed).some(
    ([key, value]) => WRITE_STAGE_KEYS.has(key) || stageWrites(value),
  );
}

function unparsedPipelineMayWrite(value: string): boolean {
  return /\$out\s*:/.test(value) || /\$merge\s*:/.test(value);
}

function unwrapJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  try {
    return unwrapJson(JSON.parse(trimmed));
  } catch {
    return value;
  }
}

function readDecision(value: unknown, toolName: string): ApprovalDecision {
  if (!isRecord(value) || !Array.isArray(value.decisions)) {
    throw new Error(
      `Aggregate write approval for "${toolName}" resumed without a decision.`,
    );
  }
  if (value.decisions.length !== 1) {
    throw new Error(
      `Aggregate write approval for "${toolName}" requires exactly one decision.`,
    );
  }
  const decision = value.decisions[0];
  if (!isRecord(decision) || typeof decision.type !== "string") {
    throw new Error(
      `Aggregate write approval for "${toolName}" received an invalid decision.`,
    );
  }
  if (decision.type === "approve") return { type: "approve" };
  if (decision.type === "reject") return { type: "reject", message: decision.message };
  if (decision.type === "edit") {
    return { type: "edit", editedAction: decision.editedAction as EditedAction };
  }
  throw new Error(
    `Unexpected human decision for "${toolName}": ${JSON.stringify(decision)}. ` +
      `Expected one of ${JSON.stringify([...ALLOWED_DECISIONS])}.`,
  );
}

function rejectToolCall(
  toolCall: AggregateToolCall,
  message: unknown,
): ToolMessage {
  if (!toolCall.id) {
    throw new Error(
      `Cannot reject "${toolCall.name}" without a tool call id.`,
    );
  }
  if (message !== undefined && typeof message !== "string") {
    throw new Error(
      `Tool call response for "${toolCall.name}" must be a string, got ${typeof message}`,
    );
  }
  return new ToolMessage({
    content:
      message ??
      `User rejected the tool call for \`${toolCall.name}\` with id ${toolCall.id}`,
    name: toolCall.name,
    tool_call_id: toolCall.id,
    status: "error",
  });
}

function editedToolCall(
  toolCall: AggregateToolCall,
  editedAction: EditedAction | undefined,
): AggregateToolCall {
  if (!editedAction || typeof editedAction.name !== "string") {
    throw new Error(
      `Invalid edited action for tool "${toolCall.name}": name must be a string`,
    );
  }
  if (!isRecord(editedAction.args)) {
    throw new Error(
      `Invalid edited action for tool "${toolCall.name}": args must be an object`,
    );
  }
  return {
    ...toolCall,
    name: editedAction.name,
    args: editedAction.args,
  };
}

function toolArgsRecord(args: unknown): Record<string, unknown> {
  const parsed = unwrapJson(args);
  return isRecord(parsed) ? parsed : {};
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
