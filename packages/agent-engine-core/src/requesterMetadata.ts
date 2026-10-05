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

/**
 * Project the stamped requester onto checkpoint metadata.
 *
 * Messages carry `client`/`user` in `additional_kwargs`, but the checkpointer
 * serializes the whole graph state to a Binary blob, so nothing about the
 * requester is queryable. `MongoDBSaver` writes checkpoint metadata a second
 * time as plain BSON under `metadata_search`, so copying the requester into
 * metadata makes it reachable from a normal query and from
 * `saver.list(config, { filter })`.
 *
 * LangGraph JS drops `config.metadata` on the invoke path (the Pregel loop
 * rebuilds metadata every superstep), so `put` is the only layer where the
 * messages are still deserialized and the metadata still writable.
 */

import type {
  BaseCheckpointSaver,
  Checkpoint,
  CheckpointMetadata,
} from "@langchain/langgraph";

import { parseClientUserPayload, type ClientUser } from "./clientUser.js";

export interface Requester {
  client: string;
  user: ClientUser;
  message_id?: string;
  message_type: string;
}

type RequesterMetadata = CheckpointMetadata<{ requester?: Requester }>;

function channelValues(checkpoint: Checkpoint): Record<string, unknown> {
  const values = checkpoint.channel_values;
  if (values === null || typeof values !== "object" || Array.isArray(values)) {
    return {};
  }
  return values as Record<string, unknown>;
}

function messageList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * A fresh invoke checkpoints its input under `__start__` before the messages
 * channel is populated, so both places have to be searched.
 */
function candidateMessages(checkpoint: Checkpoint): unknown[][] {
  const values = channelValues(checkpoint);
  const start = values["__start__"];
  const startMessages =
    start !== null && typeof start === "object" && !Array.isArray(start)
      ? messageList((start as Record<string, unknown>)["messages"])
      : [];
  return [messageList(values["messages"]), startMessages];
}

function messageType(message: object): string {
  const candidate = message as { getType?: () => unknown; type?: unknown };
  if (typeof candidate.getType === "function") {
    return String(candidate.getType() ?? "");
  }
  return candidate.type === undefined ? "" : String(candidate.type);
}

function requesterFromMessage(message: unknown): Requester | undefined {
  if (message === null || typeof message !== "object") {
    return undefined;
  }
  const extras = parseClientUserPayload(
    (message as { additional_kwargs?: unknown }).additional_kwargs,
  );
  if (extras === undefined) {
    return undefined;
  }
  const rawId = (message as { id?: unknown }).id;
  const id = typeof rawId === "string" && rawId !== "" ? rawId : undefined;
  return {
    client: extras.client,
    user: extras.user,
    ...(id !== undefined ? { message_id: id } : {}),
    message_type: messageType(message),
  };
}

/**
 * The newest stamped message wins: on a fresh turn that is the requester's
 * human message, and on a HITL resume it is the approver's model turn.
 */
export function requesterFromCheckpoint(
  checkpoint: Checkpoint,
): Requester | undefined {
  for (const messages of candidateMessages(checkpoint)) {
    for (let i = messages.length - 1; i >= 0; i--) {
      const requester = requesterFromMessage(messages[i]);
      if (requester !== undefined) {
        return requester;
      }
    }
  }
  return undefined;
}

/**
 * Wrap a checkpoint saver so every checkpoint records its requester under
 * `metadata.requester`.
 *
 * Patches the instance in place and returns it, matching the SDK's own
 * `withEmptyBatchGuard`. Checkpoints without a stamped message are forwarded
 * unchanged rather than receiving an empty requester.
 */
export function withRequesterMetadata<
  S extends BaseCheckpointSaver<string | number>,
>(saver: S): S {
  const originalPut = saver.put.bind(saver);
  saver.put = async (config, checkpoint, metadata, newVersions) => {
    const requester = requesterFromCheckpoint(checkpoint);
    const stamped: RequesterMetadata =
      requester === undefined ? metadata : { ...metadata, requester };
    return originalPut(config, checkpoint, stamped, newVersions);
  };
  return saver;
}
