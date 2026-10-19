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

import { AIMessage, ToolMessage } from "@langchain/core/messages";
import { Command } from "@langchain/langgraph";
import { afterEach, describe, expect, it, vi } from "vitest";

import { redactSecretText, redactSecretsMiddleware } from "./redactSecrets.js";

const OPENAI_KEY = "sk-proj-abcdefghijklmnopqrstuvwxyz012345";
const ANTHROPIC_KEY = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789";
const ATLAS_SECRET = "mdb_sa_sk_fake-not-a-real-secret";
const MONGO_URI =
  "mongodb+srv://ada.lovelace:s3cr3t-pass@cluster0.example.mongodb.net/admin";
const PEM = [
  "-----BEGIN RSA PRIVATE KEY-----",
  "MIIEowIBAAKCAQEA7exampleprivatekeymaterial",
  "-----END RSA PRIVATE KEY-----",
].join("\n");

describe("redactSecretText", () => {
  it("redacts MongoDB URIs with embedded credentials and keeps the host", () => {
    const result = redactSecretText(
      `Connect with ${MONGO_URI} or mongodb://appuser:p%40ssw0rd@localhost:27017/db.`,
    );

    expect(result.kinds).toEqual(["mongodb-uri"]);
    expect(result.text).toBe(
      "Connect with mongodb+srv://[redacted-username]:[redacted-password]@cluster0.example.mongodb.net/admin or mongodb://[redacted-username]:[redacted-password]@localhost:27017/db.",
    );
    expect(result.text).not.toContain("s3cr3t-pass");
    expect(result.text).not.toContain("p%40ssw0rd");
    expect(result.text).not.toContain("ada.lovelace");
  });

  it("leaves MongoDB URIs without credentials unchanged", () => {
    const text = "The local server is mongodb://localhost:27017.";
    expect(redactSecretText(text)).toEqual({ text, kinds: [] });
  });

  it("redacts OpenAI and Anthropic keys to the same placeholder", () => {
    const result = redactSecretText(
      `openai ${OPENAI_KEY} anthropic ${ANTHROPIC_KEY}`,
    );

    expect(result.kinds).toEqual(["api-key"]);
    expect(result.text).toBe(
      "openai sk-[redacted-api-key] anthropic sk-[redacted-api-key]",
    );
    expect(result.text).not.toContain(OPENAI_KEY);
    expect(result.text).not.toContain(ANTHROPIC_KEY);
  });

  it("consumes a trailing hyphen instead of leaving it after the placeholder", () => {
    const key = `${OPENAI_KEY}-`;
    const result = redactSecretText(`token ${key} next`);

    expect(result.text).toBe("token sk-[redacted-api-key] next");
    expect(result.text).not.toContain("abcdefghijklmnopqrstuvwxyz");
  });

  it("redacts Atlas service-account secrets", () => {
    const result = redactSecretText(`secret ${ATLAS_SECRET} end`);

    expect(result.kinds).toEqual(["atlas-service-account"]);
    expect(result.text).toBe("secret mdb_sa_sk_[redacted-api-key] end");
    expect(result.text).not.toContain("not-a-real-secret");
  });

  it("redacts PEM private key blocks", () => {
    const result = redactSecretText(`key follows\n${PEM}\nthanks`);

    expect(result.kinds).toEqual(["private-key"]);
    expect(result.text).toBe("key follows\n[redacted-private-key]\nthanks");
    expect(result.text).not.toContain("exampleprivatekeymaterial");
  });

  it("redacts every pattern in one reply", () => {
    const result = redactSecretText(
      `${MONGO_URI}\n${OPENAI_KEY}\n${ATLAS_SECRET}\n${PEM}`,
    );

    expect(result.kinds).toEqual([
      "private-key",
      "mongodb-uri",
      "atlas-service-account",
      "api-key",
    ]);
    expect(result.text).not.toContain("s3cr3t-pass");
    expect(result.text).not.toContain(OPENAI_KEY);
    expect(result.text).not.toContain(ATLAS_SECRET);
    expect(result.text).not.toContain("BEGIN RSA PRIVATE KEY");
  });

  it("leaves an ordinary reply unchanged", () => {
    const text =
      "Cluster prod is healthy. p95 latency is 12ms. No credentials were requested.";
    expect(redactSecretText(text)).toEqual({ text, kinds: [] });
  });
});

