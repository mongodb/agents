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

  it("redacts the assistant message and warns without the secret value", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const message = new AIMessage({
      content: `Use ${MONGO_URI} and ${ATLAS_SECRET}.`,
    });
    const handler = vi.fn(async () => message);

    const result = await redactSecretsMiddleware.wrapModelCall!(
      { messages: [] } as never,
      handler,
    );

    expect(result).toBe(message);
    expect(message.content).toBe(
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
    await redactSecretsMiddleware.wrapModelCall!(
      { messages: [] } as never,
      async () => secretMessage,
    );
    expect(secretMessage.content).toEqual([
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

  it("redacts ToolMessage content in wrapToolCall and warns without the secret value", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const toolMessage = new ToolMessage({
      content: `Failed connecting to ${MONGO_URI} with ${ATLAS_SECRET}.`,
      tool_call_id: "call-1",
      name: "mongodb__find",
      status: "error",
    });
    const handler = vi.fn(async () => toolMessage);

    const result = await redactSecretsMiddleware.wrapToolCall!(
      {} as never,
      handler,
    );

    expect(result).toBe(toolMessage);
    expect(toolMessage.content).toBe(
      "Failed connecting to mongodb+srv://[redacted-username]:[redacted-password]@cluster0.example.mongodb.net/admin with mdb_sa_sk_[redacted-api-key].",
    );
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
    await redactSecretsMiddleware.wrapToolCall!(
      {} as never,
      async () => secretToolMessage,
    );
    expect(secretToolMessage.content).toEqual([
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

  it("redacts ToolMessage entries inside a Command update from wrapToolCall", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const taskMessage = new ToolMessage({
      content: `Subagent failed connecting to ${MONGO_URI} using ${OPENAI_KEY}.`,
      tool_call_id: "call-task-1",
      name: "task",
    });
    const command = new Command({
      update: {
        messages: [taskMessage],
      },
    });

    const result = await redactSecretsMiddleware.wrapToolCall!(
      {} as never,
      async () => command,
    );

    expect(result).toBe(command);
    expect(taskMessage.content).toBe(
      "Subagent failed connecting to mongodb+srv://[redacted-username]:[redacted-password]@cluster0.example.mongodb.net/admin using sk-[redacted-api-key].",
    );
    expect(warn).toHaveBeenCalledOnce();
    const warning = String(warn.mock.calls[0]?.[0]);
    expect(warning).toContain("mongodb-uri");
    expect(warning).toContain("api-key");
    expect(warning).toContain("from tool message");
    expect(warning).not.toContain("s3cr3t-pass");
    expect(warning).not.toContain(OPENAI_KEY);
  });
});
