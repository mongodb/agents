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

import { HumanMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";

import { ScriptedChatModel } from "./scriptedModel.js";

describe("ScriptedChatModel", () => {
  it("replays turns in order and repeats the last one", async () => {
    const model = new ScriptedChatModel([
      { toolCalls: [{ name: "find", args: { a: 1 } }] },
      { text: "done" },
    ]);
    const first = await model.invoke([new HumanMessage("go")]);
    const second = await model.invoke([new HumanMessage("go")]);
    const third = await model.invoke([new HumanMessage("go")]);

    expect(first.tool_calls?.[0]).toMatchObject({
      name: "find",
      args: { a: 1 },
    });
    expect(second.content).toBe("done");
    expect(third.content).toBe("done");
    expect(model.seen).toHaveLength(3);
  });

  it("can emit Responses API style content blocks", async () => {
    const model = new ScriptedChatModel([{ text: "hi" }], true);
    const message = await model.invoke([new HumanMessage("go")]);
    expect(Array.isArray(message.content)).toBe(true);
  });
});
