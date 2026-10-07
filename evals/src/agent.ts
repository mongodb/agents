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

// Built output of the repo's own client (`npm run build-client`). Its source uses
// `.js` import specifiers that Node's type stripping can't map back to `.ts`, so use dist.
import {
  AgenticApiError,
  AgentEngineClient,
  type AccessTokenProvider,
  type InvocationProgress,
  type InvocationResult,
} from "../../packages/agent-engine-chat/dist/agent-engine/index.js";

import type { AgentEngineSettings } from "./config.ts";
import { readFileSync } from "node:fs";
import type { InterruptRecord, RunRecord, ToolEvent, TurnRecord, WorkspaceKey } from "./types.ts";


const ACTOR_ID = "eval:runner";
const CLIENT = "eval";
const USER = { id: "eval-runner", username: "eval-runner", actor_id: ACTOR_ID };

/** Rejections per turn before the rig gives up and records the turn as stuck. */
const MAX_REJECTIONS_PER_TURN = 3;

/** Waits between retries when the workspace is out of capacity (HTTP 503) or rate limited (429). */
const CAPACITY_BACKOFF_MS = process.env.EVAL_CAPACITY_BACKOFF_MS
  ? process.env.EVAL_CAPACITY_BACKOFF_MS.split(",").map(Number)
  : [5_000, 10_000, 20_000, 30_000, 45_000, 60_000, 60_000, 60_000];

function isCapacityError(error: unknown): boolean {
  return error instanceof AgenticApiError && (error.status === 503 || error.status === 429);
}

/**
 * Retries calls the platform turned away for capacity. Safe here: a 503 means the request
 * never ran, and the only resume the rig sends is a rejection, so resending it changes nothing.
 * Returns the time spent waiting so it can be left out of latency.
 */
async function withCapacityRetry<T>(call: () => Promise<T>): Promise<{ value: T; waitedMs: number; retries: number }> {
  let waitedMs = 0;
  for (let retries = 0; ; retries++) {
    try {
      return { value: await call(), waitedMs, retries };
    } catch (error) {
      const delay = CAPACITY_BACKOFF_MS[retries];
      if (!isCapacityError(error) || delay === undefined) throw error;
      const jittered = delay + Math.floor(Math.random() * Math.min(2_000, delay));
      await new Promise((resolve) => setTimeout(resolve, jittered));
      waitedMs += jittered;
    }
  }
}

class StaticTokenProvider implements AccessTokenProvider {
  private readonly token: string;
  constructor(token: string) {
    this.token = token;
  }
  getAccessToken(): Promise<string> {
    return Promise.resolve(this.token);
  }
  invalidate(): void {}
}

/** Read the current host's CLI login without copying its token into the rig's .env. */
class CliTokenProvider implements AccessTokenProvider {
  constructor(authFile: string, baseUrl: string) {
    this.authFile = authFile;
    this.baseUrl = baseUrl;
  }
  private readonly authFile: string;
  private readonly baseUrl: string;
  async getAccessToken(): Promise<string> {
    const state = JSON.parse(readFileSync(this.authFile, "utf8")) as {
      credentials?: Record<string, { access_token?: string }>;
    };
    const token = state.credentials?.[this.baseUrl]?.access_token;
    if (!token) throw new Error(`No CLI login for ${this.baseUrl}; run agentengine auth login for this host.`);
    return token;
  }
  invalidate(): void {}
}

export function createClients(settings: AgentEngineSettings): Partial<Record<WorkspaceKey, AgentEngineClient>> {
  const clients: Partial<Record<WorkspaceKey, AgentEngineClient>> = {};
  const serviceAccount =
    settings.auth.kind === "serviceAccount"
      ? { clientId: settings.auth.clientId, clientSecret: settings.auth.clientSecret }
      : { clientId: "unused", clientSecret: "unused" };
  const tokenProvider = settings.auth.kind === "apiKey"
    ? new StaticTokenProvider(settings.auth.apiKey)
    : settings.auth.kind === "cli"
      ? new CliTokenProvider(settings.auth.authFile, settings.baseUrl)
      : undefined;

  for (const [key, workspaceId] of Object.entries(settings.workspaces) as [WorkspaceKey, string][]) {
    clients[key] = new AgentEngineClient(
      {
        baseUrl: settings.baseUrl,
        invokeTarget: "gateway",
        projectId: settings.projectId,
        workspaceId,
        serviceAccount,
      },
      tokenProvider ? { tokenProvider } : {},
    );
  }
  return clients;
}

