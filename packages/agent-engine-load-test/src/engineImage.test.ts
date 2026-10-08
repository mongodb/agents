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

import { readOrchestrationEngineImage } from "./engineImage.js";
import type { CommandRunner } from "./logs/fetchLogs.js";

describe("readOrchestrationEngineImage", () => {
  it("reads component_images.oe from status JSON after the context line", async () => {
    const runner: CommandRunner = {
      async run(args) {
        expect(args).toContain("--workspace");
        expect(args).toContain("atlas-explorer");
        return {
          stdout: [
            "context: example",
            "",
            JSON.stringify({
              latest_deployment: {
                component_images: {
                  oe: "registry.example/orchestration-engine-go:v0.11.7",
                },
              },
            }),
          ].join("\n"),
          stderr: "",
          exitCode: 0,
        };
      },
    };

    await expect(
      readOrchestrationEngineImage(runner, "atlas-explorer"),
    ).resolves.toBe("registry.example/orchestration-engine-go:v0.11.7");
  });

  it("throws when status fails", async () => {
    const runner: CommandRunner = {
      async run() {
        return { stdout: "", stderr: "not logged in", exitCode: 1 };
      },
    };
    await expect(
      readOrchestrationEngineImage(runner, "atlas-explorer"),
    ).rejects.toThrow(/not logged in/);
  });
});
