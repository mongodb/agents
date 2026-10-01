import { MessageSchema } from "@mongodb-js/agent-engine-sdk";
import { describe, expect, it } from "vitest";

describe("pinned Agent Engine runtime compatibility", () => {
  it("parses content-block messages crossing the AER to Tool Pod boundary", () => {
    const message = MessageSchema.parse({
      role: "user",
      content: [{ type: "text", text: "hello" }],
    });

    expect(message.content).toEqual([{ type: "text", text: "hello" }]);
  });
});