/** Error message plus its cause chain, so auth and network failures say what actually broke. */
function describeError(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current !== undefined && depth < 5; depth++) {
    if (current instanceof Error) {
      const status = (current as { status?: unknown }).status;
      parts.push(`${current.name}: ${current.message}${typeof status === "number" && status ? ` (HTTP ${status})` : ""}`);
      current = current.cause;
    } else {
      parts.push(String(current));
      break;
    }
  }
  return parts.join(" <- ");
}

export interface ConversationOutput {
  sessionId?: string;
  turns: TurnRecord[];
  tools: ToolEvent[];
  interrupts: InterruptRecord[];
  progress: RunRecord["progress"];
  error?: string;
}

/**
 * Sends each turn in one session over invokeStream. Every suspension is recorded and
 * immediately rejected, so nothing the agent asks to write is ever executed.
 */
export async function converse(
  client: AgentEngineClient,
  turns: readonly string[],
): Promise<ConversationOutput> {
  const output: ConversationOutput = { turns: [], tools: [], interrupts: [], progress: [] };
  let seq = 0;
  let sessionId: string | undefined;

  for (const [turnIndex, message] of turns.entries()) {
    const onProgress = (progress: InvocationProgress): void => {
      output.progress.push({ turn: turnIndex, ...progress });
      if (progress.toolName) {
        output.tools.push({
          toolName: progress.toolName,
          ...(progress.phase !== undefined ? { phase: progress.phase } : {}),
          ...(progress.status !== undefined ? { status: progress.status } : {}),
          turn: turnIndex,
          seq: seq++,
        });
      }
    };

    const started = performance.now();
    let suspensions = 0;
    let waitedMs = 0;
    let retries = 0;
    const call = async <T>(fn: () => Promise<T>): Promise<T> => {
      const outcome = await withCapacityRetry(fn);
      waitedMs += outcome.waitedMs;
      retries += outcome.retries;
      return outcome.value;
    };
    try {
      let result: InvocationResult = await call(() =>
        client.invokeStream(
          {
            message,
            actorId: ACTOR_ID,
            client: CLIENT,
            user: USER,
            ...(sessionId ? { sessionId } : {}),
          },
          onProgress,
        ),
      );
      sessionId = result.sessionId;

      while (result.kind === "suspended" && suspensions < MAX_REJECTIONS_PER_TURN) {
        suspensions += 1;
        for (const interrupt of result.interrupts) {
          output.interrupts.push({
            turn: turnIndex,
            seq: seq++,
            interruptId: interrupt.id,
            actions: interrupt.actionRequests.map((action) => ({ name: action.name, args: action.args })),
          });
        }
        const [primary, ...rest] = result.interrupts;
        const reject = (count: number) =>
          Array.from({ length: Math.max(count, 1) }, () => ({
            type: "reject" as const,
            message: "Automated eval run: this operation was rejected and not executed.",
          }));
        const suspended = result;
        result = await call(() =>
          client.resumeStream(
          {
            sessionId: suspended.sessionId,
            interruptId: primary!.id,
            decision: reject(primary!.actionRequests.length),
            ...(rest.length
              ? {
                  additionalInterrupts: rest.map((interrupt) => ({
                    interruptId: interrupt.id,
                    decision: reject(interrupt.actionRequests.length),
                  })),
                }
              : {}),
            actorId: ACTOR_ID,
            client: CLIENT,
            user: USER,
          },
          onProgress,
          ),
        );
        sessionId = result.sessionId;
      }

      output.turns.push({
        message,
        response: result.kind === "completed" ? result.response : "",
        latencyMs: Math.round(performance.now() - started - waitedMs),
        suspensions,
        leftSuspended: result.kind === "suspended",
        ...(retries ? { capacityRetries: retries } : {}),
      });
    } catch (error) {
      output.turns.push({
        message,
        response: "",
        latencyMs: Math.round(performance.now() - started - waitedMs),
        suspensions,
        leftSuspended: false,
        ...(retries ? { capacityRetries: retries } : {}),
      });
      output.error = describeError(error);
      break;
    }
  }

  if (sessionId) output.sessionId = sessionId;
  return output;
}
