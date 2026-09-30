import { AIMessage } from "@langchain/core/messages";
import { describe, expect, it, vi } from "vitest";

import { stripToolEchoMiddleware } from "./modelResponse.js";

describe("OpenAI response metadata cleanup", () => {
  it("removes tool echoes from prior messages before the model call", async () => {
    const priorMessage = new AIMessage({
      content: "prior response",
      response_metadata: {
        tools: [{ type: "function", name: "mongodb__find" }],
        model_name: "gpt-test",
      },
    });
    const request = { messages: [priorMessage] } as never;
    const handler = vi.fn(async () => new AIMessage("ready"));

    await stripToolEchoMiddleware.wrapModelCall!(request, handler);

    expect(handler).toHaveBeenCalledWith(request);
    expect(priorMessage.response_metadata).toEqual({
      model_name: "gpt-test",
    });
  });

  it("removes echoed tools before checkpointing and preserves useful metadata", async () => {
    const message = new AIMessage({
      content: "ready",
      response_metadata: {
        tools: [{ type: "function", name: "mongodb__find" }],
        usage: { input_tokens: 10, output_tokens: 2 },
        model_name: "gpt-test",
      },
    });
    const handler = vi.fn(async () => message);

    const result = await stripToolEchoMiddleware.wrapModelCall!(
      { messages: [] } as never,
      handler,
    );

    expect(handler).toHaveBeenCalledOnce();
    expect(result).toBe(message);
    expect(message.response_metadata).toEqual({
      usage: { input_tokens: 10, output_tokens: 2 },
      model_name: "gpt-test",
    });
  });
});
