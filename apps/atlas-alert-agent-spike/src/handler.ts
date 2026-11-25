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

import type {
  InvocationResult,
  InvokeInput,
} from "@repo/agent-engine-chat/agent-engine";

import {
  buildPrompt,
  parseAlert,
  shouldInvestigate,
  tokenMatches,
  verifyAtlasSignature,
  type AtlasAlert,
} from "./alert.js";
import type { SpikeConfig } from "./config.js";

export interface HandlerDeps {
  config: Pick<
    SpikeConfig,
    "atlasWebhookSecret" | "urlToken" | "slackBotToken" | "slackChannelId"
  >;
  agent: { invoke(input: InvokeInput): Promise<InvocationResult> };
  postToSlack(options: {
    token: string;
    channel: string;
    text: string;
  }): Promise<void>;
  /** Keeps the work alive after the HTTP response (Vercel `waitUntil`). */
  waitUntil(promise: Promise<unknown>): void;
  log?(message: string): void;
}

function formatSlackMessage(alert: AtlasAlert, result: InvocationResult): string {
  const title = `:rotating_light: Atlas alert ${alert.eventTypeName ?? alert.id}`;
  const context = [alert.clusterName, alert.hostnameAndPort]
    .filter(Boolean)
    .join(" / ");
  const header = context ? `${title} (${context})` : title;
  if (result.kind === "completed") {
    return `${header}\n\n${result.response}`;
  }
  // Spike: the agent is read-only here, so a pause for approval is unexpected.
  return `${header}\n\nThe agent paused for approval, which this spike does not handle.`;
}

/**
 * Receives an Atlas alert webhook. Atlas treats any non-2xx response as a
 * delivery failure, so the investigation runs after a 202 is returned.
 * https://www.mongodb.com/docs/atlas/tutorial/webhook-integration/
 */
export async function handleAlertWebhook(
  request: Request,
  deps: HandlerDeps,
): Promise<Response> {
  const log = deps.log ?? (() => {});

  if (deps.config.urlToken) {
    const token = new URL(request.url).searchParams.get("token");
    if (!tokenMatches(token, deps.config.urlToken)) {
      return new Response("Unauthorized", { status: 401 });
    }
  }

  const rawBody = await request.text();
  const signature = request.headers.get("X-MMS-Signature");
  if (!verifyAtlasSignature(rawBody, signature, deps.config.atlasWebhookSecret)) {
    return new Response("Invalid signature", { status: 401 });
  }

  const event = request.headers.get("X-MMS-Event");
  if (!shouldInvestigate(event)) {
    return new Response(`Ignored ${event ?? "unknown event"}`, { status: 200 });
  }

  const alert = parseAlert(rawBody);
  if (!alert) {
    return new Response("Invalid alert body", { status: 400 });
  }

  deps.waitUntil(investigate(alert, deps, log));
  return new Response("Accepted", { status: 202 });
}

async function investigate(
  alert: AtlasAlert,
  deps: HandlerDeps,
  log: (message: string) => void,
): Promise<void> {
  const { slackBotToken: token, slackChannelId: channel } = deps.config;
  try {
    log(`Investigating alert ${alert.id}`);
    const result = await deps.agent.invoke({
      message: buildPrompt(alert),
      actorId: "atlas-alert-webhook",
      client: "atlas-alert-webhook",
    });
    await deps.postToSlack({
      token,
      channel,
      text: formatSlackMessage(alert, result),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`Alert ${alert.id} investigation failed: ${message}`);
    await deps
      .postToSlack({
        token,
        channel,
        text: `:warning: Atlas alert ${alert.eventTypeName ?? alert.id}: the agent could not investigate (${message}).`,
      })
      .catch((slackError: unknown) => {
        log(`Slack fallback post failed: ${String(slackError)}`);
      });
  }
}
