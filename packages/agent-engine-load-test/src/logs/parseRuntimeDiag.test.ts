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

import { describe, expect, it } from "vitest";

import { oct7Ndjson } from "./fixtures/oct7Fixture.js";
import { parseLogOutput, parseRuntimeDiagLogs } from "./parseRuntimeDiag.js";

const signalAndExit = [
  '{"timestamp":"2026-10-07T17:10:00.000Z","message":"17:10:00 | INFO     | [runtime-diag] instance=578a2da3 mode=aer signal_received signal=SIGTERM uptime=640s executions=1 graph_builds=1 tokens_seen=1","service":"agent"}',
  '{"timestamp":"2026-10-07T17:10:01.000Z","message":"17:10:01 | INFO     | [runtime-diag] instance=578a2da3 mode=aer process_exit code=0 uptime=641s executions=1 graph_builds=1 tokens_seen=1","service":"agent"}',
  '{"timestamp":"2026-10-07T17:11:00.000Z","level":"ERROR","message":"MCPConfigError: mcp server \'mongodb\' tools/list failed: Access Token limit reached. Please use the existing Access Tokens or create a new Service Account","service":"agent"}',
].join("\n");

describe("parseRuntimeDiagLogs", () => {
  it("parses the Oct 7 ndjson repro", () => {
    const events = parseRuntimeDiagLogs(oct7Ndjson);

    expect(events.map((event) => event.kind)).toEqual([
      "mcp_token_cached",
      "graph_build",
      "execution",
      "process_start",
      "mcp_token_cached",
      "graph_build",
      "execution",
      "process_start",
      "mcp_token_cached",
      "process_start",
      "graph_build",
    ]);

    const firstTurn = events[2];
    expect(firstTurn).toMatchObject({
      kind: "execution",
      instanceId: "578a2da3",
      mode: "aer",
      n: 1,
      sessionId: "diag-test-1791392694",
      executionId: "4ce1c874-55bd-4eb0-a15c-7f7a6b21eaf5",
      uptimeSeconds: 336,
      timestamp: "2026-10-07T17:04:55.359Z",
    });

    const cached = events[0];
    expect(cached).toMatchObject({
      kind: "mcp_token_cached",
      fingerprint: "597eb3a25b28",
      expiry: "2026-10-07T17:59:25.668Z",
      cacheUpdatedAt: "2026-10-07T16:59:25.671Z",
      server: "mongodb",
    });

    const started = events[3];
    expect(started).toMatchObject({
      kind: "process_start",
      instanceId: "523a05df",
      pid: 612,
      host: "fctr-c342b1199f7e36d0",
      tokenCaches: { mongodb: "absent" },
    });
  });

  it("parses a pretty-printed tail document after the context preamble", () => {
    const record = JSON.parse(oct7Ndjson.split("\n")[2] ?? "{}") as unknown;
    const pretty = [
      "context: Ben Perlmutter's Organization › Atlas Explorer › atlas-explorer",
      "",
      JSON.stringify({ logs: [record], hasMore: false }, null, 2),
    ].join("\n");

    const parsed = parseLogOutput(pretty);
    expect(parsed.truncated).toBe(false);
    expect(parseRuntimeDiagLogs(pretty)).toHaveLength(1);
    expect(parseRuntimeDiagLogs(pretty)[0]).toMatchObject({
      kind: "execution",
      instanceId: "578a2da3",
    });
  });

  it("reports a truncated tail page", () => {
    const parsed = parseLogOutput(
      JSON.stringify({ logs: [], hasMore: true }),
    );
    expect(parsed.truncated).toBe(true);
  });

  it("skips malformed lines and records that are not diagnostics", () => {
    const input = [
      "context: ignored",
      "{not json",
      '{"timestamp":"2026-10-07T17:00:00.000Z","message":"App created; Atlas MCP tools will be discovered"}',
      '{"timestamp":"2026-10-07T17:00:01.000Z","message":"17:00:01 | INFO     | [runtime-diag] instance=abc mode=nope process_start"}',
      oct7Ndjson.split("\n")[10],
    ].join("\n");

    const events = parseRuntimeDiagLogs(input);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "graph_build",
      instanceId: "15a48507",
      mode: "tool",
      n: 1,
      uptimeSeconds: 8,
    });
  });

  it("parses shutdown lines and the token-limit error", () => {
    const events = parseRuntimeDiagLogs(signalAndExit);

    expect(events[0]).toMatchObject({
      kind: "signal_received",
      signal: "SIGTERM",
      uptimeSeconds: 640,
      executions: 1,
      graphBuilds: 1,
      tokensSeen: 1,
    });
    expect(events[1]).toMatchObject({
      kind: "process_exit",
      code: 0,
      tokensSeen: 1,
    });
    expect(events[2]).toMatchObject({
      kind: "token_limit_error",
      service: "agent",
      timestamp: "2026-10-07T17:11:00.000Z",
    });
  });

  it("treats unknown sentinels as missing and an empty cache list as none", () => {
    const input = JSON.stringify({
      timestamp: "2026-10-07T17:00:00.000Z",
      message:
        "[runtime-diag] instance=abc12345 mode=aer execution n=1 session=unknown execution_id=unknown uptime=1s",
    });
    const caches = JSON.stringify({
      timestamp: "2026-10-07T17:00:01.000Z",
      message:
        "[runtime-diag] instance=abc12345 mode=tool process_start pid=1 host=fctr mcp_token_cache=none",
    });

    expect(parseRuntimeDiagLogs(`${input}\n${caches}`)).toMatchObject([
      { kind: "execution", sessionId: null, executionId: null },
      { kind: "process_start", tokenCaches: {} },
    ]);
  });
});
