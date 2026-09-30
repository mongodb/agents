import { GraphInterrupt } from "@langchain/langgraph";
import { describe, expect, it } from "vitest";

import { recoverToolCall } from "./toolErrors.js";

describe("recoverToolCall", () => {
  it("returns a model-readable ToolMessage for an ordinary MCP failure", async () => {
    const result = await recoverToolCall(
      {
        toolCall: {
          id: "call-1",
          name: "mongodb__find",
        },
      },
      async () => {
        throw new Error("mixed inclusion and exclusion projection");
      },
    );

    expect(result.type).toBe("tool");
    expect(result.tool_call_id).toBe("call-1");
    expect(result.name).toBe("mongodb__find");
    expect(result.status).toBe("error");
    expect(result.content).toContain(
      "correct the tool arguments, and retry",
    );
    expect(result.content).toContain(
      "mixed inclusion and exclusion projection",
    );
  });

  it("rethrows graph interrupts so Magenta can suspend the execution", async () => {
    const interrupt = new GraphInterrupt([]);

    await expect(
      recoverToolCall(
        {
          toolCall: {
            id: "call-2",
            name: "mongodb__drop_database",
          },
        },
        async () => {
          throw interrupt;
        },
      ),
    ).rejects.toBe(interrupt);
  });
});
