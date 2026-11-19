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

import {
  createSlackPlatformAdapter as createSharedSlackPlatformAdapter,
  type SlackHomeView,
  type SlackPlatformOptions,
  type SlackSuggestedPrompt,
} from "@mongodb-js/agent-engine-chat/slack";

export const RESPONSE_METADATA_EVENT = "atlas_explorer_responded";

export const SUGGESTED_PROMPTS: readonly SlackSuggestedPrompt[] = [
  {
    title: "List Atlas projects",
    message: "List the Atlas projects I can access.",
  },
  {
    title: "Inspect collections",
    message: "Show the collections in my MongoDB databases.",
  },
  {
    title: "Explain a query plan",
    message: "Help me understand and optimize a MongoDB query plan.",
  },
];

export type AtlasExplorerSlackOptions = Omit<
  SlackPlatformOptions,
  "suggestedPrompts" | "webClientOptions"
>;

export function createSlackPlatformAdapter(
  options: AtlasExplorerSlackOptions,
): SlackAdapter {
  return createSharedSlackPlatformAdapter({
    ...options,
    suggestedPrompts: {
      title: "Explore MongoDB Atlas",
      prompts: SUGGESTED_PROMPTS,
    },
  });
}

export function buildSlackHomeView(displayName: string): SlackHomeView {
  return {
    type: "home",
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `Welcome to ${displayName}`,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "Explore MongoDB databases and Atlas resources from Slack. Send a DM or mention this app in a channel, then keep follow-ups in the same thread.",
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "*Try asking:*\n• List the Atlas projects I can access\n• Show the collections in a database\n• Explain and optimize a MongoDB query plan",
        },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: "This demo uses the Atlas credentials configured on its shared Agent Engine workspace. Atlas access is not scoped to your chat identity.",
          },
        ],
      },
    ],
  };
}
