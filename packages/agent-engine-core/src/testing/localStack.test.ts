import { describe, expect, it, vi } from "vitest";

import {
  buildResumeMap,
  humanContentsFromMessages,
  isWriteMcpTool,
  mongodbUriFromStatus,
  parseInvokeResponse,
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

describe("parseInvokeResponse", () => {
  it("returns a completed invocation", () => {
    expect(
      parseInvokeResponse(
        {
          success: true,
          status: "completed",
          response: "pong",
          session_id: "session-1",
          execution_id: "exec-1",
        },
        200,
        null,
      ),
    ).toEqual({
      kind: "completed",
      response: "pong",
      sessionId: "session-1",
      executionId: "exec-1",
    });
  });

  it("returns a suspended invocation with interrupt details", () => {
    expect(
      parseInvokeResponse(
        {
          status: "suspended",
          session_id: "session-1",
          execution_id: "exec-1",
          suspend_context: {
            interrupts: [
              {
                id: "interrupt-1",
                value: {
                  actionRequests: [
                    {
                      name: "mongodb__drop_collection",
                      args: { database: "eai_it_nonexistent" },
                    },
                  ],
                },
              },
            ],
          },
        },
        200,
        "header-session",
      ),
    ).toEqual({
      kind: "suspended",
      sessionId: "session-1",
      executionId: "exec-1",
      interrupts: [
        {
          id: "interrupt-1",
          actionRequests: [
            {
              name: "mongodb__drop_collection",
              args: { database: "eai_it_nonexistent" },
            },
          ],
        },
      ],
    });
  });

  it("uses the session header when the body omits session_id", () => {
    expect(
      parseInvokeResponse(
        { status: "completed", result: { content: "ok" } },
        200,
        "header-session",
      ),
    ).toMatchObject({ kind: "completed", sessionId: "header-session" });
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

describe("buildResumeMap", () => {
  it("wraps approve and reject decisions the way OE expects", () => {
    expect(
      buildResumeMap({
        sessionId: "session-1",
        interruptId: "interrupt-1",
        decision: { type: "approve" },
        additionalInterrupts: [
          {
            interruptId: "interrupt-2",
            decision: { type: "reject", message: "no" },
          },
        ],
      }),
    ).toEqual({
      "interrupt-1": { decisions: [{ type: "approve" }] },
      "interrupt-2": { decisions: [{ type: "reject", message: "no" }] },
    });
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
