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

import { FilesystemBackend } from "deepagents";
import { withoutShellExecution } from "@repo/agent-engine-core";

/**
 * The agent's own directory (skills, notes) as a virtual filesystem. Like
 * production, there is no shell. Unlike production, writes fail: a case must
 * not edit the repo, and cases run concurrently.
 */
export function readOnlyAgentBackend(agentDir: string) {
  const fs = new FilesystemBackend({ rootDir: agentDir, virtualMode: true });
  const readOnly = new Proxy(fs, {
    get(target, property, receiver) {
      if (property === "uploadFiles") return undefined;
      if (property === "write" || property === "edit") {
        return async (path: string) => ({
          error: `The eval harness filesystem is read-only: ${path}`,
        });
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
    has(target, property) {
      return property === "uploadFiles" ? false : Reflect.has(target, property);
    },
  });
  return withoutShellExecution(readOnly);
}
