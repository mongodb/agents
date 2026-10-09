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
  classifyTokenMintError,
  guardTokenMintStartup,
  handleAgentRuntimeTokenLimit,
  handleToolCallTokenLimit,
  handleToolRuntimeTokenLimit,
} from "./tokenLimit.js";

const tokenLimitDescription =
  "Access Token limit reached. Please use the existing Access Tokens or create a new Service Account";

const discoveryTokenLimit = Object.assign(
  new Error(`mcp server 'mongodb' tools/list failed: ${tokenLimitDescription}`),
  { name: "MCPConfigError" },
);

const toolCallTokenLimit = Object.assign(
  new Error(
    `mcp server 'mongodb' tool 'list-clusters' failed: ${tokenLimitDescription}`,
  ),
  { name: "MCPToolError" },
);

const discoveryRateLimit = Object.assign(
  new Error(
    `mcp server 'mongodb' tools/list failed: HTTP 429: Invalid OAuth error response: ZodError: invalid input. Raw body: {"status":"ERROR","errorCode":"RATE_LIMITED"}`,
  ),
  { name: "MCPConfigError" },
);

describe("classifyTokenMintError", () => {
  it("recognizes the token limit from discovery and tool calls", () => {
    expect(classifyTokenMintError(discoveryTokenLimit)).toBe("token_limit");
    expect(classifyTokenMintError(toolCallTokenLimit)).toBe("token_limit");
  });

  it("recognizes the token endpoint rate limit", () => {
    expect(classifyTokenMintError(discoveryRateLimit)).toBe(
      "token_rate_limit",
    );
  });

  it("finds the failure in an error cause", () => {
    expect(
      classifyTokenMintError(
        new Error("tool failed", { cause: toolCallTokenLimit }),
      ),
    ).toBe("token_limit");
  });

  it.each([
    "The agent did not become ready during startup.",
    "mcp server 'mongodb' tools/list failed: IP access list validation failed for the service account.",
    "mcp server 'mongodb' tools/list failed: HTTP 429: Too Many Requests",
    "Rate limit exceeded",
    "invalid projection",
  ])("ignores %s", (message) => {
    expect(classifyTokenMintError(new Error(message))).toBeUndefined();
  });
});

describe("token mint handlers", () => {
  afterEach(() => {
    delete process.env["RUNNER_MODE"];
  });

  it("aborts agent startup with the agent runtime's own error", () => {
    try {
      handleAgentRuntimeTokenLimit(discoveryTokenLimit);
      throw new Error("expected the agent handler to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(McpTokenLimitError);
      expect(error).toMatchObject({
        runtime: "agent",
        failure: "token_limit",
        cause: discoveryTokenLimit,
      });
      expect((error as Error).message).toContain("agent runtime");
    }
  });

  it("aborts tool startup with the tool runtime's own error", () => {
    try {
      handleToolRuntimeTokenLimit(discoveryRateLimit);
      throw new Error("expected the tool handler to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(McpTokenLimitError);
      expect(error).toMatchObject({
        runtime: "tool",
        failure: "token_rate_limit",
      });
    }
  });

  it("rethrows unrelated startup failures unchanged", () => {
    const failure = new Error("The agent did not become ready during startup.");
    expect(() => handleAgentRuntimeTokenLimit(failure)).toThrow(failure);
    expect(() => handleToolRuntimeTokenLimit(failure)).toThrow(failure);
  });

  it("tells the model to stop for about an hour at the token limit", () => {
    const text = handleToolCallTokenLimit(
      "atlas-list-clusters",
      toolCallTokenLimit,
    );

    expect(text).toContain('Tool "atlas-list-clusters"');
    expect(text).toContain("tool runtime");
    expect(text).toContain("Do not call more tools");
    expect(text).toContain("about an hour");
  });

  it("tells the model to stop for about a minute at the rate limit", () => {
    const text = handleToolCallTokenLimit(
      "atlas-list-clusters",
      discoveryRateLimit,
    );

    expect(text).toContain("Do not call more tools");
    expect(text).toContain("about a minute");
  });

  it("leaves other tool failures to the caller", () => {
    expect(
      handleToolCallTokenLimit("atlas-list-clusters", new Error("nope")),
    ).toBeUndefined();
  });

  it("uses the tool handler when the process is the tool runtime", async () => {
    process.env["RUNNER_MODE"] = "tool";
    const app = {
      ready: () => Promise.reject(discoveryTokenLimit),
    };

    guardTokenMintStartup(app);

    await expect(app.ready()).rejects.toMatchObject({ runtime: "tool" });
  });

  it("uses the agent handler when the process is the agent runtime", async () => {
    process.env["RUNNER_MODE"] = "aer";
    const app = {
      ready: () => Promise.reject(discoveryTokenLimit),
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
