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

import type { SlackAdapter } from "@chat-adapter/slack";
import { Chat, type StateAdapter } from "chat";

import {
  platformActorId,
  registerChatHandlers,
  type AgentGateway,
  type HandlerLogger,
} from "@repo/agent-engine-chat/chat";
import { AgentEngineClient } from "@repo/agent-engine-chat/agent-engine";
import {
  getSharedMongoConnection,
  MongoStateAdapter,
  MongoThreadStore,
  type MongoConnection,
  type ThreadStore,
} from "@repo/agent-engine-chat/store";

import { atlasExplorerChatMessages } from "./atlasExplorerChat.js";
import {
  loadConfig,
  type SlackBotConfig,
} from "./loadConfig.js";
import {
  createSlackDeliveryBoundary,
  createSlackPlatformAdapter,
  parseSlackReviewInterruptId,
  registerSlackPlatformHandlers,
} from "./platforms/slack.js";

export type AtlasExplorerChat = Chat<{
  slack: SlackAdapter;
}>;

export interface BotRuntime {
  bot: AtlasExplorerChat;
  slackAdapter: SlackAdapter;
  state: StateAdapter;
  store: ThreadStore;
}

interface RuntimeOptions {
  agent?: AgentGateway;
  connection?: MongoConnection;
  logger?: HandlerLogger;
  slackAdapter?: SlackAdapter;
  state?: StateAdapter;
  store?: ThreadStore;
}

let httpRuntime: Promise<BotRuntime> | undefined;

export function getHttpRuntime(
  environment: Record<string, string | undefined> = process.env,
): Promise<BotRuntime> {
  if (!httpRuntime) {
    const pending = createRuntime(
      loadConfig(environment, "http"),
    ).catch((error) => {
      if (httpRuntime === pending) {
        httpRuntime = undefined;
      }
      throw error;
    });
    httpRuntime = pending;
  }
  return httpRuntime;
}

/** Drops the cached HTTP runtime after shutdown so the next start reads env again. */
export function resetHttpRuntime(): void {
  httpRuntime = undefined;
}

export async function createRuntime(
  config: SlackBotConfig,
  options: RuntimeOptions = {},
): Promise<BotRuntime> {
  let connection = options.connection;
  if (!options.state || !options.store) {
    connection ??= await getSharedMongoConnection({
      uri: config.store.mongoUri,
      databaseName: config.store.databaseName,
      allowEmbedded: config.mode === "socket",
    });
  }

  const state =
    options.state ??
    new MongoStateAdapter({
      client: connection!.client,
      databaseName: config.store.databaseName,
    });
  const store =
    options.store ??
    MongoThreadStore.fromDatabase(connection!.database);
  if (store instanceof MongoThreadStore) {
    await store.initialize();
  }

  const slackAdapter =
    options.slackAdapter ??
    createSlackPlatformAdapter({
      mode: config.mode === "http" ? "webhook" : "socket",
      botToken: config.slack.botToken,
      displayName: config.slack.botDisplayName,
      ...(config.slack.apiUrl ? { apiUrl: config.slack.apiUrl } : {}),
      ...(config.slack.appToken
        ? { appToken: config.slack.appToken }
        : {}),
      ...(config.slack.signingSecret
        ? { signingSecret: config.slack.signingSecret }
        : {}),
    });
  const bot = new Chat({
    adapters: { slack: slackAdapter },
    concurrency: "concurrent",
    state,
    userName: config.slack.botDisplayName,
  });
  const delivery = createSlackDeliveryBoundary(slackAdapter);
  registerChatHandlers(bot, {
    agent: options.agent ?? new AgentEngineClient(config.agentEngine),
    authorizedActorIds: normalizeAllowedActors(
      config.chat.allowedActorIds,
    ),
    botName: config.slack.botDisplayName,
    logger: options.logger ?? console,
    messages: atlasExplorerChatMessages,
    deliveryForAdapter: (adapter) =>
      adapter.name === slackAdapter.name ? delivery : undefined,
    reviewInterruptIdForAdapter: (
      adapter,
      value,
      threadId,
    ) =>
      adapter.name === slackAdapter.name
        ? parseSlackReviewInterruptId(value, threadId)
        : value,
    sessionLimit: {
      idleTtlMs: config.sessionLimit.idleTtlSeconds * 1_000,
      limit: config.sessionLimit.limitPerHour,
    },
    store,
  });
  registerSlackPlatformHandlers(
    bot,
    slackAdapter,
    config.slack.botDisplayName,
  );

  return {
    bot,
    slackAdapter,
    state,
    store,
  };
}

function normalizeAllowedActors(
  actorIds: readonly string[],
): ReadonlySet<string> {
  return new Set(
    actorIds.map((actorId) =>
      actorId.includes(":")
        ? actorId
        : platformActorId("slack", actorId),
    ),
  );
}
