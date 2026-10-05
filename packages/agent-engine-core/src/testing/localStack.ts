/**
 * Client for lite full-stack tests against a local `agentengine dev` stack.
 * Atlas Explorer and Atlas Query Insights import this from the testing export.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { MongoDBSaver } from "@langchain/langgraph-checkpoint-mongodb";
import { MongoClient } from "mongodb";

const execFileAsync = promisify(execFile);

export const DEFAULT_OE_URL = "http://127.0.0.1:8000";
export const DEFAULT_STORE_DB = "atlas_explorer";
export const CHECKPOINTS_COLLECTION = "checkpoints";
export const LIST_DATABASES_TOOL = "mongodb__list_databases";
export const DROP_COLLECTION_TOOL = "mongodb__drop_collection";

const HEALTH_TIMEOUT_MS = 120_000;
const HEALTH_INTERVAL_MS = 2_000;
const INVOKE_TIMEOUT_MS = 280_000;

export type ReviewDecision =
  | { type: "approve" }
  | { type: "reject"; message?: string };

export interface ClientUser {
  id?: string;
  username?: string;
  full_name?: string;
  actor_id?: string;
}

export interface AgentInterrupt {
  id: string;
  actionRequests: Array<{
    name: string;
    args: Record<string, unknown>;
    description?: string;
  }>;
}

export type InvocationResult =
  | {
      kind: "completed";
      response: string;
      sessionId: string;
      executionId?: string;
    }
  | {
      kind: "suspended";
      sessionId: string;
      executionId: string;
      interrupts: AgentInterrupt[];
    };

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
  options?: { fetchFn?: typeof fetch; baseUrl?: string; timeoutMs?: number },
): Promise<InvocationResult> {
  const message = input.message.trim();
  if (!message) {
    throw new LocalStackError("Agent message cannot be empty", 0, "INVALID_INPUT");
  }
  return postOe(
    {
      message,
      wait: true,
      ...(input.sessionId ? { session_id: input.sessionId } : {}),
      user_id: input.actorId ?? "stack-test:ci",
      ...clientUserBody(input),
    },
    input.sessionId,
    options,
  );
}

export async function resume(
  input: ResumeInput,
  options?: { fetchFn?: typeof fetch; baseUrl?: string; timeoutMs?: number },
): Promise<InvocationResult> {
  return postOe(
    {
      session_id: input.sessionId,
      user_id: input.actorId ?? "stack-test:ci",
      wait: true,
      resume_map: buildResumeMap(input),
      ...clientUserBody(input),
    },
    input.sessionId,
    options,
  );
}

export function buildResumeMap(input: ResumeInput): Record<string, unknown> {
  const entries = [
    { interruptId: input.interruptId, decision: input.decision },
    ...(input.additionalInterrupts ?? []),
  ];
  return Object.fromEntries(
    entries.map(({ interruptId, decision }) => [
      interruptId,
      { decisions: [decision] },
    ]),
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
    "Could not resolve the local Magenta MongoDB URI. Set AGENTENGINE_MONGODB_URI or start the stack with `agentengine dev up --headless`.",
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

export function parseInvokeResponse(
  raw: unknown,
  httpStatus: number,
  headerSessionId: string | null,
): InvocationResult {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new LocalStackError(
      `Agentic API returned an invalid response (HTTP ${httpStatus})`,
      httpStatus,
      "INVALID_RESPONSE",
    );
  }
  const data = raw as Record<string, unknown>;
  if (httpStatus >= 400 || data.success === false) {
    throw new LocalStackError(
      stringField(data.error) ??
        `Agentic API request failed (HTTP ${httpStatus})`,
      httpStatus,
      stringField(data.code),
    );
  }
  const sessionId =
    stringField(data.session_id) ?? headerSessionId ?? undefined;
  if (!sessionId) {
    throw new LocalStackError(
      "Agentic API returned an invalid response without a session ID",
      httpStatus,
      "INVALID_RESPONSE",
    );
  }
  const status = stringField(data.status);
  if (status === "error" || status === "cancelled") {
    throw new LocalStackError(
      stringField(data.error) ?? `Agentic execution ${status}`,
      httpStatus,
      status === "error" ? "EXECUTION_ERROR" : "EXECUTION_CANCELLED",
    );
  }
  const completedOutput =
    data.response !== undefined
      ? formatAgentResult(data.response)
      : formatAgentResult(data.result);
  if (status === "completed" || (status === undefined && completedOutput !== undefined)) {
    if (completedOutput === undefined) {
      throw new LocalStackError(
        "Agentic API returned an invalid response without agent output",
        httpStatus,
        "INVALID_RESPONSE",
      );
    }
    return {
      kind: "completed",
      response: completedOutput,
      sessionId,
      ...(stringField(data.execution_id)
        ? { executionId: stringField(data.execution_id) }
        : {}),
    };
  }
  if (status === "suspended") {
    const executionId = stringField(data.execution_id);
    const interrupts = parseInterrupts(data.suspend_context);
    if (!executionId) {
      throw new LocalStackError(
        "Agentic API returned a suspended execution without an execution ID",
        httpStatus,
        "INVALID_RESPONSE",
      );
    }
    if (!interrupts.length) {
      throw new LocalStackError(
        "Agentic API returned a suspended execution without interrupt details",
        httpStatus,
        "INVALID_RESPONSE",
      );
    }
    return { kind: "suspended", sessionId, executionId, interrupts };
  }
  throw new LocalStackError(
    `Agentic API returned unsupported execution status: ${status ?? "missing"}`,
    httpStatus,
    "INVALID_RESPONSE",
  );
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

async function postOe(
  body: Record<string, unknown>,
  sessionId: string | undefined,
  options?: { fetchFn?: typeof fetch; baseUrl?: string; timeoutMs?: number },
): Promise<InvocationResult> {
  const base = options?.baseUrl ?? oeUrl();
  const fetchFn = options?.fetchFn ?? fetch;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (sessionId) {
    headers["X-Session-ID"] = sessionId;
  }
  let response: Response;
  try {
    response = await fetchFn(`${base}/invoke`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(options?.timeoutMs ?? INVOKE_TIMEOUT_MS),
    });
  } catch (error) {
    throw new LocalStackError(
      error instanceof Error ? error.message : "Agentic request failed",
      0,
      "REQUEST_FAILED",
    );
  }
  const rawBody = await response.text();
  let raw: unknown = {};
  if (rawBody) {
    try {
      raw = JSON.parse(rawBody);
    } catch {
      throw new LocalStackError(
        `Agentic API returned non-JSON content (HTTP ${response.status})`,
        response.status,
        "INVALID_RESPONSE",
      );
    }
  }
  return parseInvokeResponse(
    raw,
    response.status,
    response.headers.get("X-Session-ID"),
  );
}

function clientUserBody(input: {
  client?: string;
  user?: ClientUser;
}): Record<string, unknown> {
  return {
    ...(input.client !== undefined ? { client: input.client } : {}),
    ...(input.user !== undefined ? { user: input.user } : {}),
  };
}

function parseInterrupts(suspendContext: unknown): AgentInterrupt[] {
  const context = asRecord(suspendContext);
  const interrupts = context ? asArray(context.interrupts) : [];
  const parsed: AgentInterrupt[] = [];
  for (const interrupt of interrupts) {
    const record = asRecord(interrupt);
    const id = stringField(record?.id);
    const value = asRecord(record?.value) ?? record;
    const actionRequests = asArray(value?.actionRequests)
      .map((request) => asRecord(request))
      .filter((request): request is Record<string, unknown> => request !== undefined)
      .map((request) => ({
        name: stringField(request.name) ?? "",
        args: asRecord(request.args) ?? {},
        ...(stringField(request.description)
          ? { description: stringField(request.description) }
          : {}),
      }))
      .filter((request) => request.name.length > 0);
    if (id && actionRequests.length > 0) {
      parsed.push({ id, actionRequests });
    }
  }
  return parsed;
}

function formatAgentResult(result: unknown): string | undefined {
  if (result === undefined) {
    return undefined;
  }
  if (typeof result === "string") {
    return result;
  }
  const record = asRecord(result);
  if (typeof record?.content === "string") {
    return record.content;
  }
  if (typeof record?.response === "string") {
    return record.response;
  }
  return JSON.stringify(result);
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
