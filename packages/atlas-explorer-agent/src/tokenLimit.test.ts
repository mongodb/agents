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

import { describe, expect, it } from "vitest";

import { recoverToolErrorsMiddleware } from "./index.js";

describe("access token limit handling", () => {
  it("stops the Atlas Explorer agent from retrying when the shared token limit is reached", async () => {
    const wrapToolCall = recoverToolErrorsMiddleware.wrapToolCall;
    if (!wrapToolCall) throw new Error("wrapToolCall is not defined");

    const request = {
      toolCall: { id: "call-1", name: "atlas-list-clusters", args: {} },
    };
    const result = await wrapToolCall(request as never, async () => {
      throw new Error(
        "mcp server 'mongodb' tool 'list-clusters' failed: Access Token limit reached. Please use the existing Access Tokens or create a new Service Account",
      );
    });

    expect(result).toMatchObject({
      status: "error",
      tool_call_id: "call-1",
      name: "atlas-list-clusters",
    });
    expect(String((result as { content: unknown }).content)).toContain(
      "Do not call more tools",
    );
  });
});
