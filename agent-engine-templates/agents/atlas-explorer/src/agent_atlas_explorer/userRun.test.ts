import { HumanMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";

import { prepareAtlasExplorerInput } from "./userRun.js";

const ada = {
  id: "U123",
  username: "ada",
  full_name: "Ada Lovelace",
  actor_id: "slack:U123",
};

describe("prepareAtlasExplorerInput", () => {
  it("stamps slack client user extras on the root human message", () => {
    const input = prepareAtlasExplorerInput(
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
    const input = prepareAtlasExplorerInput(
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
    const input = prepareAtlasExplorerInput(
      { payload: { message: "hi" } },
      { userId: "playground-user" },
    );

    const [message] = input.messages as HumanMessage[];
    expect(message.content).toBe("hi");
    expect(message.additional_kwargs).toEqual({});
    expect(input.user_id).toBe("playground-user");
  });
});
