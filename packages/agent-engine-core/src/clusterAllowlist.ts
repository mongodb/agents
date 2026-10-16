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

import {
  ToolMessage,
  type ContentBlock,
  type MessageContent,
} from "@langchain/core/messages";
import { Command, isCommand } from "@langchain/langgraph";
import { createMiddleware } from "langchain";
import { z } from "zod";

const PROJECT_ID = /^[a-f0-9]{24}$/i;
const CLUSTER_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export const PARTIAL_LIST_NOTE =
  "Results are limited to the configured allowlist.";

export interface DataAccessProjectConfig {
  readonly clusterNames?: readonly string[];
}

export type DataAccessConfig = {
  readonly [projectId: string]: DataAccessProjectConfig;
};

export type ResolvedDataAccess = Readonly<
  Record<string, { readonly clusterNames?: readonly string[] }>
>;

interface ClusterToolCall {
  id?: string;
  name: string;
  args?: unknown;
}

interface ClusterToolRequest {
  toolCall?: ClusterToolCall;
}

const RAW_CONNECTION_TOOLS: ReadonlySet<string> = new Set([
  "mongodb__connect",
  "mongodb__switch_connection",
]);

const GLOBAL_ATLAS_TOOLS: ReadonlySet<string> = new Set([
  "mongodb__atlas_get_regions",
  "mongodb__atlas_list_orgs",
  "mongodb__atlas_list_projects",
]);

const PROJECT_CREATION_TOOLS: ReadonlySet<string> = new Set([
  "mongodb__atlas_create_project",
]);

const CLUSTER_REQUIRED_TOOLS: ReadonlySet<string> = new Set([
  "mongodb__remote_atlas_connect",
  "mongodb__atlas_connect_cluster",
  "mongodb__atlas_inspect_cluster",
  "mongodb__atlas_get_performance_advisor",
  "mongodb__atlas_pause_resume_cluster",
  "mongodb__atlas_upgrade_cluster",
  "mongodb__atlas_create_cluster",
]);

/**
 * Validates and normalizes the optional `dataAccess` map from config.
 *
 * - `undefined` or `{}` returns `undefined` (unrestricted).
 * - `{ [projectId]: {} }` (`clusterNames` omitted) allows all clusters in that
 *   project.
 * - `{ [projectId]: { clusterNames: [] } }` allows the project and no clusters
 *   in that project.
 * - `{ [projectId]: { clusterNames: ["cluster-a"] } }` allows only the listed
 *   clusters in that project.
 */
export function resolveDataAccess(
  input?: DataAccessConfig,
): ResolvedDataAccess | undefined {
  if (!input) return undefined;
  const entries = Object.entries(input);
  if (entries.length === 0) return undefined;

  const resolved: Record<string, { readonly clusterNames?: readonly string[] }> =
    {};

  for (const [rawProjectId, projectConfig] of entries) {
    const projectId = rawProjectId.trim();
    if (!PROJECT_ID.test(projectId)) {
      throw new Error(
        `projectId must be a 24-character hex string, received "${rawProjectId}"`,
      );
    }
    if (!isRecord(projectConfig)) {
      throw new Error(
        `dataAccess entry for project "${projectId}" must be an object`,
      );
    }

    if (projectConfig.clusterNames === undefined) {
      resolved[projectId] = {};
      continue;
    }

    if (!Array.isArray(projectConfig.clusterNames)) {
      throw new Error(
        `clusterNames for project "${projectId}" must be an array when provided`,
      );
    }

    const seen = new Set<string>();
    const clusterNames: string[] = [];
    for (const rawCluster of projectConfig.clusterNames) {
      const clusterName =
        typeof rawCluster === "string" ? rawCluster.trim() : "";
      if (!CLUSTER_NAME.test(clusterName)) {
        throw new Error(
          `clusterName must be 1-64 letters, numbers, underscores, or hyphens, received "${String(rawCluster)}"`,
        );
      }
      if (!seen.has(clusterName)) {
        seen.add(clusterName);
        clusterNames.push(clusterName);
      }
    }
    resolved[projectId] = { clusterNames };
  }

  return resolved;
}

/**
 * Formats a human-readable summary of the allowed projects and clusters for
 * agent system prompts. Returns `undefined` when `dataAccess` is empty.
 */
