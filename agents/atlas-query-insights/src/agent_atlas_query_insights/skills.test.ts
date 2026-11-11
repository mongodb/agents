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

import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const agentRoot = path.resolve(import.meta.dirname, "../..");
const packageSkills = path.resolve(
  agentRoot,
  "../../packages/atlas-query-insights-agent/skills",
);

/** Relative path to file contents for every file under `dir`. */
function readTree(dir: string): Record<string, string> {
  const files: Record<string, string> = {};
  for (const entry of fs.readdirSync(dir, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath, entry.name);
    files[path.relative(dir, file)] = fs.readFileSync(file, "utf8");
  }
  return files;
}

// Agent Engine reads skills from <agent root>/skills, and a deploy builds
// without the workspace packages, so this agent keeps a committed copy of
// the skills that ship in @mongodb-js/atlas-query-insights-agent.
describe("skills", () => {
  it("match the copy in @mongodb-js/atlas-query-insights-agent", () => {
    expect(
      readTree(path.join(agentRoot, "skills")),
      "agents/atlas-query-insights/skills differs from packages/atlas-query-insights-agent/skills. Copy the package's skills over.",
    ).toEqual(readTree(packageSkills));
  });
});
