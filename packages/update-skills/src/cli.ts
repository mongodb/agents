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

import { hideBin } from "yargs/helpers";

import { runCli } from "./command.js";

try {
  // pnpm sets INIT_CWD to the directory it was run from, so relative agent
  // paths work from the repo root even though the script runs in this package.
  process.exitCode = await runCli(
    hideBin(process.argv),
    process.env.INIT_CWD ?? process.cwd(),
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