export function describeDataAccess(
  dataAccess?: DataAccessConfig,
): string | undefined {
  const resolved = resolveDataAccess(dataAccess);
  if (!resolved) return undefined;

  const entries = Object.entries(resolved);
  if (entries.length === 1) {
    const [projectId, config] = entries[0]!;
    if (config.clusterNames === undefined) {
      return `Access is limited to project ${projectId} (all clusters).`;
    }
    if (config.clusterNames.length === 0) {
      return `Access is limited to project ${projectId} (no clusters allowed).`;
    }
    if (config.clusterNames.length === 1) {
      return `Access is limited to cluster ${config.clusterNames[0]} in project ${projectId}.`;
    }
    return `Access is limited to clusters ${config.clusterNames.join(", ")} in project ${projectId}.`;
  }

  const lines = entries.map(([projectId, config]) => {
    if (config.clusterNames === undefined) {
      return `- Project ${projectId}: all clusters`;
    }
    if (config.clusterNames.length === 0) {
      return `- Project ${projectId}: no clusters allowed`;
    }
    if (config.clusterNames.length === 1) {
      return `- Project ${projectId}: cluster ${config.clusterNames[0]}`;
    }
    return `- Project ${projectId}: clusters ${config.clusterNames.join(", ")}`;
  });

  return `Access is limited to the following Atlas projects and clusters:\n${lines.join("\n")}`;
}

export async function guardClusterCall<
  TRequest extends ClusterToolRequest,
  TResult,
>(
  resolved: ResolvedDataAccess | undefined,
  request: TRequest,
  handler: (request: TRequest) => TResult | Promise<TResult>,
): Promise<TResult | ToolMessage> {
  if (!resolved) {
    return handler(request);
  }

  const toolCall = request.toolCall;
  if (!toolCall || !toolCall.name.startsWith("mongodb__")) {
    return handler(request);
  }

  const inputError = checkToolInput(resolved, toolCall);
  if (inputError !== null) {
    return rejectToolCall(toolCall, inputError);
  }

  const result = await handler(request);
  return filterToolOutput(resolved, toolCall, result);
}

export function clusterAllowlistMiddleware(dataAccess?: DataAccessConfig) {
  const resolved = resolveDataAccess(dataAccess);
  return createMiddleware({
    name: "clusterAllowlist",
    wrapToolCall: async (request, handler) =>
      guardClusterCall(resolved, request, (next) => handler(next)),
  });
}

