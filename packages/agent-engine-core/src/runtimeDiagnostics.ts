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
 * Lifecycle logs for one runtime process: which process serves each
 * execution, each time that process caches a new MCP access token, and how
 * the process shuts down.
 *
 * Token values are never logged. Each cached token is identified by a short
 * SHA-256 fingerprint so distinct tokens can be counted across processes.
 */

import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  getCurrentExecutionId,
  getCurrentSessionId,
  mcpOauthCacheDir,
  mcpOauthCacheName,
} from "@mongodb-js/agent-engine-runner-shared";

export interface DiagnosticsMcpServer {
  name: string;
  url: string;
}

export interface RuntimeDiagnosticsOptions {
  /** `mcp.servers` from agent.yaml, keyed by server name. */
  mcpServers: Record<string, unknown>;
  log: (msg: string) => void;
  pollIntervalMs?: number;
}

export interface RuntimeDiagnostics {
  readonly instanceId: string;
  recordGraphBuild(): void;
  recordExecution(sessionId?: string | null): void;
  checkTokenCaches(): void;
  stop(): void;
}

export interface CachedTokenSummary {
  fingerprint: string;
  expiry: string | null;
  updatedAt: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function orNull<T>(read: () => T): T | null {
  try {
    return read();
  } catch {
    return null;
  }
}

export function mcpTokenCacheFile(server: DiagnosticsMcpServer): string {
  return path.join(
    mcpOauthCacheDir(),
    `${mcpOauthCacheName(server.name, server.url)}.json`,
  );
}

export function readMcpTokenCacheSummary(
  cacheFile: string,
): CachedTokenSummary | undefined {
  let payload: unknown;
  try {
    payload = JSON.parse(fs.readFileSync(cacheFile, "utf-8"));
  } catch {
    return undefined;
  }
  if (!isRecord(payload) || !isRecord(payload["tokens"])) {
    return undefined;
  }
  const tokens = payload["tokens"];
  const accessToken = tokens["access_token"];
  if (typeof accessToken !== "string" || accessToken === "") {
    return undefined;
  }
  return {
    fingerprint: createHash("sha256")
      .update(accessToken)
      .digest("hex")
      .slice(0, 12),
    expiry: typeof tokens["expiry"] === "string" ? tokens["expiry"] : null,
    updatedAt:
      typeof payload["updated_at"] === "string" ? payload["updated_at"] : null,
  };
}

export function startRuntimeDiagnostics(
  options: RuntimeDiagnosticsOptions,
): RuntimeDiagnostics {
  const instanceId = randomUUID().slice(0, 8);
  const mode = process.env["RUNNER_MODE"] ?? "unknown";
  const prefix = `[runtime-diag] instance=${instanceId} mode=${mode}`;
  const uptime = (): string => `${Math.round(process.uptime())}s`;

  const caches = Object.entries(options.mcpServers).flatMap(([name, config]) => {
    if (!isRecord(config) || typeof config["url"] !== "string") {
      return [];
    }
    const server = { name, url: config["url"] };
    return [
      {
        server,
        file: mcpTokenCacheFile(server),
        lastFingerprint: undefined as string | undefined,
        tokensSeen: 0,
      },
    ];
  });
  let graphBuilds = 0;
  let executions = 0;

  const checkTokenCaches = (): void => {
    for (const cache of caches) {
      const summary = readMcpTokenCacheSummary(cache.file);
      if (summary === undefined || summary.fingerprint === cache.lastFingerprint) {
        continue;
      }
      cache.lastFingerprint = summary.fingerprint;
      cache.tokensSeen += 1;
      options.log(
        `${prefix} mcp_token_cached server=${cache.server.name} n=${cache.tokensSeen} ` +
          `fingerprint=${summary.fingerprint} expiry=${summary.expiry ?? "unknown"} ` +
          `cache_updated_at=${summary.updatedAt ?? "unknown"} uptime=${uptime()}`,
      );
    }
  };

  const cacheState = caches
    .map((cache) => `${cache.server.name}:${fs.existsSync(cache.file) ? "present" : "absent"}`)
    .join(",");
  options.log(
    `${prefix} process_start pid=${process.pid} host=${os.hostname()} ` +
      `mcp_token_cache=${cacheState || "none"}`,
  );
  checkTokenCaches();

  const timer = setInterval(checkTokenCaches, options.pollIntervalMs ?? 5_000);
  timer.unref();

  const lifetimeSummary = (): string => {
    const tokensSeen = caches.reduce((total, cache) => total + cache.tokensSeen, 0);
    return (
      `uptime=${uptime()} executions=${executions} ` +
      `graph_builds=${graphBuilds} tokens_seen=${tokensSeen}`
    );
  };

  // The runner installs its own SIGTERM/SIGINT drain only after MCP discovery.
  // A signal before then would be swallowed by this listener alone, so re-raise
  // it to keep Node's default termination.
  const onSignal = (signal: NodeJS.Signals): void => {
    checkTokenCaches();
    options.log(`${prefix} signal_received signal=${signal} ${lifetimeSummary()}`);
    if (process.listenerCount(signal) === 0) {
      process.kill(process.pid, signal);
    }
  };
  // Prepended so this line is written before the runner's stdio capture
  // flushes on exit.
  const onExit = (code: number): void => {
    checkTokenCaches();
    options.log(`${prefix} process_exit code=${code} ${lifetimeSummary()}`);
  };
  process.once("SIGTERM", onSignal);
  process.once("SIGINT", onSignal);
  process.prependListener("exit", onExit);

  return {
    instanceId,
    recordGraphBuild() {
      graphBuilds += 1;
      options.log(`${prefix} graph_build n=${graphBuilds} uptime=${uptime()}`);
    },
    recordExecution(sessionId) {
      executions += 1;
      checkTokenCaches();
      const session = sessionId || orNull(getCurrentSessionId) || "unknown";
      const executionId = orNull(getCurrentExecutionId) || "unknown";
      options.log(
        `${prefix} execution n=${executions} session=${session} ` +
          `execution_id=${executionId} uptime=${uptime()}`,
      );
    },
    checkTokenCaches,
    stop() {
      clearInterval(timer);
      process.off("SIGTERM", onSignal);
      process.off("SIGINT", onSignal);
      process.off("exit", onExit);
    },
  };
}
