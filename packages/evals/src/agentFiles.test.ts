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
import { readAgentFiles } from "./agentFiles.js";

describe("readAgentFiles", () => {
  const files = readAgentFiles(atlasExplorerAgent.agentDir);

  it("keys skill files by absolute virtual path", () => {
    expect(Object.keys(files)).toContain(
      "/skills/mongodb-query-optimizer/SKILL.md",
    );
    for (const key of Object.keys(files)) {
      expect(key).toMatch(/^\/skills\//);
    }
  });

  it("holds the file text", () => {
    const skill = files["/skills/mongodb-query-optimizer/SKILL.md"];
    expect(skill.content).toEqual(expect.stringContaining("name:"));
  });

  it("returns the same files on every call", () => {
    expect(readAgentFiles(atlasExplorerAgent.agentDir)).toBe(files);
  });
});
