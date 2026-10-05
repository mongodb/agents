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

import type { ClientUserMetadata } from "../agent-engine/types.js";

export const SLACK_CHAT_CLIENT = "slack";

export function platformActorId(
  adapterName: string,
  userId: string,
): string {
  return `${adapterName}:${userId}`;
}

export function platformFromThreadId(
  threadId: string,
): string | null {
  const separator = threadId.indexOf(":");
  return separator > 0 ? threadId.slice(0, separator) : null;
}

export interface ChatAuthorIdentity {
  userId: string;
  userName?: string;
  fullName?: string;
}

export function clientUserFromAuthor(
  adapterName: string,
  author: ChatAuthorIdentity,
): ClientUserMetadata {
  return {
    id: author.userId,
    ...(author.userName ? { username: author.userName } : {}),
    ...(author.fullName ? { full_name: author.fullName } : {}),
    actor_id: platformActorId(adapterName, author.userId),
  };
}
