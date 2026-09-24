import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { Command } from "@langchain/langgraph";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  isMagentaResume,
  stampResumeClientUserMiddleware,
  stampResumeMessages,
} from "./stampResume.js";

const payloadMock = vi.hoisted(() => ({
  current: null as Record<string, unknown> | null,
}));

vi.mock("@mongodb-js/agent-engine-runner-shared", () => ({
  getCurrentPayload: () => payloadMock.current,
}));

const ada = {
  id: "U123",
  username: "ada",
  full_name: "Ada Lovelace",
  actor_id: "slack:U123",
};

const ben = {
  id: "U999",
  username: "ben",
  full_name: "Ben Approver",
  actor_id: "slack:U999",
};

function resumeRuntime(resume = true) {
  return {
    configurable: {
      request_context: { resume, executionId: "exec-1" },
    },
  };
}

function afterModel(
  messages: Array<AIMessage | HumanMessage | ToolMessage>,
  runtime: ReturnType<typeof resumeRuntime>,
) {
  const hook = stampResumeClientUserMiddleware.afterModel;
  const fn = typeof hook === "function" ? hook : hook?.hook;
  if (typeof fn !== "function") {
    throw new Error("afterModel hook missing");
  }
  return fn({ messages } as never, runtime as never);
}

describe("stampResumeMessages", () => {
  const request = new HumanMessage({
    id: "human-1",
    content: "Drop the collection",
    additional_kwargs: { client: "slack", user: ada },
  });
  const pending = new AIMessage({
    id: "ai-1",
    content: "",
    tool_calls: [
      {
        id: "call-1",
        name: "mongodb__drop_collection",
        args: { collection: "tmp" },
        type: "tool_call",
      },
    ],
  });

  it("stamps a different resume user on the interrupted AI message", () => {
    const update = stampResumeMessages([request, pending], {
      client: "slack",
      user: ben,
    });

    expect(update?.messages).toHaveLength(1);
    const [stamped] = update!.messages;
    expect(stamped).toBeInstanceOf(AIMessage);
    expect(stamped.id).toBe("ai-1");
    expect(stamped.additional_kwargs).toEqual({
      client: "slack",
      user: ben,
    });
    expect(request.additional_kwargs).toEqual({
      client: "slack",
      user: ada,
    });
    expect((stamped as AIMessage).tool_calls).toEqual(pending.tool_calls);
  });

  it("stamps reject tool messages that follow the interrupted AI message", () => {
    const rejection = new ToolMessage({
      id: "tool-1",
      content: "User rejected the tool call",
      tool_call_id: "call-1",
      name: "mongodb__drop_collection",
      status: "error",
    });

    const update = stampResumeMessages([request, pending, rejection], {
      client: "msteams",
      user: { id: "29:xyz", actor_id: "msteams:29:xyz" },
    });

    expect(update?.messages).toHaveLength(2);
    expect(update?.messages[0]?.additional_kwargs).toEqual({
      client: "msteams",
      user: { id: "29:xyz", actor_id: "msteams:29:xyz" },
    });
    expect(update?.messages[1]).toBeInstanceOf(ToolMessage);
    expect(update?.messages[1]?.id).toBe("tool-1");
    expect(update?.messages[1]?.additional_kwargs).toEqual({
      client: "msteams",
      user: { id: "29:xyz", actor_id: "msteams:29:xyz" },
    });
  });

  it("does nothing when there is no AI message to stamp", () => {
    expect(stampResumeMessages([request], { client: "slack", user: ben })).toBeUndefined();
  });
});

describe("isMagentaResume", () => {
  it("reads Magenta request_context.resume", () => {
    expect(isMagentaResume(resumeRuntime(true))).toBe(true);
    expect(isMagentaResume(resumeRuntime(false))).toBe(false);
    expect(isMagentaResume({ configurable: {} })).toBe(false);
    expect(isMagentaResume(undefined)).toBe(false);
  });
});