function checkToolInput(
  resolved: ResolvedDataAccess,
  toolCall: ClusterToolCall,
): string | null {
  const { name } = toolCall;

  if (RAW_CONNECTION_TOOLS.has(name)) {
    return (
      `Tool "${name}" is not allowed when dataAccess is configured. ` +
      'Use "mongodb__remote_atlas_connect" with an allowed projectId and clusterName.'
    );
  }

  if (PROJECT_CREATION_TOOLS.has(name)) {
    return `Tool "${name}" is not allowed when dataAccess restricts the agent to specific projects.`;
  }

  if (
    !name.startsWith("mongodb__atlas_") &&
    !CLUSTER_REQUIRED_TOOLS.has(name) &&
    noClustersAllowedAnywhere(resolved)
  ) {
    return `Tool "${name}" was rejected: no clusters are allowed in the configured dataAccess allowlist.`;
  }

  const args = toolArgsRecord(toolCall.args);
  const rawProjectId =
    typeof args.projectId === "string" ? args.projectId.trim() : undefined;
  const requiresProject =
    (name.startsWith("mongodb__atlas_") && !GLOBAL_ATLAS_TOOLS.has(name)) ||
    CLUSTER_REQUIRED_TOOLS.has(name) ||
    args.clusterName !== undefined;

  if (rawProjectId !== undefined && rawProjectId !== "") {
    if (!Object.hasOwn(resolved, rawProjectId)) {
      return `Tool "${name}" was rejected: project "${rawProjectId}" is not in the configured dataAccess allowlist.`;
    }
  } else if (requiresProject) {
    return `Tool "${name}" was rejected: a projectId from the configured dataAccess allowlist is required.`;
  }

  const projectConfig =
    rawProjectId !== undefined ? resolved[rawProjectId] : undefined;
  if (!projectConfig) {
    return null;
  }

  if (name === "mongodb__atlas_create_free_cluster") {
    const freeClusterName =
      typeof args.name === "string" ? args.name.trim() : "";
    if (!freeClusterName) {
      return `Tool "${name}" was rejected: a cluster name from the configured dataAccess allowlist is required.`;
    }
    return checkClusterAllowed(
      name,
      rawProjectId!,
      projectConfig,
      freeClusterName,
    );
  }

  if (
    name === "mongodb__atlas_streams_build" ||
    name === "mongodb__atlas_streams_manage"
  ) {
    const connectionConfig = isRecord(args.connectionConfig)
      ? args.connectionConfig
      : undefined;
    const streamCluster =
      typeof connectionConfig?.clusterName === "string"
        ? connectionConfig.clusterName.trim()
        : undefined;
    if (args.connectionType === "Cluster" && !streamCluster) {
      return `Tool "${name}" was rejected: connectionConfig.clusterName from the configured dataAccess allowlist is required for Cluster connections.`;
    }
    if (streamCluster !== undefined && streamCluster !== "") {
      return checkClusterAllowed(
        name,
        rawProjectId!,
        projectConfig,
        streamCluster,
      );
    }
    return null;
  }

  if (name === "mongodb__atlas_load_sample_dataset") {
    if (
      projectConfig.clusterNames !== undefined &&
      projectConfig.clusterNames.length === 0
    ) {
      return `Tool "${name}" was rejected: no clusters are allowed in project "${rawProjectId!}".`;
    }
    const sampleCluster =
      typeof args.clusterName === "string" ? args.clusterName.trim() : "";
    const hasJobId =
      typeof args.jobId === "string" && args.jobId.trim().length > 0;
    if (sampleCluster) {
      return checkClusterAllowed(
        name,
        rawProjectId!,
        projectConfig,
        sampleCluster,
      );
    }
    if (!hasJobId && projectConfig.clusterNames !== undefined) {
      return `Tool "${name}" was rejected: a clusterName from the configured dataAccess allowlist is required.`;
    }
    return null;
  }

  if (name === "mongodb__atlas_create_db_user") {
    if (projectConfig.clusterNames !== undefined) {
      if (projectConfig.clusterNames.length === 0) {
        return `Tool "${name}" was rejected: no clusters are allowed in project "${rawProjectId!}".`;
      }
      if (!Array.isArray(args.clusters) || args.clusters.length === 0) {
        return `Tool "${name}" was rejected: clusters must be restricted to the configured dataAccess allowlist for project "${rawProjectId!}".`;
      }
      for (const entry of args.clusters) {
        const clusterName = typeof entry === "string" ? entry.trim() : "";
        const err = checkClusterAllowed(
          name,
          rawProjectId!,
          projectConfig,
          clusterName,
        );
        if (err !== null) return err;
      }
    }
    return null;
  }

  const rawClusterName =
    typeof args.clusterName === "string" ? args.clusterName.trim() : undefined;

  if (rawClusterName !== undefined && rawClusterName !== "") {
    return checkClusterAllowed(
      name,
      rawProjectId!,
      projectConfig,
      rawClusterName,
    );
  }

  if (CLUSTER_REQUIRED_TOOLS.has(name)) {
    return `Tool "${name}" was rejected: a clusterName from the configured dataAccess allowlist is required.`;
  }

  return null;
}

function noClustersAllowedAnywhere(resolved: ResolvedDataAccess): boolean {
  const configs = Object.values(resolved);
  return (
    configs.length > 0 &&
    configs.every(
      (cfg) => cfg.clusterNames !== undefined && cfg.clusterNames.length === 0,
    )
  );
}

function checkClusterAllowed(
  toolName: string,
  projectId: string,
  projectConfig: { readonly clusterNames?: readonly string[] },
  clusterName: string,
): string | null {
  if (projectConfig.clusterNames === undefined) {
    return null;
  }
  if (projectConfig.clusterNames.length === 0) {
    return `Tool "${toolName}" was rejected: no clusters are allowed in project "${projectId}".`;
  }
  if (!projectConfig.clusterNames.includes(clusterName)) {
    return `Tool "${toolName}" was rejected: cluster "${clusterName}" is not in the configured dataAccess allowlist for project "${projectId}".`;
  }
  return null;
}

