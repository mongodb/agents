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

import { GraphInterrupt } from "@langchain/langgraph";
import { describe, expect, it } from "vitest";

import { formatTokenLimitForAgent } from "./tokenLimit.js";
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

  it.each([
    "Agent did not become ready during startup",
    "MCP request rejected: access token limit reached for service account",
  ])("tells the model to stop retrying when %s", async (message) => {
    const result = await recoverToolCall(
      {
        toolCall: {
          id: "call-3",
          name: "atlas-list-clusters",
        },
      },
      async () => {
        throw new Error(message);
      },
    );

    expect(result.status).toBe("error");
    expect(result.tool_call_id).toBe("call-3");
    expect(result.content).toBe(
      formatTokenLimitForAgent("atlas-list-clusters"),
    );
    expect(result.content).toContain("Do not call more tools");
    expect(result.content).not.toContain("correct the tool arguments");
    expect(result.content).not.toContain(message);
  });

  it("recognizes token exhaustion reported through an error cause", async () => {
    const result = await recoverToolCall(
      { toolCall: { id: "call-4", name: "atlas-list-projects" } },
      async () => {
        throw new Error("tool failed", {
          cause: new Error("Access token limit exceeded"),
        });
      },
    );

    expect(result.content).toBe(
      formatTokenLimitForAgent("atlas-list-projects"),
    );
  });

  it("rethrows graph interrupts so Agent Engine can suspend the execution", async () => {
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
