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

import { afterEach, describe, expect, it } from "vitest";

import {
  McpTokenLimitError,
  guardTokenMintStartup,
  handleAgentRuntimeTokenLimit,
  handleToolCallTokenLimit,
  handleToolRuntimeTokenLimit,
  isTokenExhaustionError,
} from "./tokenLimit.js";

const startupFailure = new Error(
  "The agent did not become ready during startup.",
);

describe("token mint handlers", () => {
  afterEach(() => {
    delete process.env["RUNNER_MODE"];
  });

  it("recognizes the platform's token-limit failures", () => {
    expect(isTokenExhaustionError(startupFailure)).toBe(true);
    expect(
      isTokenExhaustionError(new Error("access token limit reached")),
    ).toBe(true);
    expect(isTokenExhaustionError(new Error("invalid projection"))).toBe(
      false,
    );
  });

  it("aborts agent startup with the agent runtime's own error", () => {
    expect(() => handleAgentRuntimeTokenLimit(startupFailure)).toThrow(
      McpTokenLimitError,
    );
    try {
      handleAgentRuntimeTokenLimit(startupFailure);
    } catch (error) {
      expect(error).toMatchObject({ runtime: "agent" });
      expect((error as Error).message).toContain("agent runtime");
    }
  });

  it("aborts tool startup with the tool runtime's own error", () => {
    try {
      handleToolRuntimeTokenLimit(
        new Error("access token limit reached"),
      );
      throw new Error("expected the tool handler to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(McpTokenLimitError);
      expect(error).toMatchObject({ runtime: "tool" });
    }
  });

  it("rethrows unrelated startup failures unchanged", () => {
    const failure = new Error("invalid projection");
    expect(() => handleAgentRuntimeTokenLimit(failure)).toThrow(failure);
    expect(() => handleToolRuntimeTokenLimit(failure)).toThrow(failure);
  });

  it("tells the model to stop when a tool call cannot mint a token", () => {
    const text = handleToolCallTokenLimit(
      "atlas-list-clusters",
      startupFailure,
    );

    expect(text).toContain('Tool "atlas-list-clusters"');
    expect(text).toContain("tool runtime");
    expect(text).toContain("Do not call more tools");
    expect(handleToolCallTokenLimit("atlas-list-clusters", new Error("nope"))).toBeUndefined();
  });

  it("uses the tool handler when the process is the tool runtime", async () => {
    process.env["RUNNER_MODE"] = "tool";
    const app = {
      ready: () => Promise.reject(startupFailure),
    };

    guardTokenMintStartup(app);

    await expect(app.ready()).rejects.toMatchObject({ runtime: "tool" });
  });

  it("uses the agent handler when the process is the agent runtime", async () => {
    process.env["RUNNER_MODE"] = "aer";
    const app = {
      ready: () => Promise.reject(new Error("access token limit reached")),
    };

    guardTokenMintStartup(app);

    await expect(app.ready()).rejects.toMatchObject({ runtime: "agent" });
  });

  it("leaves a successful startup alone", async () => {
    const app = { ready: () => Promise.resolve() };
    guardTokenMintStartup(app);
    await expect(app.ready()).resolves.toBeUndefined();
  });
});
