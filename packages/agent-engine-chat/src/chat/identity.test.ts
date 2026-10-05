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

import { describe, expect, it } from "vitest";

import {
  clientUserFromAuthor,
  platformActorId,
  platformFromThreadId,
  SLACK_CHAT_CLIENT,
} from "./identity.js";

describe("chat identity normalization", () => {
  it("qualifies actors by adapter", () => {
    expect(platformActorId("slack", "U123")).toBe("slack:U123");
    expect(platformActorId("discord", "123")).toBe("discord:123");
  });

  it("reads the adapter namespace from a Chat SDK thread ID", () => {
    expect(platformFromThreadId("slack:C123:1234.5")).toBe("slack");
    expect(platformFromThreadId("invalid")).toBeNull();
  });

  it("builds Agent Engine client user extras from a Chat SDK author", () => {
    expect(SLACK_CHAT_CLIENT).toBe("slack");
    expect(
      clientUserFromAuthor("slack", {
        userId: "U123",
        userName: "ada",
        fullName: "Ada Lovelace",
      }),
    ).toEqual({
      id: "U123",
      username: "ada",
      full_name: "Ada Lovelace",
      actor_id: "slack:U123",
    });
    expect(
      clientUserFromAuthor("msteams", { userId: "29:abc" }),
    ).toEqual({
      id: "29:abc",
      actor_id: "msteams:29:abc",
    });
  });
});