describe("redactSecretsMiddleware", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("redacts the assistant message without mutating the original and warns without the secret value", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const originalContent = `Use ${MONGO_URI} and ${ATLAS_SECRET}.`;
    const message = new AIMessage({
      content: originalContent,
    });
    const handler = vi.fn(async () => message);

    const result = await redactSecretsMiddleware.wrapModelCall!(
      { messages: [] } as never,
      handler,
    );

    expect(result).not.toBe(message);
    expect(message.content).toBe(originalContent);
    expect(AIMessage.isInstance(result)).toBe(true);
    expect((result as AIMessage).content).toBe(
      "Use mongodb+srv://[redacted-username]:[redacted-password]@cluster0.example.mongodb.net/admin and mdb_sa_sk_[redacted-api-key].",
    );
    expect(warn).toHaveBeenCalledOnce();
    const warning = String(warn.mock.calls[0]?.[0]);
    expect(warning).toContain("mongodb-uri");
    expect(warning).toContain("atlas-service-account");
    expect(warning).not.toContain("s3cr3t-pass");
    expect(warning).not.toContain(ATLAS_SECRET);
  });

  it("redacts text blocks and leaves a clean reply untouched", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const secretMessage = new AIMessage({
      content: [{ type: "text", text: `Key ${OPENAI_KEY}` }],
    });
    const redactedMessage = await redactSecretsMiddleware.wrapModelCall!(
      { messages: [] } as never,
      async () => secretMessage,
    );
    expect(redactedMessage).not.toBe(secretMessage);
    expect((redactedMessage as AIMessage).content).toEqual([
      { type: "text", text: "Key sk-[redacted-api-key]" },
    ]);

    warn.mockClear();
    const clean = new AIMessage("Nothing sensitive here.");
    const returned = await redactSecretsMiddleware.wrapModelCall!(
      { messages: [] } as never,
      async () => clean,
    );
    expect(returned).toBe(clean);
    expect(clean.content).toBe("Nothing sensitive here.");
    expect(warn).not.toHaveBeenCalled();
  });

  it("redacts ToolMessage content in wrapToolCall without mutating the original and warns without the secret value", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const originalContent = `Failed connecting to ${MONGO_URI} with ${ATLAS_SECRET}.`;
    const toolMessage = new ToolMessage({
      content: originalContent,
      tool_call_id: "call-1",
      name: "mongodb__find",
      status: "error",
    });
    const handler = vi.fn(async () => toolMessage);

    const result = await redactSecretsMiddleware.wrapToolCall!(
      {} as never,
      handler,
    );

    expect(result).not.toBe(toolMessage);
    expect(toolMessage.content).toBe(originalContent);
    expect(ToolMessage.isInstance(result)).toBe(true);
    const redactedToolMessage = result as ToolMessage;
    expect(redactedToolMessage.content).toBe(
      "Failed connecting to mongodb+srv://[redacted-username]:[redacted-password]@cluster0.example.mongodb.net/admin with mdb_sa_sk_[redacted-api-key].",
    );
    expect(redactedToolMessage.tool_call_id).toBe("call-1");
    expect(redactedToolMessage.name).toBe("mongodb__find");
    expect(redactedToolMessage.status).toBe("error");
    expect(warn).toHaveBeenCalledOnce();
    const warning = String(warn.mock.calls[0]?.[0]);
    expect(warning).toContain("mongodb-uri");
    expect(warning).toContain("atlas-service-account");
    expect(warning).toContain("from tool message");
    expect(warning).not.toContain("s3cr3t-pass");
    expect(warning).not.toContain(ATLAS_SECRET);
  });

  it("redacts ToolMessage content blocks and leaves clean ToolMessages untouched", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const secretToolMessage = new ToolMessage({
      content: [{ type: "text", text: `Key ${OPENAI_KEY}\n${PEM}` }],
      tool_call_id: "call-2",
      name: "search_knowledge",
    });
    const redactedToolMessage = await redactSecretsMiddleware.wrapToolCall!(
      {} as never,
      async () => secretToolMessage,
    );
    expect(redactedToolMessage).not.toBe(secretToolMessage);
    expect((redactedToolMessage as ToolMessage).content).toEqual([
      { type: "text", text: "Key sk-[redacted-api-key]\n[redacted-private-key]" },
    ]);

    warn.mockClear();
    const cleanToolMessage = new ToolMessage({
      content: "Found 3 documents in sample_mflix.",
      tool_call_id: "call-3",
      name: "mongodb__find",
    });
    const returned = await redactSecretsMiddleware.wrapToolCall!(
      {} as never,
      async () => cleanToolMessage,
    );
    expect(returned).toBe(cleanToolMessage);
    expect(cleanToolMessage.content).toBe("Found 3 documents in sample_mflix.");
    expect(warn).not.toHaveBeenCalled();
  });

  it("redacts ToolMessage entries inside a Command update without mutating the original Command", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const originalContent = `Subagent failed connecting to ${MONGO_URI} using ${OPENAI_KEY}.`;
    const taskMessage = new ToolMessage({
      content: originalContent,
      tool_call_id: "call-task-1",
      name: "task",
    });
    const command = new Command({
      update: {
        messages: [taskMessage],
        todos: [{ content: "check cluster", status: "in_progress" }],
      },
    });

    const result = await redactSecretsMiddleware.wrapToolCall!(
      {} as never,
      async () => command,
    );

    expect(result).not.toBe(command);
    expect(taskMessage.content).toBe(originalContent);
    const updatedCommand = result as Command<
      unknown,
      { messages: ToolMessage[]; todos: unknown[] }
    >;
    const updatedMessages = (
      updatedCommand.update as { messages: ToolMessage[]; todos: unknown[] }
    ).messages;
    expect(updatedMessages[0]).not.toBe(taskMessage);
    expect(updatedMessages[0]?.content).toBe(
      "Subagent failed connecting to mongodb+srv://[redacted-username]:[redacted-password]@cluster0.example.mongodb.net/admin using sk-[redacted-api-key].",
    );
    expect(
      (updatedCommand.update as { todos: unknown[] }).todos,
    ).toEqual([{ content: "check cluster", status: "in_progress" }]);
    expect(warn).toHaveBeenCalledOnce();
    const warning = String(warn.mock.calls[0]?.[0]);
    expect(warning).toContain("mongodb-uri");
    expect(warning).toContain("api-key");
    expect(warning).toContain("from tool message");
    expect(warning).not.toContain("s3cr3t-pass");
    expect(warning).not.toContain(OPENAI_KEY);
  });
});

