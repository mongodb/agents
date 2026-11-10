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

import { fileURLToPath } from "node:url";

import {
  runSyncSkillsCli,
  type RunSyncSkillsCliOptions,
} from "@mongodb-js/agent-engine-core/sync-skills";

export const ATLAS_EXPLORER_SKILLS_DIR = fileURLToPath(
  new URL("../skills", import.meta.url),
);

export function runAtlasExplorerCli(
  argv: readonly string[],
  options?: Pick<RunSyncSkillsCliOptions, "cwd" | "stdout" | "stderr">,
): Promise<number> {
  return runSyncSkillsCli({
    binName: "atlas-explorer-agent",
    sourceDir: ATLAS_EXPLORER_SKILLS_DIR,
    argv,
    ...options,
  });
}
