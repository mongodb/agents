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

import {
  AIMessage,
  HumanMessage,
  ToolMessage,
} from "@langchain/core/messages";
import { describe, expect, it } from "vitest";

import {
  contentToText,
  convertLangchainMessagesToAssistantEvalMessages,
} from "./convertLangchainMessagesToAssistantEvalMessages.js";

describe("contentToText", () => {
  it("passes strings through", () => {
    expect(contentToText("hello")).toBe("hello");
  });

  it("keeps only text from Responses API block content", () => {
    expect(
      contentToText([
        { type: "reasoning", id: "rs_1", summary: [] },
        { type: "text", text: "a" },
        { type: "text", text: "b" },
      ]),
    ).toBe("ab");
  });
});

describe("convertLangchainMessagesToAssistantEvalMessages", () => {
  it("maps a tool-calling turn to the library message shape", () => {
    const messages = convertLangchainMessagesToAssistantEvalMessages([
      new HumanMessage("list my clusters"),
      new AIMessage({
        content: "",
        tool_calls: [
          {
            id: "call_1",
            name: "mongodb__atlas_list_clusters",
            args: { projectId: "p1" },
            type: "tool_call",
          },
        ],
      }),
      new ToolMessage({
        content: "cluster-a",
        name: "mongodb__atlas_list_clusters",
        tool_call_id: "call_1",
      }),
      new AIMessage("You have cluster-a."),
    ]);

    expect(messages).toEqual([
      { role: "user", content: "list my clusters" },
      {
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "call_1",
            type: "function",
            function: {
              name: "mongodb__atlas_list_clusters",
              arguments: JSON.stringify({ projectId: "p1" }),
            },
          },
        ],
      },
      {
        role: "tool",
        content: "cluster-a",
        name: "mongodb__atlas_list_clusters",
        toolCallId: "call_1",
      },
      { role: "assistant", content: "You have cluster-a." },
    ]);
  });
});
