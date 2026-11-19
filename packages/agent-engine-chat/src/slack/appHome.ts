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
import type { AppHomeOpenedEvent, Chat } from "chat";

export type SlackHomeView = Parameters<SlackAdapter["publishHomeView"]>[1];

export function registerSlackAppHomeHandler(
  chat: Chat,
  adapter: SlackAdapter,
  buildHomeView: (
    event: AppHomeOpenedEvent,
  ) => SlackHomeView | Promise<SlackHomeView>,
): void {
  chat.onAppHomeOpened(async (event) => {
    if (event.adapter !== adapter || event.tab === "messages") {
      return;
    }
    await adapter.publishHomeView(
      event.userId,
      await buildHomeView(event),
    );
  });
}
