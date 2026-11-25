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

import { describe, expect, it, vi } from "vitest";

import { buildPrompt } from "./alert.js";
import { handleAlertWebhook, type HandlerDeps } from "./handler.js";

const SECRET = "test-secret";
const alert = {
  id: "alert-1",
  groupId: "project-1",
  eventTypeName: "OUTSIDE_METRIC_THRESHOLD",
  status: "OPEN",
  clusterName: "Cluster0",
  metricName: "DISK_PARTITION_SPACE_USED_DATA",
  currentValue: { number: 95.2, units: "RAW" },
  humanReadable: "Disk space used on data partition is 95.2%.",
};

function sign(body: string, secret = SECRET): string {
  return createHmac("sha1", secret).update(body).digest("base64");
}

function webhookRequest(options: {
  body?: string;
  event?: string;
  signature?: string;
  url?: string;
}): Request {
  const body = options.body ?? JSON.stringify(alert);
  return new Request(options.url ?? "https://example.com/api/webhooks/atlas-alert", {
    method: "POST",
    headers: {
      "X-MMS-Event": options.event ?? "alert.open",
      "X-MMS-Signature": options.signature ?? sign(body),
    },
    body,
  });
}

function makeDeps(overrides: Partial<HandlerDeps> = {}) {
  const pending: Promise<unknown>[] = [];
  const deps: HandlerDeps = {
    config: {
      atlasWebhookSecret: SECRET,
      slackBotToken: "xoxb-test",
      slackChannelId: "C123",
    },
    agent: {
      invoke: vi.fn().mockResolvedValue({
        kind: "completed",
        response: "Disk is nearly full.",
        sessionId: "s1",
      }),
    },
    postToSlack: vi.fn().mockResolvedValue(undefined),
    waitUntil: (promise) => {
      pending.push(promise);
    },
    ...overrides,
  };
  return { deps, settle: () => Promise.all(pending) };
}

describe("handleAlertWebhook", () => {
  it("invokes the agent and posts the diagnosis to Slack", async () => {
    const { deps, settle } = makeDeps();

    const response = await handleAlertWebhook(webhookRequest({}), deps);
    await settle();

    expect(response.status).toBe(202);
    expect(deps.agent.invoke).toHaveBeenCalledWith(
      expect.objectContaining({ message: buildPrompt(alert) }),
    );
    expect(deps.postToSlack).toHaveBeenCalledWith(
      expect.objectContaining({
        token: "xoxb-test",
        channel: "C123",
        text: expect.stringContaining("Disk is nearly full."),
      }),
    );
  });

  it("rejects a bad signature without calling the agent", async () => {
    const { deps, settle } = makeDeps();

    const response = await handleAlertWebhook(
      webhookRequest({ signature: sign("{}", "wrong-secret") }),
      deps,
    );
    await settle();

    expect(response.status).toBe(401);
    expect(deps.agent.invoke).not.toHaveBeenCalled();
  });

  it("ignores events other than alert.open", async () => {
    const { deps, settle } = makeDeps();

    const response = await handleAlertWebhook(
      webhookRequest({ event: "alert.close" }),
      deps,
    );
    await settle();

    expect(response.status).toBe(200);
    expect(deps.agent.invoke).not.toHaveBeenCalled();
  });

  it("requires the URL token when one is configured", async () => {
    const { deps } = makeDeps();
    deps.config.urlToken = "abc";

    const denied = await handleAlertWebhook(webhookRequest({}), deps);
    const wrongLength = await handleAlertWebhook(
      webhookRequest({ url: "https://example.com/hook?token=abcdef" }),
      deps,
    );
    const wrongSameLength = await handleAlertWebhook(
      webhookRequest({ url: "https://example.com/hook?token=abd" }),
      deps,
    );
    const allowed = await handleAlertWebhook(
      webhookRequest({ url: "https://example.com/hook?token=abc" }),
      deps,
    );

    expect(denied.status).toBe(401);
    expect(wrongLength.status).toBe(401);
    expect(wrongSameLength.status).toBe(401);
    expect(allowed.status).toBe(202);
  });

  it("posts a fallback message when the agent fails", async () => {
    const { deps, settle } = makeDeps({
      agent: { invoke: vi.fn().mockRejectedValue(new Error("boom")) },
    });

    const response = await handleAlertWebhook(webhookRequest({}), deps);
    await settle();

    expect(response.status).toBe(202);
    expect(deps.postToSlack).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("could not investigate (boom)"),
      }),
    );
  });
});