const commandUpdateSchema = z
  .object({
    messages: z.array(z.unknown()),
  })
  .passthrough();

function filterToolOutput<TResult>(
  resolved: ResolvedDataAccess,
  toolCall: ClusterToolCall,
  result: TResult,
): TResult | ToolMessage {
  const { name } = toolCall;
  if (
    name !== "mongodb__atlas_list_clusters" &&
    name !== "mongodb__atlas_list_projects"
  ) {
    return result;
  }

  if (ToolMessage.isInstance(result)) {
    return filterToolMessage(resolved, toolCall, result);
  }

  if (isCommand(result)) {
    const parsed = commandUpdateSchema.safeParse(result.update);
    if (!parsed.success) return result;
    let changed = false;
    const messages = parsed.data.messages.map((entry) => {
      if (!ToolMessage.isInstance(entry)) return entry;
      const filtered = filterToolMessage(resolved, toolCall, entry);
      if (filtered !== entry) changed = true;
      return filtered;
    });
    if (!changed) return result;
    return new Command({
      graph: result.graph,
      update: { ...parsed.data, messages },
      resume: result.resume,
      goto: result.goto,
    }) as TResult;
  }

  return result;
}

function filterToolMessage(
  resolved: ResolvedDataAccess,
  toolCall: ClusterToolCall,
  message: ToolMessage,
): ToolMessage {
  if (message.status === "error") {
    return message;
  }

  const args = toolArgsRecord(toolCall.args);
  const projectId =
    typeof args.projectId === "string" ? args.projectId.trim() : "";

  const outcome = transformListMessageContent(
    toolCall.name,
    resolved,
    projectId,
    message.content,
  );

  if (outcome.kind === "error") {
    return new ToolMessage({
      id: message.id,
      name: message.name ?? toolCall.name,
      content: outcome.message,
      tool_call_id: message.tool_call_id,
      status: "error",
      additional_kwargs: message.additional_kwargs,
      response_metadata: message.response_metadata,
    });
  }

  if (!outcome.changed) {
    return message;
  }

  return new ToolMessage({
    id: message.id,
    name: message.name,
    content: outcome.content,
    tool_call_id: message.tool_call_id,
    status: message.status,
    artifact: message.artifact,
    additional_kwargs: message.additional_kwargs,
    response_metadata: message.response_metadata,
  });
}

type TransformOutcome =
  | { kind: "ok"; content: MessageContent; changed: boolean }
  | { kind: "error"; message: string };

