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

import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";

import { closeSharedMongoConnection } from "@repo/agent-engine-chat/store";

import { POST } from "../api/webhooks/slack.js";
import { getHttpRuntime, resetHttpRuntime } from "./runtime.js";

const WEBHOOK_PATH = "/api/webhooks/slack";

export interface LocalWebhookServer {
  url: string;
  close(): Promise<void>;
}

/**
 * Serves the deployed Vercel webhook on localhost.
 * `POST` in `api/webhooks/slack.ts` is the same function Vercel calls.
 * Point `AGENTIC_INVOKE_TARGET=local` at a local Agent Engine and
 * `SLACK_API_URL` at a stand-in so the process never calls Slack.
 */
export async function startLocalWebhookServer(
  environment: Record<string, string | undefined>,
  options: { host?: string; port?: number } = {},
): Promise<LocalWebhookServer> {
  applyEnvironment(environment);
  const host = options.host ?? "127.0.0.1";
  const server = createServer((request, response) => {
    void handleWebhookRequest(request, response);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, host, () => {
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Local webhook server did not bind a TCP port");
  }

  return {
    url: `http://${host}:${address.port}`,
    async close(): Promise<void> {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
      const { bot } = await getHttpRuntime();
      const results = await Promise.allSettled([
        bot.shutdown(),
        closeSharedMongoConnection(),
      ]);
      resetHttpRuntime();
      const failures = results.flatMap((result) =>
        result.status === "rejected" ? [result.reason] : [],
      );
      if (failures.length > 0) {
        throw new AggregateError(
          failures,
          "Failed to tear down the local webhook runtime",
        );
      }
    },
  };
}

function applyEnvironment(
  environment: Record<string, string | undefined>,
): void {
  for (const [key, value] of Object.entries(environment)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

async function handleWebhookRequest(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const path = request.url?.split("?")[0] ?? "/";
  if (request.method === "GET" && path === "/health") {
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("ok");
    return;
  }
  if (request.method !== "POST" || path !== WEBHOOK_PATH) {
    response.writeHead(404, { "content-type": "text/plain" });
    response.end("not found");
    return;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (value === undefined) {
      continue;
    }
    headers.set(key, Array.isArray(value) ? value.join(", ") : value);
  }

  const webhookResponse = await POST(
    new Request(`http://127.0.0.1${WEBHOOK_PATH}`, {
      method: "POST",
      headers,
      body: Buffer.concat(chunks),
    }),
  );

  const responseBody = Buffer.from(await webhookResponse.arrayBuffer());
  const responseHeaders: Record<string, string> = {};
  webhookResponse.headers.forEach((value, key) => {
    if (key.toLowerCase() === "content-length") {
      return;
    }
    responseHeaders[key] = value;
  });
  response.writeHead(webhookResponse.status, responseHeaders);
  response.end(responseBody);
}
