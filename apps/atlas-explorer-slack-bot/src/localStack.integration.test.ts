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

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { MongoMemoryServer } from "mongodb-memory-server-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  startLocalWebhookServer,
  type LocalWebhookServer,
} from "./localWebhookServer.js";
import {
  ALLOWED_USER,
  directMessageEvent,
  postSlackWebhook,
  startSlackApiStandIn,
  waitFor,
  type SlackApiStandIn,
} from "./localSlackStandIn.test-helpers.js";

const PROMPT = "Reply with the single word pong.";
// Playground on port 3000 is the documented local target. Headless CI omits
// that UI and sets this to the Orchestration Engine on port 8000, which
// serves the same /invoke/stream contract for a single local agent.
const LOCAL_AGENT_URL =
  process.env.AGENTIC_PLAYGROUND_URL ?? "http://127.0.0.1:3000";

describe("Slack bot against a local Agent Engine", () => {
  let mongo: MongoMemoryServer;
  let slack: SlackApiStandIn;
  let proxy: InvokeProxy;
  let bot: LocalWebhookServer;

  beforeAll(async () => {
    await waitForHttp(LOCAL_AGENT_URL, "local Agent Engine");
    mongo = await MongoMemoryServer.create();
    slack = await startSlackApiStandIn();
    proxy = await startInvokeProxy(LOCAL_AGENT_URL);
    bot = await startLocalWebhookServer({
      SLACK_BOT_TOKEN: "xoxb-local-test",
      SLACK_SIGNING_SECRET: "slack-signing-secret",
      SLACK_API_URL: slack.url,
      SLACK_BOT_DISPLAY_NAME: "AtlasExplorer",
      CHAT_ALLOWED_USER_IDS: `slack:${ALLOWED_USER}`,
      AGENTIC_INVOKE_TARGET: "local",
      AGENTIC_BASE_URL: proxy.url,
      MONGODB_URI: mongo.getUri(),
      THREAD_STORE_DB: "atlas_explorer_slack_integration",
    });
  }, 180_000);

  afterAll(async () => {
    await bot?.close();
    await proxy?.close();
    await slack?.close();
    await mongo?.stop();
  });

  it("answers a signed URL verification challenge", async () => {
    const response = await postSlackWebhook(bot.url, {
      type: "url_verification",
      challenge: "local-stack-challenge",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      challenge: "local-stack-challenge",
    });
  });

  it("forwards an allowlisted DM to the local agent and posts the outcome", async () => {
    const response = await postSlackWebhook(
      bot.url,
      directMessageEvent({
        eventId: "EvStackPong",
        text: PROMPT,
        ts: "1720000001.000100",
      }),
    );
    expect(response.status).toBe(200);

    await waitFor(
      () =>
        proxy.invokes.some((invoke) => invoke.completed) &&
        slack.postedTexts().length > 0,
      "the local agent invoke and the Slack stand-in post",
      240_000,
    );

    const invoke = proxy.invokes.find((entry) => entry.completed);
    expect(invoke?.path).toBe("/invoke/stream");
    expect(invoke?.message).toBe(PROMPT);
    expect(invoke?.userId).toBe(`slack:${ALLOWED_USER}`);
    expect(invoke?.status).toBe(200);
    const posted = slack.postedTexts().join("\n");
    expect(posted.toLowerCase()).toContain("pong");
  });
});

interface RecordedInvoke {
  completed: boolean;
  message: string;
  path: string;
  status: number;
  userId: string;
}

interface InvokeProxy {
  url: string;
  invokes: RecordedInvoke[];
  close(): Promise<void>;
}

async function startInvokeProxy(upstreamBase: string): Promise<InvokeProxy> {
  const invokes: RecordedInvoke[] = [];
  const server = createServer((request, response) => {
    void proxyRequest(request, response, upstreamBase, invokes);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Invoke proxy did not bind a TCP port");
  }
  return {
    url: `http://127.0.0.1:${address.port}`,
    invokes,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

async function proxyRequest(
  request: IncomingMessage,
  response: ServerResponse,
  upstreamBase: string,
  invokes: RecordedInvoke[],
): Promise<void> {
  const raw = await readBody(request);
  const path = request.url?.split("?")[0] ?? "/";
  const parsed = parseInvokeBody(raw);
  const recorded: RecordedInvoke | undefined = path.includes("/invoke")
    ? {
        completed: false,
        message: parsed.message,
        path,
        status: 0,
        userId: parsed.userId,
      }
    : undefined;
  if (recorded) {
    invokes.push(recorded);
  }

  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (
      value === undefined ||
      key === "host" ||
      key === "connection" ||
      key === "content-length"
    ) {
      continue;
    }
    headers.set(key, Array.isArray(value) ? value.join(", ") : value);
  }

  let upstream: Response;
  try {
    upstream = await fetch(new URL(request.url ?? "/", upstreamBase), {
      method: request.method,
      headers,
      body:
        request.method === "GET" || request.method === "HEAD"
          ? undefined
          : raw,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    response.writeHead(502, { "content-type": "text/plain" });
    response.end(message);
    return;
  }

  if (recorded) {
    recorded.status = upstream.status;
  }
  response.writeHead(upstream.status, {
    "content-type":
      upstream.headers.get("content-type") ?? "application/octet-stream",
    ...(upstream.headers.get("X-Session-ID")
      ? { "X-Session-ID": upstream.headers.get("X-Session-ID")! }
      : {}),
  });
  if (!upstream.body) {
    if (recorded) {
      recorded.completed = true;
    }
    response.end();
    return;
  }
  const reader = upstream.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      response.write(value);
    }
  } finally {
    if (recorded) {
      recorded.completed = true;
    }
    response.end();
  }
}

function parseInvokeBody(raw: Buffer): { message: string; userId: string } {
  if (raw.length === 0) {
    return { message: "", userId: "" };
  }
  try {
    const parsed = JSON.parse(raw.toString("utf8")) as {
      message?: string;
      user_id?: string;
    };
    return {
      message: parsed.message ?? "",
      userId: parsed.user_id ?? "",
    };
  } catch {
    return { message: "", userId: "" };
  }
}

async function waitForHttp(url: string, label: string): Promise<void> {
  const deadline = Date.now() + 60_000;
  let lastError = "no response";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(3_000),
      });
      if (response.status < 500) {
        return;
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(
    `${label} at ${url} is not reachable (${lastError}). Start Atlas Explorer with \`agentengine dev up\` from agents/atlas-explorer, or set AGENTIC_PLAYGROUND_URL to a running local Orchestration Engine.`,
  );
}

function readBody(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}
