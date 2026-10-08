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

import { execFile } from "node:child_process";

import type { CommandResult } from "./logs/fetchLogs.js";

export function execCommand(args: string[]): Promise<CommandResult> {
  const [command, ...rest] = args;
  if (!command) {
    return Promise.reject(new Error("Missing command"));
  }
  return new Promise((resolve, reject) => {
    execFile(
      command,
      rest,
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({
            stdout: stdout ?? "",
            stderr: stderr ?? "",
            exitCode: 0,
          });
          return;
        }
        const failed = error as NodeJS.ErrnoException & { code?: number | string };
        if (typeof failed.code === "number") {
          resolve({
            stdout: stdout ?? "",
            stderr: stderr || failed.message,
            exitCode: failed.code,
          });
          return;
        }
        reject(error);
      },
    );
  });
}
