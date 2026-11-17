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

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  aggregatePipelineWrites,
  approveAggregateWritesMiddleware,
  guardAggregateWrite,
  rejectAggregateWrite,
  rejectAggregateWritesMiddleware,
} from "./aggregateWriteApproval.js";

const interrupt = vi.hoisted(() => vi.fn());

vi.mock("@langchain/langgraph", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@langchain/langgraph")>();
  return {
    ...actual,
    interrupt,
  };
});

const readPipeline = [{ $match: { status: "open" } }, { $count: "n" }];
const outPipeline = [...readPipeline, { $out: "daily_counts" }];
const mergePipeline = [{ $merge: { into: "archive" } }];

function aggregateRequest(
  name: string,
  pipeline: unknown,
  id = "call-1",
) {
  return {
    toolCall: {
      id,
      name,
      args: { database: "app", collection: "orders", pipeline },
    },
  };
}

describe("aggregatePipelineWrites", () => {
  it("ignores read stages, including $mergeObjects", () => {
    expect(aggregatePipelineWrites(readPipeline)).toBe(false);
    expect(
      aggregatePipelineWrites([
        { $project: { pair: { $mergeObjects: ["$a", "$b"] } } },
      ]),
    ).toBe(false);
    expect(aggregatePipelineWrites(undefined)).toBe(false);
    expect(aggregatePipelineWrites([])).toBe(false);
  });

  it("detects $out and $merge on any stage, including a JSON string", () => {
    expect(aggregatePipelineWrites(outPipeline)).toBe(true);
    expect(aggregatePipelineWrites(mergePipeline)).toBe(true);
    expect(aggregatePipelineWrites([{ $match: { n: 1 } }, { $out: "c" }])).toBe(
      true,
    );
    expect(aggregatePipelineWrites(JSON.stringify(outPipeline))).toBe(true);
    expect(aggregatePipelineWrites({ $merge: { into: "archive" } })).toBe(true);
    expect(aggregatePipelineWrites('[{ "$out": "c" }]')).toBe(true);
    expect(aggregatePipelineWrites("[{ $merge: { into: 'archive' } }]")).toBe(
      true,
    );
    expect(
      aggregatePipelineWrites([
        { $facet: { copy: [{ $match: { n: 1 } }, { $out: "hidden" }] } },
      ]),
    ).toBe(true);
    expect(
      aggregatePipelineWrites([
        {
          $project: {
            dest: "$out",
            pair: { $mergeObjects: ["$a", "$b"] },
          },
        },
      ]),
    ).toBe(false);
  });
});

