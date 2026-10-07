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

import { createServer, type IncomingMessage } from "node:http";

import { MongoMemoryServer } from "mongodb-memory-server-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startLocalWebhookServer, type LocalWebhookServer } from "./localWebhookServer.js";
import {
  ALLOWED_USER,
  directMessageEvent,
  postSlackWebhook,
  startSlackApiStandIn,
  waitFor,
  type SlackApiStandIn,
} from "./localSlackStandIn.test-helpers.js";

const PROMPT = "Reply with the single word pong.";

describe("local Slack webhook server", () => {
  let mongo: MongoMemoryServer;
  let slack: SlackApiStandIn;
  let playground: LocalInvokeStandIn;
  let bot: LocalWebhookServer;

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    slack = await startSlackApiStandIn();
    playground = await startLocalInvokeStandIn();
    bot = await startLocalWebhookServer({
      SLACK_BOT_TOKEN: "xoxb-local-test",
      SLACK_SIGNING_SECRET: "slack-signing-secret",
      SLACK_API_URL: slack.url,
      SLACK_BOT_DISPLAY_NAME: "AtlasExplorer",
      CHAT_ALLOWED_USER_IDS: `slack:${ALLOWED_USER}`,
      AGENTIC_INVOKE_TARGET: "local",
      AGENTIC_BASE_URL: playground.url,
      MONGODB_URI: mongo.getUri(),
      THREAD_STORE_DB: "atlas_explorer_slack_test",
    });
  }, 120_000);

  afterAll(async () => {
    await bot?.close();
    await playground?.close();
    await slack?.close();
    await mongo?.stop();
  });

  it("answers a signed URL verification challenge", async () => {
    const response = await postSlackWebhook(bot.url, {
      type: "url_verification",
      challenge: "challenge-token",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      challenge: "challenge-token",
    });
  });

  it("rejects an unsigned webhook", async () => {
    const response = await postSlackWebhook(
      bot.url,
      { type: "url_verification", challenge: "challenge-token" },
      { sign: false },
    );

    expect(response.status).toBe(401);
  });

  it("posts the local agent reply without calling Slack", async () => {
    const response = await postSlackWebhook(
      bot.url,
      directMessageEvent({
        eventId: "EvLocalPong",
        text: PROMPT,
        ts: "1720000000.000100",
      }),
    );
    expect(response.status).toBe(200);

    await waitFor(
      () => slack.postedTexts().some((text) => text.includes("pong")),
      "the stand-in to receive the agent reply",
      20_000,
    );

    expect(playground.invokes).toEqual([
      expect.objectContaining({
        path: "/invoke/stream",
        message: PROMPT,
        userId: `slack:${ALLOWED_USER}`,
      }),
    ]);
    expect(slack.calls.some((call) => call.method === "auth.test")).toBe(
      true,
    );
    expect(slack.url.startsWith("http://127.0.0.1:")).toBe(true);
  });

  it("does not invoke the local agent for a disallowed user", async () => {
    const invokesBefore = playground.invokes.length;
    const response = await postSlackWebhook(
      bot.url,
      directMessageEvent({
        eventId: "EvDenied",
        text: "List projects",
        ts: "1720000000.000200",
        user: "U999",
      }),
    );
    expect(response.status).toBe(200);

    await waitFor(
      () =>
        slack
          .postedTexts()
          .some((text) => /not authorized/i.test(text)),
      "the stand-in to receive the denial",
      20_000,
    );
    expect(playground.invokes).toHaveLength(invokesBefore);
  });
});

interface RecordedInvoke {
  path: string;
  message: string;
  userId: string;
}

interface LocalInvokeStandIn {
  url: string;
  invokes: RecordedInvoke[];
  close(): Promise<void>;
}

async function startLocalInvokeStandIn(): Promise<LocalInvokeStandIn> {
  const invokes: RecordedInvoke[] = [];
  const server = createServer((request, response) => {
    void readBody(request).then((raw) => {
      const path = request.url?.split("?")[0] ?? "/";
      if (path !== "/invoke/stream") {
        response.writeHead(404);
        response.end();
        return;
      }
      const parsed = JSON.parse(raw.toString("utf8")) as {
        message?: string;
        user_id?: string;
      };
      invokes.push({
        path,
        message: parsed.message ?? "",
        userId: parsed.user_id ?? "",
      });
      response.writeHead(200, {
        "content-type": "text/event-stream",
        "X-Session-ID": "local-session",
      });
      const chunks = [
        {
          chunk_type: "text",
          content: "pon",
          execution_id: "exec-1",
        },
        {
          chunk_type: "done",
          content: "pong",
          metadata: { status: "completed" },
          execution_id: "exec-1",
        },
      ];
      for (const chunk of chunks) {
        response.write(`data: ${JSON.stringify(chunk)}\n\n`);
      }
      response.end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Local invoke stand-in did not bind a TCP port");
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
