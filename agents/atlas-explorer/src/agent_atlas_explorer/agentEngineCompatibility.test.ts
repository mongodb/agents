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

import { MessageSchema } from "@mongodb-js/agent-engine-sdk";
import { describe, expect, it } from "vitest";

describe("pinned Agent Engine runtime compatibility", () => {
  it("parses content-block messages crossing the AER to Tool Pod boundary", () => {
    const message = MessageSchema.parse({
      role: "user",
      content: [{ type: "text", text: "hello" }],
    });

    expect(message.content).toEqual([{ type: "text", text: "hello" }]);
  });
});
