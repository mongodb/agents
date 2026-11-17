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

import { ToolMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";

import { stampClientUser } from "./clientUser.js";

const ada = {
  id: "U123",
  username: "ada",
  full_name: "Ada Lovelace",
  actor_id: "slack:U123",
};

describe("stampClientUser", () => {
  it("preserves tool message identity while adding extras", () => {
    const message = new ToolMessage({
      id: "tool-2",
      content: "ok",
      tool_call_id: "call-2",
      name: "mongodb__find",
      status: "success",
    });

    const stamped = stampClientUser(message, { client: "slack", user: ada });
    expect(stamped).toBeInstanceOf(ToolMessage);
    expect(stamped.id).toBe("tool-2");
    expect((stamped as ToolMessage).tool_call_id).toBe("call-2");
    expect(stamped.additional_kwargs).toEqual({ client: "slack", user: ada });
  });
});
