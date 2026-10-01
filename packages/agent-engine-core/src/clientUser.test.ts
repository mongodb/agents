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