const mcpNormalizedEnvelopeSchema = z
  .object({
    content: z.array(
      z
        .object({
          type: z.string(),
          text: z.string().optional(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

function transformListMessageContent(
  toolName: string,
  resolved: ResolvedDataAccess,
  projectId: string,
  content: MessageContent,
): TransformOutcome {
  if (typeof content === "string") {
    const trimmed = content.trim();
    if (trimmed.startsWith("{")) {
      try {
        const parsed = JSON.parse(trimmed);
        const envelope = mcpNormalizedEnvelopeSchema.safeParse(parsed);
        if (envelope.success) {
          const blockOutcome = transformTextBlocks(
            toolName,
            resolved,
            projectId,
            envelope.data.content,
          );
          if (blockOutcome.kind === "error") return blockOutcome;
          if (!blockOutcome.changed) {
            return { kind: "ok", content, changed: false };
          }
          return {
            kind: "ok",
            content: JSON.stringify({
              ...envelope.data,
              content: blockOutcome.blocks,
            }),
            changed: true,
          };
        }
      } catch {
        // Fall through to plain-string handling below.
      }
    }

    const stringOutcome = transformCombinedText(
      toolName,
      resolved,
      projectId,
      content,
    );
    if (stringOutcome.kind === "error") return stringOutcome;
    return {
      kind: "ok",
      content: stringOutcome.text,
      changed: stringOutcome.changed,
    };
  }

  if (Array.isArray(content)) {
    const blockOutcome = transformTextBlocks(
      toolName,
      resolved,
      projectId,
      content as Array<Record<string, unknown>>,
    );
    if (blockOutcome.kind === "error") return blockOutcome;
    if (!blockOutcome.changed) {
      return { kind: "ok", content, changed: false };
    }
    return {
      kind: "ok",
      content: blockOutcome.blocks as ContentBlock[],
      changed: true,
    };
  }

  return {
    kind: "error",
    message: `Tool "${toolName}" returned an unrecognized output format and was blocked by the clusterAllowlist middleware.`,
  };
}

function transformTextBlocks<TBlock extends Record<string, unknown>>(
  toolName: string,
  resolved: ResolvedDataAccess,
  projectId: string,
  blocks: readonly TBlock[],
):
  | { kind: "ok"; blocks: TBlock[]; changed: boolean }
  | { kind: "error"; message: string } {
  const textIndices: number[] = [];
  const texts: string[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (block && block.type === "text" && typeof block.text === "string") {
      textIndices.push(i);
      texts.push(block.text);
    }
  }

  if (texts.length === 0) {
    return {
      kind: "error",
      message: `Tool "${toolName}" returned no text content and was blocked by the clusterAllowlist middleware.`,
    };
  }

  const separator = "\n__CLUSTER_ALLOWLIST_BLOCK_BOUNDARY__\n";
  const combined = texts.join(separator);
  const outcome = transformCombinedText(
    toolName,
    resolved,
    projectId,
    combined,
  );
  if (outcome.kind === "error") return outcome;
  if (!outcome.changed) {
    return { kind: "ok", blocks: [...blocks], changed: false };
  }

  const splitTexts = outcome.text.split(separator);
  if (splitTexts.length !== textIndices.length) {
    const singleBlock = {
      ...blocks[textIndices[0]!],
      type: "text",
      text: outcome.text,
    } as TBlock;
    return { kind: "ok", blocks: [singleBlock], changed: true };
  }

  const nextBlocks = blocks.map((block) => ({ ...block }));
  for (let idx = 0; idx < textIndices.length; idx++) {
    const blockIndex = textIndices[idx]!;
    nextBlocks[blockIndex] = {
      ...nextBlocks[blockIndex]!,
      text: splitTexts[idx]!,
    };
  }
  return { kind: "ok", blocks: nextBlocks, changed: true };
}

const UNTRUSTED_TAG_PATTERN =
  /(<untrusted-user-data-([A-Za-z0-9-]+)>\s*)([\s\S]*?)(\s*<\/untrusted-user-data-\2>)/g;

function findUntrustedPayloadMatch(text: string): RegExpExecArray | null {
  UNTRUSTED_TAG_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = UNTRUSTED_TAG_PATTERN.exec(text)) !== null) {
    const inner = match[3]?.trim() ?? "";
    if (inner !== "and") {
      return match;
    }
  }
  return null;
}

function transformCombinedText(
  toolName: string,
  resolved: ResolvedDataAccess,
  projectId: string,
  text: string,
):
  | { kind: "ok"; text: string; changed: boolean }
  | { kind: "error"; message: string } {
  const tagMatch = findUntrustedPayloadMatch(text);

  if (
    toolName === "mongodb__atlas_list_clusters" &&
    /\bNo clusters found\b/i.test(text) &&
    !tagMatch
  ) {
    return { kind: "ok", text, changed: false };
  }
  if (
    toolName === "mongodb__atlas_list_projects" &&
    /\bNo projects found\b/i.test(text) &&
    !tagMatch
  ) {
    return { kind: "ok", text, changed: false };
  }

  if (tagMatch) {
    const [fullMatch, openTag, , rawJson, closeTag] = tagMatch;
    const filtered = filterJsonPayload(toolName, resolved, projectId, rawJson!);
    if (filtered.kind === "error") return filtered;
    if (!filtered.removed) {
      return { kind: "ok", text, changed: false };
    }

    const updatedTagSection = `${openTag}${filtered.serialized}${closeTag}`;
    const before = text.slice(0, tagMatch.index);
    const after = text.slice(tagMatch.index + fullMatch.length);
    const replaced = `${before}${updatedTagSection}${after}`;
    const rewritten =
      toolName === "mongodb__atlas_list_clusters"
        ? replaced.replace(
            /Found \d+ clusters?\b/,
            `Found ${filtered.remainingCount} clusters`,
          )
        : replaced.replace(
            /Found \d+ projects?\b/,
            `Found ${filtered.remainingCount} projects`,
          );
    const updatedText = `${rewritten}\n\n${PARTIAL_LIST_NOTE}`;
    return { kind: "ok", text: updatedText, changed: true };
  }

  const filtered = filterJsonPayload(
    toolName,
    resolved,
    projectId,
    text.trim(),
  );
  if (filtered.kind === "error") return filtered;
  if (!filtered.removed) {
    return { kind: "ok", text, changed: false };
  }
  return {
    kind: "ok",
    text: `${filtered.serialized}\n\n${PARTIAL_LIST_NOTE}`,
    changed: true,
  };
}

type FilterJsonOutcome =
  | {
      kind: "ok";
      serialized: string;
      removed: boolean;
      remainingCount: number;
    }
  | { kind: "error"; message: string };

function filterJsonPayload(
  toolName: string,
  resolved: ResolvedDataAccess,
  projectId: string,
  rawJson: string,
): FilterJsonOutcome {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return {
      kind: "error",
      message: `Tool "${toolName}" returned an unrecognized output format and was blocked by the clusterAllowlist middleware.`,
    };
  }

  if (toolName === "mongodb__atlas_list_clusters") {
    if (!isRecord(parsed) || !Array.isArray(parsed.clusters)) {
      return {
        kind: "error",
        message: `Tool "${toolName}" returned an unrecognized cluster list shape and was blocked by the clusterAllowlist middleware.`,
      };
    }

    for (const entry of parsed.clusters) {
      if (!isRecord(entry) || typeof entry.name !== "string") {
        return {
          kind: "error",
          message: `Tool "${toolName}" returned an invalid cluster entry and was blocked by the clusterAllowlist middleware.`,
        };
      }
    }

    const projectConfig = resolved[projectId];
    if (!projectConfig || projectConfig.clusterNames === undefined) {
      return {
        kind: "ok",
        serialized: rawJson,
        removed: false,
        remainingCount: parsed.clusters.length,
      };
    }

    const allowedSet = new Set(projectConfig.clusterNames);
    const filteredClusters = parsed.clusters.filter(
      (entry) => isRecord(entry) && typeof entry.name === "string" && allowedSet.has(entry.name),
    );
    const removed = filteredClusters.length < parsed.clusters.length;
    const isPretty = rawJson.includes("\n");
    const serialized = JSON.stringify(
      { ...parsed, clusters: filteredClusters },
      null,
      isPretty ? 2 : undefined,
    );
    return {
      kind: "ok",
      serialized,
      removed,
      remainingCount: filteredClusters.length,
    };
  }

  if (!Array.isArray(parsed)) {
    return {
      kind: "error",
      message: `Tool "${toolName}" returned an unrecognized project list shape and was blocked by the clusterAllowlist middleware.`,
    };
  }

  for (const entry of parsed) {
    if (!isRecord(entry) || typeof entry.id !== "string") {
      return {
        kind: "error",
        message: `Tool "${toolName}" returned an invalid project entry and was blocked by the clusterAllowlist middleware.`,
      };
    }
  }

  const filteredProjects = parsed.filter(
    (entry) =>
      isRecord(entry) &&
      typeof entry.id === "string" &&
      Object.hasOwn(resolved, entry.id),
  );
  const removed = filteredProjects.length < parsed.length;
  const isPretty = rawJson.includes("\n");
  const serialized = JSON.stringify(
    filteredProjects,
    null,
    isPretty ? 2 : undefined,
  );
  return {
    kind: "ok",
    serialized,
    removed,
    remainingCount: filteredProjects.length,
  };
}

function rejectToolCall(toolCall: ClusterToolCall, reason: string): ToolMessage {
  if (!toolCall.id) {
    throw new Error(
      `Cannot reject "${toolCall.name}" without a tool call id.`,
    );
  }
  return new ToolMessage({
    content: reason,
    name: toolCall.name,
    tool_call_id: toolCall.id,
    status: "error",
  });
}

function toolArgsRecord(args: unknown): Record<string, unknown> {
  const parsed = unwrapJson(args);
  return isRecord(parsed) ? parsed : {};
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
