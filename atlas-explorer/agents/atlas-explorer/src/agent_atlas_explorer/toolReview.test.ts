import { AIMessage } from "@langchain/core/messages";
import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  interrupt: vi.fn(),
}));

vi.mock("@langchain/langgraph", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@langchain/langgraph")>();
  return {
    ...actual,
    interrupt: harness.interrupt,
  };
});

import {
  mutativeToolReviewMiddleware,
  parseHumanReview,
} from "./toolReview.js";

async function runAfterModel(message: AIMessage): Promise<unknown> {
  const afterModel = mutativeToolReviewMiddleware.afterModel;
  if (!afterModel) throw new Error("Review middleware has no afterModel hook");
  const hook = typeof afterModel === "function" ? afterModel : afterModel.hook;
  return hook({ messages: [message] } as never, {} as never);
}

describe("Magenta tool review", () => {
  beforeEach(() => {
    harness.interrupt.mockReset();
  });

  it("reads the wrapped review value returned by Magenta on resume", () => {
    expect(
      parseHumanReview({
        human_review: {
          decision: "approve",
          reviewer_notes: "Checked the target collection",
        },
      }),
    ).toEqual({
      decision: "approve",
      reviewerNotes: "Checked the target collection",
    });
  });

  it("accepts a flat API-shaped review and normalizes decision casing", () => {
    expect(
      parseHumanReview({
        decision: "REJECT",
        reviewer_notes: "Collection name is incorrect",
      }),
    ).toEqual({
      decision: "reject",
      reviewerNotes: "Collection name is incorrect",
    });
  });

  it("rejects resume decisions that the interrupt did not allow", () => {
    expect(() =>
      parseHumanReview({
        human_review: { decision: "edit" },
      }),
    ).toThrow(/expected "approve" or "reject"/);
  });

  it("fails clearly when resume data has no decision", () => {
    expect(() =>
      parseHumanReview({
        human_review: { reviewer_notes: "No decision selected" },
      }),
    ).toThrow(/missing decision/);
  });

  it("does not suspend read-only tool calls", async () => {
    harness.interrupt.mockImplementation(() => {
      throw new Error("read-only calls must not interrupt");
    });
    const message = new AIMessage({
      content: "",
      tool_calls: [
        {
          id: "call-read",
          name: "mongodb__find",
          args: { database: "sample", collection: "customers" },
          type: "tool_call",
        },
      ],
    });

    await expect(runAfterModel(message)).resolves.toBeUndefined();
  });

  it("suspends a protected mutation with reviewer-facing context", async () => {
    harness.interrupt.mockReturnValue({
      human_review: { decision: "approve" },
    });
    const args = {
      database: "sample",
      collection: "customers",
      documents: [{ email: "ada@example.com" }],
    };
    const message = new AIMessage({
      content: "",
      tool_calls: [
        {
          id: "call-write",
          name: "mongodb__insert_many",
          args,
          type: "tool_call",
        },
      ],
    });

    await expect(runAfterModel(message)).resolves.toBeUndefined();
    expect(harness.interrupt).toHaveBeenCalledWith({
      suspend_reason: "awaiting_human_review",
      suspend_context: {
        allowed_decisions: ["approve", "reject"],
        instructions:
          "Approve to execute this MongoDB/Atlas mutation, or reject to skip it.",
        tool_name: "mongodb__insert_many",
        arguments: args,
        tools: [
          {
            id: "call-write",
            name: "mongodb__insert_many",
            args,
          },
        ],
      },
    });
    expect(message.tool_calls).toHaveLength(1);
  });

  it("turns a rejected mutation into a tool error and returns to the model", async () => {
    harness.interrupt.mockReturnValue({
      human_review: {
        decision: "REJECT",
        reviewer_notes: "Use the staging database instead",
      },
    });
    const message = new AIMessage({
      content: "",
      tool_calls: [
        {
          id: "call-rejected",
          name: "mongodb__drop_collection",
          args: { database: "production", collection: "customers" },
          type: "tool_call",
        },
      ],
    });

    const result = (await runAfterModel(message)) as {
      jumpTo: string;
      messages: Array<{
        type: string;
        content: unknown;
        status?: string;
        tool_call_id?: string;
      }>;
    };

    expect(result.jumpTo).toBe("model");
    expect(result.messages[0]).toBe(message);
    expect(result.messages[1]).toMatchObject({
      type: "tool",
      status: "error",
      tool_call_id: "call-rejected",
    });
    expect(result.messages[1]?.content).toContain(
      "Use the staging database instead",
    );
  });

  it("rejects every protected tool in a reviewed batch", async () => {
    harness.interrupt.mockReturnValue({
      human_review: { decision: "reject" },
    });
    const message = new AIMessage({
      content: "",
      tool_calls: [
        {
          id: "call-insert",
          name: "mongodb__insert_many",
          args: { database: "sample", collection: "customers", documents: [] },
          type: "tool_call",
        },
        {
          id: "call-index",
          name: "mongodb__create_index",
          args: { database: "sample", collection: "customers", keys: {} },
          type: "tool_call",
        },
      ],
    });

    const result = (await runAfterModel(message)) as {
      messages: Array<{ tool_call_id?: string }>;
    };

    expect(result.messages.slice(1)).toMatchObject([
      { tool_call_id: "call-insert" },
      { tool_call_id: "call-index" },
    ]);
  });

  it("fails closed when a protected tool call has no stable id", async () => {
    harness.interrupt.mockReturnValue({
      human_review: { decision: "reject" },
    });
    const message = new AIMessage({
      content: "",
      tool_calls: [
        {
          name: "mongodb__insert_many",
          args: { database: "sample", collection: "customers", documents: [] },
          type: "tool_call",
        },
      ],
    });

    await expect(runAfterModel(message)).rejects.toThrow(/missing tool call id/);
  });
});