describe("stampResumeClientUserMiddleware", () => {
  beforeEach(() => {
    payloadMock.current = null;
  });

  it("stamps afterModel on a Magenta resume with payload extras", () => {
    payloadMock.current = { client: "slack", user: ben };
    const pending = new AIMessage({
      id: "ai-resume",
      content: "",
      tool_calls: [
        {
          id: "call-1",
          name: "mongodb__drop_collection",
          args: {},
          type: "tool_call",
        },
      ],
    });

    const update = afterModel([pending], resumeRuntime());

    expect(update).toMatchObject({
      messages: [
        expect.objectContaining({
          id: "ai-resume",
          additional_kwargs: { client: "slack", user: ben },
        }),
      ],
    });
  });

  it("does not stamp a fresh invoke afterModel", () => {
    payloadMock.current = { client: "slack", user: ben };
    const pending = new AIMessage({
      id: "ai-fresh",
      content: "",
      tool_calls: [
        {
          id: "call-1",
          name: "mongodb__drop_collection",
          args: {},
          type: "tool_call",
        },
      ],
    });

    expect(afterModel([pending], resumeRuntime(false))).toBeUndefined();
  });

  it("does not stamp a playground resume with no extras", () => {
    payloadMock.current = { message: "approve" };
    const pending = new AIMessage({
      id: "ai-playground",
      content: "",
      tool_calls: [
        {
          id: "call-1",
          name: "mongodb__drop_collection",
          args: {},
          type: "tool_call",
        },
      ],
    });

    expect(afterModel([pending], resumeRuntime())).toBeUndefined();
  });

  it("returns a Command from wrapModelCall so reject resumes persist the stamp", async () => {
    payloadMock.current = {
      client: "msteams",
      user: { id: "29:abc", actor_id: "msteams:29:abc" },
    };
    const pending = new AIMessage({
      id: "ai-reject",
      content: "",
      tool_calls: [
        {
          id: "call-1",
          name: "mongodb__drop_collection",
          args: {},
          type: "tool_call",
        },
      ],
    });
    const rejection = new ToolMessage({
      id: "tool-reject",
      content: "rejected",
      tool_call_id: "call-1",
      name: "mongodb__drop_collection",
      status: "error",
    });
    const reply = new AIMessage({ id: "ai-next", content: "okay" });
    const handler = vi.fn(async () => reply);

    const result = await stampResumeClientUserMiddleware.wrapModelCall!(
      {
        messages: [pending, rejection],
        state: { messages: [pending, rejection] },
        runtime: resumeRuntime(),
      } as never,
      handler,
    );

    expect(handler).toHaveBeenCalledOnce();
    expect(result).toBeInstanceOf(Command);
    expect((result as Command).update).toMatchObject({
      messages: [
        expect.objectContaining({
          id: "ai-reject",
          additional_kwargs: {
            client: "msteams",
            user: { id: "29:abc", actor_id: "msteams:29:abc" },
          },
        }),
        expect.objectContaining({
          id: "tool-reject",
          additional_kwargs: {
            client: "msteams",
            user: { id: "29:abc", actor_id: "msteams:29:abc" },
          },
        }),
      ],
    });
  });

  it("stamps a Magenta resume only once", async () => {
    payloadMock.current = { client: "slack", user: ben };
    const runtime = resumeRuntime();
    const pending = new AIMessage({
      id: "ai-once",
      content: "",
      tool_calls: [
        {
          id: "call-1",
          name: "mongodb__drop_collection",
          args: {},
          type: "tool_call",
        },
      ],
    });

    const first = afterModel([pending], runtime);
    const second = afterModel([pending], runtime);
    const wrap = await stampResumeClientUserMiddleware.wrapModelCall!(
      {
        messages: [pending],
        state: { messages: [pending] },
        runtime,
      } as never,
      async () => new AIMessage("later"),
    );

    expect(first).toBeDefined();
    expect(second).toBeUndefined();
    expect(wrap).toBeInstanceOf(AIMessage);
  });
});