describe("guardAggregateWrite", () => {
  beforeEach(() => {
    interrupt.mockReset();
  });

  it.each(["mongodb__aggregate", "mongodb__aggregate_db"] as const)(
    "runs a read %s pipeline without approval",
    async (name) => {
      const request = aggregateRequest(name, readPipeline);
      const handler = vi.fn(async () => "rows");

      await expect(guardAggregateWrite(request, handler)).resolves.toBe("rows");

      expect(interrupt).not.toHaveBeenCalled();
      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith(request);
    },
  );

  it("does not approve unrelated tools that mention a pipeline", async () => {
    const request = aggregateRequest("mongodb__find", outPipeline);
    const handler = vi.fn(async () => "rows");

    await expect(guardAggregateWrite(request, handler)).resolves.toBe("rows");
    expect(interrupt).not.toHaveBeenCalled();
  });

  it.each(["mongodb__aggregate", "mongodb__aggregate_db"] as const)(
    "suspends %s before a $out or $merge pipeline reaches the tool",
    async (name) => {
      const pipeline = name.endsWith("_db") ? mergePipeline : outPipeline;
      const request = aggregateRequest(name, pipeline, "call-write");
      const handler = vi.fn(async () => "wrote");
      interrupt.mockImplementation(() => {
        throw new Error("suspended for approval");
      });

      await expect(guardAggregateWrite(request, handler)).rejects.toThrow(
        "suspended for approval",
      );

      expect(handler).not.toHaveBeenCalled();
      expect(interrupt).toHaveBeenCalledOnce();
      expect(interrupt.mock.calls[0]?.[0]).toMatchObject({
        actionRequests: [
          {
            name,
            args: request.toolCall.args,
            description: expect.stringContaining("$out or $merge"),
          },
        ],
        reviewConfigs: [
          {
            actionName: name,
            allowedDecisions: ["approve", "edit", "reject"],
          },
        ],
      });
    },
  );

  it("runs the original call only after approval", async () => {
    const request = aggregateRequest(
      "mongodb__aggregate",
      JSON.stringify(outPipeline),
    );
    const handler = vi.fn(async (next) => next);
    interrupt.mockReturnValue({ decisions: [{ type: "approve" }] });

    await expect(guardAggregateWrite(request, handler)).resolves.toBe(request);
    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(request);
  });

  it("does not run a rejected write", async () => {
    const request = aggregateRequest("mongodb__aggregate_db", mergePipeline);
    const handler = vi.fn(async () => "wrote");
    interrupt.mockReturnValue({
      decisions: [{ type: "reject", message: "The chat user rejected this operation." }],
    });

    const result = await guardAggregateWrite(request, handler);

    expect(handler).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      type: "tool",
      status: "error",
      name: "mongodb__aggregate_db",
      tool_call_id: "call-1",
      content: "The chat user rejected this operation.",
    });
  });

  it("runs an edited call instead of the original write", async () => {
    const request = aggregateRequest("mongodb__aggregate", outPipeline);
    const editedArgs = {
      database: "app",
      collection: "orders",
      pipeline: readPipeline,
    };
    const handler = vi.fn(async (next: typeof request) => next.toolCall);
    interrupt.mockReturnValue({
      decisions: [
        {
          type: "edit",
          editedAction: { name: "mongodb__aggregate", args: editedArgs },
        },
      ],
    });

    await expect(guardAggregateWrite(request, handler)).resolves.toMatchObject({
      name: "mongodb__aggregate",
      args: editedArgs,
      id: "call-1",
    });
    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0]?.[0]).not.toBe(request);
  });

  it("does not run the tool when the resume value has no decision", async () => {
    const request = aggregateRequest("mongodb__aggregate", outPipeline);
    const handler = vi.fn(async () => "wrote");
    interrupt.mockReturnValue({ decisions: [] });

    await expect(guardAggregateWrite(request, handler)).rejects.toThrow(
      "exactly one decision",
    );
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("rejectAggregateWrite", () => {
  beforeEach(() => {
    interrupt.mockReset();
  });

  it("runs a read pipeline without interrupting", async () => {
    const request = aggregateRequest("mongodb__aggregate", readPipeline);
    const handler = vi.fn(async () => "rows");

    await expect(rejectAggregateWrite(request, handler)).resolves.toBe("rows");

    expect(handler).toHaveBeenCalledOnce();
    expect(interrupt).not.toHaveBeenCalled();
  });

  it.each(["mongodb__aggregate", "mongodb__aggregate_db"] as const)(
    "rejects a %s write pipeline without calling the tool",
    async (name) => {
      const pipeline = name.endsWith("_db") ? mergePipeline : outPipeline;
      const request = aggregateRequest(name, pipeline);
      const handler = vi.fn(async () => "wrote");

      const result = await rejectAggregateWrite(request, handler);

      expect(handler).not.toHaveBeenCalled();
      expect(interrupt).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        type: "tool",
        status: "error",
        name,
        tool_call_id: "call-1",
        content: expect.stringContaining("read-only"),
      });
    },
  );
});

describe("approveAggregateWritesMiddleware", () => {
  beforeEach(() => {
    interrupt.mockReset();
  });

  it("routes wrapped tool calls through the same approval guard", async () => {
    const request = aggregateRequest("mongodb__aggregate", outPipeline);
    const handler = vi.fn(async () => "wrote");
    interrupt.mockReturnValue({
      decisions: [{ type: "reject", message: "no" }],
    });

    const result = await approveAggregateWritesMiddleware.wrapToolCall?.(
      request as never,
      handler as never,
    );

    expect(approveAggregateWritesMiddleware.name).toBe("approveAggregateWrites");
    expect(handler).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: "error", content: "no" });
  });
});

describe("rejectAggregateWritesMiddleware", () => {
  beforeEach(() => {
    interrupt.mockReset();
  });

  it("rejects wrapped write calls without approval", async () => {
    const request = aggregateRequest("mongodb__aggregate", outPipeline);
    const handler = vi.fn(async () => "wrote");

    const result = await rejectAggregateWritesMiddleware.wrapToolCall?.(
      request as never,
      handler as never,
    );

    expect(rejectAggregateWritesMiddleware.name).toBe("rejectAggregateWrites");
    expect(handler).not.toHaveBeenCalled();
    expect(interrupt).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: "error",
      content: expect.stringContaining("$out and $merge"),
    });
  });
});