describe("redactSecretText on adversarial input", () => {
  const BUDGET_MS = 500;

  function timed(text: string) {
    const started = performance.now();
    const result = redactSecretText(text);
    return { result, elapsed: performance.now() - started };
  }

  it("scans repeated unmatched private key headers in linear time", () => {
    const { result, elapsed } = timed(
      "-----BEGIN PRIVATE KEY-----".repeat(40_000),
    );

    expect(result.kinds).toEqual([]);
    expect(elapsed).toBeLessThan(BUDGET_MS);
  });

  it("scans repeated credential-less MongoDB URI starts in linear time", () => {
    const { result, elapsed } = timed("mongodb://a:".repeat(100_000));

    expect(result.kinds).toEqual([]);
    expect(elapsed).toBeLessThan(BUDGET_MS);
  });

  it("redacts a key that follows an unmatched header, as the old rule did", () => {
    const { result } = timed(`-----BEGIN PRIVATE KEY-----\nnote\n${PEM}`);

    expect(result.kinds).toEqual(["private-key"]);
    expect(result.text).toBe("[redacted-private-key]");
  });

  it("redacts credentials that follow a URI without a password", () => {
    const { result } = timed(
      "mongodb://a: then mongodb://admin:hunter2@db.example.com/test",
    );

    expect(result.text).toBe(
      "mongodb://a: then mongodb://[redacted-username]:[redacted-password]@db.example.com/test",
    );
  });

  it("leaves a URI without credentials unchanged", () => {
    const { result } = timed("mongodb://db.example.com/test");

    expect(result.text).toBe("mongodb://db.example.com/test");
    expect(result.kinds).toEqual([]);
  });
});
