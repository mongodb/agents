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

import { runSkillsCli } from "@mongodb-js/agent-engine-core/sync-skills";

import { BUNDLED_SKILLS_DIR } from "./skills.js";

process.exitCode = await runSkillsCli({
  bin: "atlas-query-insights-agent",
  skillsDir: BUNDLED_SKILLS_DIR,
  argv: process.argv.slice(2),
  cwd: process.cwd(),
});
