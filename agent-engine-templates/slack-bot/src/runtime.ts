import type { SlackAdapter } from "@chat-adapter/slack";
import { Chat, type StateAdapter } from "chat";

import { registerChatHandlers } from "./chat/handlers.js";
import { platformActorId } from "./chat/identity.js";
import type {
  AgentGateway,
  HandlerLogger,
} from "./chat/types.js";
import {
  loadConfig,
  type SlackBotConfig,
} from "./config.js";
import { MagentaClient } from "./magenta/client.js";
import {
  createSlackDeliveryBoundary,
  createSlackPlatformAdapter,
  parseSlackReviewInterruptId,
  registerSlackPlatformHandlers,
} from "./platforms/slack.js";
import {
  getSharedMongoConnection,
  type MongoConnection,
} from "./store/mongoConnection.js";
import { MongoStateAdapter } from "./store/mongoState.js";
import { MongoThreadStore } from "./store/mongoThreadStore.js";
import type { ThreadStore } from "./store/threadStore.js";

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
    agent: options.agent ?? new MagentaClient(config.agentic),
    authorizedActorIds: normalizeAllowedActors(
      config.chat.allowedActorIds,
    ),
    logger: options.logger ?? console,
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
