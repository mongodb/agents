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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { loggerError } = vi.hoisted(() => ({ loggerError: vi.fn() }));

vi.mock("@mongodb-js/agent-engine-runner-shared", () => ({
  getLogger: () => ({ error: loggerError }),
}));

import {
  McpTokenLimitError,
  classifyTokenMintError,
  throwAgentRuntimeTokenLimit,
  throwToolRuntimeTokenLimit,
  surfaceTokenMintFailures,
} from "./tokenLimit.js";

const tokenLimitDescription =
  "Access Token limit reached. Please use the existing Access Tokens or create a new Service Account";

const discoveryTokenLimit = Object.assign(
  new Error(`mcp server 'mongodb' tools/list failed: ${tokenLimitDescription}`),
  { name: "MCPConfigError" },
);

const discoveryRateLimit = Object.assign(
  new Error(
    `mcp server 'mongodb' tools/list failed: HTTP 429: Invalid OAuth error response: ZodError: invalid input. Raw body: {"status":"ERROR","errorCode":"RATE_LIMITED"}`,
  ),
  { name: "MCPConfigError" },
);

describe("classifyTokenMintError", () => {
  it("recognizes the token limit", () => {
    expect(classifyTokenMintError(discoveryTokenLimit)).toBe("token_limit");
  });

  it("recognizes the token endpoint rate limit", () => {
    expect(classifyTokenMintError(discoveryRateLimit)).toBe(
      "token_rate_limit",
    );
  });

  it("finds the failure in an error cause", () => {
    expect(
      classifyTokenMintError(
        new Error("startup failed", { cause: discoveryTokenLimit }),
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
  beforeEach(() => {
    loggerError.mockClear();
  });

  afterEach(() => {
    delete process.env["RUNNER_MODE"];
  });

  it("aborts agent startup with the agent runtime's own error", () => {
    try {
      throwAgentRuntimeTokenLimit(discoveryTokenLimit);
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
      throwToolRuntimeTokenLimit(discoveryRateLimit);
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
    expect(() => throwAgentRuntimeTokenLimit(failure)).toThrow(failure);
    expect(() => throwToolRuntimeTokenLimit(failure)).toThrow(failure);
  });

  it("uses the tool handler when the process is the tool runtime", async () => {
    process.env["RUNNER_MODE"] = "tool";
    const app = {
      ready: () => Promise.reject(discoveryTokenLimit),
    };

    surfaceTokenMintFailures(app);

    await expect(app.ready()).rejects.toMatchObject({ runtime: "tool" });
  });

  it("uses the agent handler when the process is the agent runtime", async () => {
    process.env["RUNNER_MODE"] = "aer";
    const app = {
      ready: () => Promise.reject(discoveryTokenLimit),
    };

    surfaceTokenMintFailures(app);

    await expect(app.ready()).rejects.toMatchObject({ runtime: "agent" });
  });

  it("leaves a successful startup alone", async () => {
    const app = { ready: () => Promise.resolve() };
    surfaceTokenMintFailures(app);
    await expect(app.ready()).resolves.toBeUndefined();
    expect(loggerError).not.toHaveBeenCalled();
  });

  it("logs an error naming the runtime and the limit", async () => {
    process.env["RUNNER_MODE"] = "aer";
    const app = { ready: () => Promise.reject(discoveryRateLimit) };

    surfaceTokenMintFailures(app);
    await expect(app.ready()).rejects.toBeInstanceOf(McpTokenLimitError);

    expect(loggerError).toHaveBeenCalledOnce();
    const [fields, message] = loggerError.mock.calls[0] as [
      Record<string, unknown>,
      string,
    ];
    expect(fields).toMatchObject({
      runtime: "agent",
      failure: "token_rate_limit",
    });
    expect(fields["err"]).toBeInstanceOf(McpTokenLimitError);
    expect(message).toContain("agent runtime could not mint");
  });

  it("does not log or rewrite unrelated startup failures", async () => {
    const failure = new Error("boom");
    const app = { ready: () => Promise.reject(failure) };

    surfaceTokenMintFailures(app);

    await expect(app.ready()).rejects.toBe(failure);
    expect(loggerError).not.toHaveBeenCalled();
  });

  it("surfaces a refusal that arrives before ready() is awaited", async () => {
    process.env["RUNNER_MODE"] = "aer";
    const app = { ready: () => Promise.reject(discoveryTokenLimit) };
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);

    surfaceTokenMintFailures(app);
    await new Promise((resolve) => setTimeout(resolve, 10));
    process.off("unhandledRejection", unhandled);

    expect(unhandled).not.toHaveBeenCalled();
    await expect(app.ready()).rejects.toBeInstanceOf(McpTokenLimitError);
    expect(loggerError).toHaveBeenCalledOnce();
  });
});
