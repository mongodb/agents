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

import { HumanMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";

import { prepareAgentInput } from "./userRun.js";

const ada = {
  id: "U123",
  username: "ada",
  full_name: "Ada Lovelace",
  actor_id: "slack:U123",
};

describe("prepareAgentInput", () => {
  it("stamps slack client user extras on the root human message", () => {
    const input = prepareAgentInput(
      {
        payload: {
          message: "List projects",
          client: "slack",
          user: ada,
        },
      },
      { userId: "slack:U123", sessionId: "session-1" },
    );

    expect(input.user_id).toBe("slack:U123");
    expect(input.session_id).toBe("session-1");
    const [message] = input.messages as HumanMessage[];
    expect(message).toBeInstanceOf(HumanMessage);
    expect(message.content).toBe("List projects");
    expect(message.additional_kwargs).toEqual({
      client: "slack",
      user: ada,
    });
  });

  it("stamps a teams client the same way", () => {
    const input = prepareAgentInput(
      {
        payload: {
          message: "List projects",
          client: "msteams",
          user: { id: "29:abc", actor_id: "msteams:29:abc" },
        },
      },
      {},
    );

    const [message] = input.messages as HumanMessage[];
    expect(message.additional_kwargs).toEqual({
      client: "msteams",
      user: { id: "29:abc", actor_id: "msteams:29:abc" },
    });
    expect(input).not.toHaveProperty("user_id");
    expect(input).not.toHaveProperty("session_id");
  });

  it("keeps the default human message when extras are absent", () => {
    const input = prepareAgentInput(
      { payload: { message: "hi" } },
      { userId: "playground-user" },
    );

    const [message] = input.messages as HumanMessage[];
    expect(message.content).toBe("hi");
    expect(message.additional_kwargs).toEqual({});
    expect(input.user_id).toBe("playground-user");
  });
});
