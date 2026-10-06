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

import { describe, expect, it, vi } from "vitest";

import {
  humanContentsFromMessages,
  invoke,
  isWriteMcpTool,
  mongodbUriFromStatus,
  resume,
  toolCallsFromMessages,
  toolResultsFromMessages,
  waitForHealthy,
} from "./localStack.js";

describe("mongodbUriFromStatus", () => {
  it("reads a published MongoDB port from agentengine status JSON", () => {
    expect(
      mongodbUriFromStatus({
        services: [
          {
            name: "oe",
            ports: [{ target: 8000, published: 8000 }],
          },
          {
            name: "mongodb",
            ports: [
              { target: 27017, published: 27019, host_ip: "0.0.0.0" },
            ],
          },
        ],
      }),
    ).toBe("mongodb://127.0.0.1:27019/?directConnection=true");
  });

  it("reads docker compose ps Publisher fields", () => {
    expect(
      mongodbUriFromStatus([
        {
          Service: "mongodb",
          Publishers: [
            { TargetPort: 27017, PublishedPort: 27018, URL: "127.0.0.1" },
          ],
        },
      ]),
    ).toBe("mongodb://127.0.0.1:27018/?directConnection=true");
  });
});

describe("invoke", () => {
  it("posts to the local OE through AgentEngineClient", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        success: true,
        status: "completed",
        response: "pong",
        session_id: "session-1",
        execution_id: "exec-1",
      }),
    );

    await expect(
      invoke(
        { message: "ping", sessionId: "session-1" },
        { fetchFn, baseUrl: "http://127.0.0.1:8000" },
      ),
    ).resolves.toEqual({
      kind: "completed",
      response: "pong",
      sessionId: "session-1",
      executionId: "exec-1",
    });

    expect(fetchFn).toHaveBeenCalledWith(
      "http://127.0.0.1:8000/invoke",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "X-Session-ID": "session-1" }),
      }),
    );
    expect(requestBody(fetchFn)).toMatchObject({
      message: "ping",
      wait: true,
      session_id: "session-1",
      user_id: "stack-test:ci",
    });
  });
});

describe("resume", () => {
  it("sends the OE resume map through AgentEngineClient", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        status: "completed",
        response: "done",
        session_id: "session-1",
      }),
    );

    await resume(
      {
        sessionId: "session-1",
        interruptId: "interrupt-1",
        decision: { type: "approve" },
        additionalInterrupts: [
          {
            interruptId: "interrupt-2",
            decision: { type: "reject", message: "no" },
          },
        ],
      },
      { fetchFn, baseUrl: "http://127.0.0.1:8000" },
    );

    expect(requestBody(fetchFn)).toMatchObject({
      wait: true,
      session_id: "session-1",
      user_id: "stack-test:ci",
      resume_map: {
        "interrupt-1": { decisions: [{ type: "approve" }] },
        "interrupt-2": { decisions: [{ type: "reject", message: "no" }] },
      },
    });
  });
});

describe("checkpoint message helpers", () => {
  it("collects human contents, tool calls, and tool results", () => {
    const messages = [
      { type: "human", content: "list my databases" },
      {
        type: "ai",
        content: "",
        tool_calls: [{ name: "mongodb__list_databases", args: {} }],
      },
      {
        type: "tool",
        name: "mongodb__list_databases",
        status: "success",
        content: '["admin"]',
      },
      { type: "human", content: "what did you find?" },
    ];

    expect(humanContentsFromMessages(messages)).toEqual([
      "list my databases",
      "what did you find?",
    ]);
    expect(toolCallsFromMessages(messages)).toEqual([
      { name: "mongodb__list_databases", args: {} },
    ]);
    expect(toolResultsFromMessages(messages)).toEqual([
      {
        name: "mongodb__list_databases",
        status: "success",
        content: '["admin"]',
      },
    ]);
  });

  it("identifies write MCP tools using the application allowlist", () => {
    const readOnly = new Set(["mongodb__list_databases"]);
    expect(isWriteMcpTool("mongodb__list_databases", readOnly)).toBe(false);
    expect(isWriteMcpTool("mongodb__drop_collection", readOnly)).toBe(true);
    expect(isWriteMcpTool("read_file", readOnly)).toBe(false);
  });
});

describe("waitForHealthy", () => {
  it("returns once OE reports healthy", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("ok", { status: 200 }),
    );
    await waitForHealthy({
      url: "http://127.0.0.1:8000",
      timeoutMs: 1_000,
      intervalMs: 10,
      fetchFn,
    });
    expect(fetchFn).toHaveBeenCalledWith(
      "http://127.0.0.1:8000/health",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("fails with a start-the-stack hint when OE never becomes healthy", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockRejectedValue(
      new Error("connect ECONNREFUSED"),
    );
    await expect(
      waitForHealthy({
        url: "http://127.0.0.1:9",
        timeoutMs: 20,
        intervalMs: 5,
        fetchFn,
      }),
    ).rejects.toThrow(/agentengine dev up --headless/);
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function requestBody(fetchFn: ReturnType<typeof vi.fn<typeof fetch>>): unknown {
  const init = fetchFn.mock.calls[0]?.[1];
  return JSON.parse(String(init?.body));
}
