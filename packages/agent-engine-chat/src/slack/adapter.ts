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
  createSlackAdapter,
  type SlackAdapter,
  type SlackAdapterConfig,
  type SlackAdapterMode,
  type SlackSuggestedPrompt,
} from "@chat-adapter/slack";

export type { SlackSuggestedPrompt };

export interface SlackPlatformOptions {
  apiUrl?: string;
  appToken?: string;
  botToken: string;
  displayName: string;
  mode: SlackAdapterMode;
  signingSecret?: string;
  suggestedPrompts?: {
    title: string;
    prompts: readonly SlackSuggestedPrompt[];
  };
  webClientOptions?: SlackAdapterConfig["webClientOptions"];
}

const DEFAULT_WEB_CLIENT_OPTIONS = {
  timeout: 30_000,
  retryConfig: { retries: 0 },
  rejectRateLimitedCalls: true,
} as const satisfies NonNullable<SlackAdapterConfig["webClientOptions"]>;

export function createSlackPlatformAdapter(
  options: SlackPlatformOptions,
): SlackAdapter {
  return createSlackAdapter({
    agentView: true,
    botToken: options.botToken,
    mode: options.mode,
    userName: options.displayName,
    sessionTitle: true,
    webClientOptions: {
      ...DEFAULT_WEB_CLIENT_OPTIONS,
      ...options.webClientOptions,
    },
    ...(options.suggestedPrompts
      ? {
          suggestedPrompts: {
            title: options.suggestedPrompts.title,
            prompts: [...options.suggestedPrompts.prompts],
          },
        }
      : {}),
    ...(options.apiUrl ? { apiUrl: options.apiUrl } : {}),
    ...(options.appToken ? { appToken: options.appToken } : {}),
    ...(options.signingSecret
      ? { signingSecret: options.signingSecret }
      : {}),
  });
}
