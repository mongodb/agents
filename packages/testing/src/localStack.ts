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

/**
 * Helpers for lite full-stack tests against a local `agentengine dev` stack.
 * Invoke and resume go through `AgentEngineClient` (`invokeTarget: "local"`).
 * Atlas Explorer and Atlas Query Insights import this from the testing export.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { MongoDBSaver } from "@langchain/langgraph-checkpoint-mongodb";
import { MongoClient } from "mongodb";
import {
  AgentEngineClient,
  type AgentInterrupt,
  type ClientUserMetadata,
  type InvocationResult,
  type ReviewDecision,
} from "@repo/agent-engine-chat/agent-engine";

const execFileAsync = promisify(execFile);

export const DEFAULT_OE_URL = "http://127.0.0.1:8000";
export const DEFAULT_STORE_DB = "atlas_explorer";
export const CHECKPOINTS_COLLECTION = "checkpoints";
export const LIST_DATABASES_TOOL = "mongodb__list_databases";
export const DROP_COLLECTION_TOOL = "mongodb__drop_collection";

const HEALTH_TIMEOUT_MS = 120_000;
const HEALTH_INTERVAL_MS = 2_000;
const DEFAULT_ACTOR_ID = "stack-test:ci";

export type { AgentInterrupt, InvocationResult, ReviewDecision };
export type ClientUser = ClientUserMetadata;

export interface InvokeInput {
  message: string;
  sessionId?: string;
  actorId?: string;
  client?: string;
  user?: ClientUser;
}

export interface ResumeInput {
  sessionId: string;
  interruptId: string;
  decision: ReviewDecision;
  actorId?: string;
  client?: string;
  user?: ClientUser;
  additionalInterrupts?: Array<{
    interruptId: string;
    decision: ReviewDecision;
  }>;
}

export interface ToolCallRecord {
  name: string;
  args?: unknown;
}

export interface ToolResultRecord {
  name: string;
  status?: string;
  content: string;
}

export interface StackCheckpoints {
  threadId: string;
  requester?: unknown;
  humanContents: string[];
  toolCalls: ToolCallRecord[];
  toolResults: ToolResultRecord[];
}

export class LocalStackError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status = 0, code?: string) {
    super(message);
    this.name = "LocalStackError";
    this.status = status;
    this.code = code;
  }
}

export function oeUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (env.AGENTENGINE_OE_URL ?? DEFAULT_OE_URL).replace(/\/+$/, "");
}

export function storeDbName(env: NodeJS.ProcessEnv = process.env): string {
  return env.MDB_AGENTIC_STORE_DB?.trim() || DEFAULT_STORE_DB;
}

export function isWriteMcpTool(
  name: string,
  readOnlyTools: ReadonlySet<string>,
): boolean {
  return name.startsWith("mongodb__") && !readOnlyTools.has(name);
}

export async function waitForHealthy(options?: {
  url?: string;
  timeoutMs?: number;
  intervalMs?: number;
  fetchFn?: typeof fetch;
  stackLabel?: string;
}): Promise<void> {
  const base = options?.url ?? oeUrl();
  const timeoutMs = options?.timeoutMs ?? HEALTH_TIMEOUT_MS;
  const intervalMs = options?.intervalMs ?? HEALTH_INTERVAL_MS;
  const fetchFn = options?.fetchFn ?? fetch;
  const deadline = Date.now() + timeoutMs;
  let lastError = "no response";

  while (Date.now() < deadline) {
    try {
      const response = await fetchFn(`${base}/health`, {
        signal: AbortSignal.timeout(3_000),
      });
      if (response.ok) {
        return;
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(intervalMs);
  }

  const stackLabel = options?.stackLabel ?? "the agent directory";
  throw new LocalStackError(
    `Orchestration Engine at ${base} is not healthy (${lastError}). Start it with \`agentengine dev up --headless\` from ${stackLabel}.`,
  );
}

export async function invoke(
  input: InvokeInput,
  options?: StackClientOptions,
): Promise<InvocationResult> {
  return stackClient(options).invoke({
    message: input.message,
    actorId: input.actorId ?? DEFAULT_ACTOR_ID,
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    ...(input.client !== undefined ? { client: input.client } : {}),
    ...(input.user !== undefined ? { user: input.user } : {}),
  });
}

export async function resume(
  input: ResumeInput,
  options?: StackClientOptions,
): Promise<InvocationResult> {
  return stackClient(options).resume({
    sessionId: input.sessionId,
    interruptId: input.interruptId,
    decision: input.decision,
    actorId: input.actorId ?? DEFAULT_ACTOR_ID,
    ...(input.additionalInterrupts
      ? { additionalInterrupts: input.additionalInterrupts }
      : {}),
    ...(input.client !== undefined ? { client: input.client } : {}),
    ...(input.user !== undefined ? { user: input.user } : {}),
  });
}

interface StackClientOptions {
  fetchFn?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
}

function stackClient(options?: StackClientOptions): AgentEngineClient {
  return new AgentEngineClient(
    {
      invokeTarget: "local",
      baseUrl: options?.baseUrl ?? oeUrl(),
    },
    {
      ...(options?.fetchFn ? { fetchFn: options.fetchFn } : {}),
      ...(options?.timeoutMs !== undefined
        ? { timeoutMs: options.timeoutMs }
        : {}),
    },
  );
}

export async function readCheckpoints(
  sessionId: string,
  options?: { uri?: string; dbName?: string },
): Promise<StackCheckpoints> {
  const uri = options?.uri ?? (await resolveMongodbUri());
  const dbName = options?.dbName ?? storeDbName();
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const saver = new MongoDBSaver({ client, dbName });
    const latest = await latestCheckpoint(saver, sessionId);
    const messages = latest ? messagesFromCheckpoint(latest.checkpoint) : [];
    const metadata = (latest?.metadata ?? {}) as Record<string, unknown>;
    let requester = metadata.requester;
    if (requester === undefined) {
      const raw = await client
        .db(dbName)
        .collection(CHECKPOINTS_COLLECTION)
        .find({ thread_id: sessionId })
        .sort({ _id: -1 })
        .limit(1)
        .next();
      const search = raw?.metadata_search;
      if (search && typeof search === "object" && "requester" in search) {
        requester = (search as { requester?: unknown }).requester;
      }
    }
    if (latest === undefined && requester === undefined && messages.length === 0) {
      throw new LocalStackError(
        `No checkpoints found for session ${sessionId} in ${dbName}.checkpoints`,
      );
    }
    return {
      threadId: sessionId,
      requester,
      humanContents: humanContentsFromMessages(messages),
      toolCalls: toolCallsFromMessages(messages),
      toolResults: toolResultsFromMessages(messages),
    };
  } finally {
    await client.close();
  }
}

export async function resolveMongodbUri(
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const fromEnv = env.AGENTENGINE_MONGODB_URI?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  const fromStatus = mongodbUriFromStatus(await readDevStatus());
  if (fromStatus) {
    return fromStatus;
  }
  const fromCompose = await mongodbUriFromComposePort();
  if (fromCompose) {
    return fromCompose;
  }
  throw new LocalStackError(
    "Could not resolve the local Atlas Agent Engine MongoDB URI. Set AGENTENGINE_MONGODB_URI or start the stack with `agentengine dev up --headless`.",
  );
}

export function mongodbUriFromStatus(status: unknown): string | undefined {
  const services = statusServices(status);
  for (const service of services) {
    const name = serviceName(service);
    if (!name.includes("mongo")) {
      continue;
    }
    for (const port of servicePorts(service)) {
      if (port.target === 27017 && port.published > 0) {
        return `mongodb://${normalizeHost(port.host)}:${port.published}/?directConnection=true`;
      }
    }
  }
  return undefined;
}

export function messagesFromCheckpoint(checkpoint: {
  channel_values?: unknown;
}): unknown[] {
  const values = asRecord(checkpoint.channel_values) ?? {};
  const start = asRecord(values["__start__"]);
  const fromMessages = asArray(values.messages);
  const fromStart = start ? asArray(start.messages) : [];
  return fromMessages.length > 0 ? fromMessages : fromStart;
}

export function humanContentsFromMessages(messages: unknown[]): string[] {
  return messages
    .filter((message) => messageType(message) === "human")
    .map((message) => contentText(messageContent(message)))
    .filter((text) => text.length > 0);
}

export function toolCallsFromMessages(messages: unknown[]): ToolCallRecord[] {
  const calls: ToolCallRecord[] = [];
  for (const message of messages) {
    for (const call of asArray(lookup(message, "tool_calls"))) {
      const record = asRecord(call);
      const name = stringField(record?.name);
      if (name) {
        calls.push({ name, args: record?.args });
      }
    }
  }
  return calls;
}

export function toolResultsFromMessages(messages: unknown[]): ToolResultRecord[] {
  const results: ToolResultRecord[] = [];
  for (const message of messages) {
    if (messageType(message) !== "tool") {
      continue;
    }
    const name = stringField(lookup(message, "name")) ?? "";
    results.push({
      name,
      status: stringField(lookup(message, "status")),
      content: contentText(messageContent(message)),
    });
  }
  return results;
}

async function latestCheckpoint(
  saver: MongoDBSaver,
  sessionId: string,
): Promise<Awaited<ReturnType<MongoDBSaver["getTuple"]>>> {
  for await (const tuple of saver.list(
    { configurable: { thread_id: sessionId } },
    { limit: 1 },
  )) {
    return tuple;
  }
  return saver.getTuple({
    configurable: { thread_id: sessionId, checkpoint_ns: "" },
  });
}

async function readDevStatus(): Promise<unknown> {
  try {
    const { stdout } = await execFileAsync(
      "agentengine",
      ["--no-log", "--quiet", "dev", "status", "--json"],
      { timeout: 15_000 },
    );
    return JSON.parse(stdout);
  } catch {
    return undefined;
  }
}

async function mongodbUriFromComposePort(): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync(
      "docker",
      [
        "compose",
        "-f",
        ".agentengine/docker-compose.dev.yml",
        "port",
        "mongodb",
        "27017",
      ],
      { timeout: 15_000 },
    );
    const match = stdout.trim().match(/:(\d+)\s*$/);
    if (!match) {
      return undefined;
    }
    return `mongodb://127.0.0.1:${match[1]}/?directConnection=true`;
  } catch {
    return undefined;
  }
}

function statusServices(status: unknown): Record<string, unknown>[] {
  if (Array.isArray(status)) {
    return status
      .map((service) => asRecord(service))
      .filter((service): service is Record<string, unknown> => service !== undefined);
  }
  const root = asRecord(status);
  if (!root) {
    return [];
  }
  return asArray(root.services)
    .map((service) => asRecord(service))
    .filter((service): service is Record<string, unknown> => service !== undefined);
}

function normalizeHost(host: string | undefined): string {
  if (!host || host === "0.0.0.0" || host === "::" || host === "[::]") {
    return "127.0.0.1";
  }
  return host;
}

function serviceName(service: Record<string, unknown>): string {
  return (
    stringField(service.name) ??
    stringField(service.Service) ??
    stringField(service.service) ??
    ""
  ).toLowerCase();
}

function servicePorts(
  service: Record<string, unknown>,
): Array<{ target: number; published: number; host?: string }> {
  const ports: Array<{ target: number; published: number; host?: string }> = [];
  for (const port of [
    ...asArray(service.ports),
    ...asArray(service.Publishers),
    ...asArray(service.publishers),
  ]) {
    const record = asRecord(port);
    if (!record) {
      continue;
    }
    const target =
      numberField(record.target) ??
      numberField(record.TargetPort) ??
      numberField(record.targetPort) ??
      0;
    const published =
      numberField(record.published) ??
      numberField(record.PublishedPort) ??
      numberField(record.publishedPort) ??
      0;
    const host =
      stringField(record.host_ip) ??
      stringField(record.URL) ??
      stringField(record.host);
    if (target && published) {
      ports.push({ target, published, host: host || undefined });
    }
  }
  return ports;
}

function messageType(message: unknown): string {
  const record = asRecord(message);
  if (!record) {
    return "";
  }
  const typed = record as { getType?: () => unknown };
  if (typeof typed.getType === "function") {
    return String(typed.getType() ?? "");
  }
  const direct = stringField(record.type);
  if (direct) {
    return direct;
  }
  const kwargs = asRecord(record.kwargs);
  return stringField(kwargs?.type) ?? "";
}

function messageContent(message: unknown): unknown {
  return lookup(message, "content");
}

function lookup(message: unknown, key: string): unknown {
  const record = asRecord(message);
  if (!record) {
    return undefined;
  }
  if (key in record) {
    return record[key];
  }
  const kwargs = asRecord(record.kwargs);
  if (kwargs && key in kwargs) {
    return kwargs[key];
  }
  const data = asRecord(record.data);
  if (data && key in data) {
    return data[key];
  }
  return undefined;
}

export function contentText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((block) => {
      if (typeof block === "string") {
        return block;
      }
      const record = asRecord(block);
      return typeof record?.text === "string" ? record.text : "";
    })
    .join("");
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberField(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
