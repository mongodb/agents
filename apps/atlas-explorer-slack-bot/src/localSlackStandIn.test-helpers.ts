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

import { createHmac } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";

export const SIGNING_SECRET = "slack-signing-secret";
export const ALLOWED_USER = "U123";
export const CHANNEL = "D123";

export interface SlackApiCall {
  method: string;
  body: Record<string, string>;
}

export interface SlackApiStandIn {
  calls: SlackApiCall[];
  url: string;
  close(): Promise<void>;
  postedTexts(): string[];
}

export function directMessageEvent(input: {
  eventId: string;
  text: string;
  ts: string;
  user?: string;
}): Record<string, unknown> {
  return {
    type: "event_callback",
    token: "test-token",
    team_id: "T123",
    api_app_id: "A123",
    event_id: input.eventId,
    event_time: 1_720_000_000,
    event: {
      type: "message",
      channel: CHANNEL,
      channel_type: "im",
      user: input.user ?? ALLOWED_USER,
      text: input.text,
      ts: input.ts,
    },
  };
}

export function signSlackBody(
  body: string,
  timestamp = Math.floor(Date.now() / 1000),
): { signature: string; timestamp: string } {
  const timestampText = String(timestamp);
  const signature =
    "v0=" +
    createHmac("sha256", SIGNING_SECRET)
      .update(`v0:${timestampText}:${body}`)
      .digest("hex");
  return { signature, timestamp: timestampText };
}

export async function postSlackWebhook(
  serverUrl: string,
  payload: unknown,
  options: { sign?: boolean } = {},
): Promise<Response> {
  const body = JSON.stringify(payload);
  const headers = new Headers({ "content-type": "application/json" });
  if (options.sign !== false) {
    const signed = signSlackBody(body);
    headers.set("x-slack-request-timestamp", signed.timestamp);
    headers.set("x-slack-signature", signed.signature);
  }
  return fetch(`${serverUrl}/api/webhooks/slack`, {
    method: "POST",
    headers,
    body,
  });
}

export async function startSlackApiStandIn(): Promise<SlackApiStandIn> {
  const calls: SlackApiCall[] = [];
  const server = createServer((request, response) => {
    void readRequestBody(request).then((raw) => {
      const method = slackMethod(request.url ?? "/");
      const body = parseSlackBody(
        raw.toString("utf8"),
        request.headers["content-type"],
      );
      calls.push({ method, body });
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(slackApiResponse(method, body)));
    });
  });
  await listen(server);
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Slack API stand-in did not bind a TCP port");
  }
  return {
    calls,
    url: `http://127.0.0.1:${address.port}/api`,
    postedTexts(): string[] {
      return calls
        .filter((call) => call.method === "chat.postMessage")
        .map((call) => call.body.markdown_text || call.body.text || "");
    },
    close: () => closeServer(server),
  };
}

export async function waitFor(
  predicate: () => boolean,
  label: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function slackMethod(url: string): string {
  const path = url.split("?")[0] ?? "/";
  const segment = path.split("/").filter(Boolean).at(-1);
  return segment ?? path;
}

function parseSlackBody(
  raw: string,
  contentType: string | undefined,
): Record<string, string> {
  if (!raw) {
    return {};
  }
  if (contentType?.includes("application/json")) {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).map(([key, value]) => [key, String(value)]),
    );
  }
  return Object.fromEntries(new URLSearchParams(raw));
}

function slackApiResponse(
  method: string,
  body: Record<string, string>,
): Record<string, unknown> {
  if (method === "auth.test") {
    return {
      ok: true,
      user_id: "UBOT",
      bot_id: "BBOT",
      user: "atlasexplorer",
      team_id: "T123",
    };
  }
  if (method === "users.info") {
    const userId = body.user || ALLOWED_USER;
    return {
      ok: true,
      user: {
        id: userId,
        name: "ada",
        real_name: "Ada Lovelace",
        is_bot: false,
        profile: {
          display_name: "Ada",
          real_name: "Ada Lovelace",
        },
      },
    };
  }
  if (method === "chat.postMessage") {
    return {
      ok: true,
      channel: body.channel ?? CHANNEL,
      ts: `${Date.now() / 1000}`,
    };
  }
  if (method === "conversations.replies") {
    return { ok: true, messages: [], has_more: false };
  }
  return { ok: true };
}

function listen(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
}

function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function readRequestBody(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}
