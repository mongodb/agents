import { HumanMessage } from "@langchain/core/messages";
import { Command, MemorySaver } from "@langchain/langgraph";
import { createAgent, FakeToolCallingModel, tool } from "langchain";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { mutativeToolReviewMiddleware } from "./toolReview.js";

describe("Magenta tool review graph integration", () => {
  it("executes read-only calls when a protected call in the same batch is rejected", async () => {
    const readOnly = vi.fn(async () => "read completed");
    const mutation = vi.fn(async () => "write completed");
    const readTool = tool(readOnly, {
      name: "mongodb__find",
      description: "Read documents",
      schema: z.object({}),
    });
    const mutationTool = tool(mutation, {
      name: "mongodb__insert_many",
      description: "Insert documents",
      schema: z.object({}),
    });
    const model = new FakeToolCallingModel({
      toolCalls: [
        [
          {
            id: "call-read",
            name: "mongodb__find",
            args: {},
          },
          {
            id: "call-write",
            name: "mongodb__insert_many",
            args: {},
          },
        ],
        [],
      ],
    });
    const agent = createAgent({
      model,
      tools: [readTool, mutationTool],
      middleware: [mutativeToolReviewMiddleware],
      checkpointer: new MemorySaver(),
    });
    const config = {
      configurable: { thread_id: "mixed-batch-rejection" },
    };

    const suspended = await agent.invoke(
      { messages: [new HumanMessage("Read and then write")] },
      config,
    );
    expect(suspended.__interrupt__).toHaveLength(1);

    await agent.invoke(
      new Command({
        resume: {
          human_review: {
            decision: "reject",
            reviewer_notes: "Do not perform the write",
          },
        },
      }),
      config,
    );

    expect(readOnly).toHaveBeenCalledOnce();
    expect(mutation).not.toHaveBeenCalled();
  });
});
