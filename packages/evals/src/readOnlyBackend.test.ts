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

import { atlasExplorerAgent } from "./agents/atlasExplorer.js";
import { readOnlyAgentBackend } from "./readOnlyBackend.js";

describe("readOnlyAgentBackend", () => {
  const backend = readOnlyAgentBackend(atlasExplorerAgent.agentDir) as Record<
    string,
    (...args: unknown[]) => Promise<{ error?: string }>
  >;

  it("reads files under the agent directory", async () => {
    const result = (await backend.ls("/skills")) as unknown as {
      files?: { path: string }[];
    };
    expect(JSON.stringify(result)).toContain("mongodb-query-optimizer");
  });

  it("refuses writes and edits", async () => {
    expect((await backend.write("/skills/x.md", "x")).error).toMatch(/read-only/);
    expect((await backend.edit("/skills/x.md", "a", "b")).error).toMatch(
      /read-only/,
    );
  });

  it("has no shell and no upload", () => {
    expect("execute" in backend).toBe(false);
    expect("uploadFiles" in backend).toBe(false);
  });
});
