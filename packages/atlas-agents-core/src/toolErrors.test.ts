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

import { GraphInterrupt } from "@langchain/langgraph";
import { describe, expect, it } from "vitest";

import { formatToolErrorForAgent, recoverToolCall } from "./toolErrors.js";

const OPENAI_KEY = "sk-proj-abcdefghijklmnopqrstuvwxyz012345";
const ATLAS_SECRET = "mdb_sa_sk_fake-not-a-real-secret";
const MONGO_URI =
  "mongodb+srv://ada.lovelace:s3cr3t-pass@cluster0.example.mongodb.net/admin";
const PEM = [
  "-----BEGIN RSA PRIVATE KEY-----",
  "MIIEowIBAAKCAQEA7exampleprivatekeymaterial",
  "-----END RSA PRIVATE KEY-----",
].join("\n");

describe("formatToolErrorForAgent", () => {
  it("redacts MongoDB URI credentials while keeping the host and error context", () => {
    const formatted = formatToolErrorForAgent(
      "mongodb__connect",
      new Error(`Authentication failed for ${MONGO_URI}`),
    );

    expect(formatted).toContain(
      'Tool "mongodb__connect" failed. Do not stop the task.',
    );
    expect(formatted).toContain(
      "Authentication failed for mongodb+srv://[redacted-username]:[redacted-password]@cluster0.example.mongodb.net/admin",
    );
    expect(formatted).not.toContain("ada.lovelace");
    expect(formatted).not.toContain("s3cr3t-pass");
  });

  it("redacts API keys, Atlas service-account secrets, and PEM private keys", () => {
    const formatted = formatToolErrorForAgent(
      "search_knowledge",
      `Upstream failure: key=${OPENAI_KEY} sa=${ATLAS_SECRET}\n${PEM}`,
    );

    expect(formatted).toContain("key=sk-[redacted-api-key]");
    expect(formatted).toContain("sa=mdb_sa_sk_[redacted-api-key]");
    expect(formatted).toContain("[redacted-private-key]");
    expect(formatted).not.toContain(OPENAI_KEY);
    expect(formatted).not.toContain(ATLAS_SECRET);
    expect(formatted).not.toContain("exampleprivatekeymaterial");
  });
});

describe("recoverToolCall", () => {
  it("returns a model-readable ToolMessage for an ordinary MCP failure", async () => {
    const result = await recoverToolCall(
      {
        toolCall: {
          id: "call-1",
          name: "mongodb__find",
        },
      },
      async () => {
        throw new Error("mixed inclusion and exclusion projection");
      },
    );

    expect(result.type).toBe("tool");
    expect(result.tool_call_id).toBe("call-1");
    expect(result.name).toBe("mongodb__find");
    expect(result.status).toBe("error");
    expect(result.content).toContain(
      "correct the tool arguments, and retry",
    );
    expect(result.content).toContain(
      "mixed inclusion and exclusion projection",
    );
  });

  it("redacts secrets in the recovered ToolMessage error content", async () => {
    const result = await recoverToolCall(
      {
        toolCall: {
          id: "call-secret",
          name: "mongodb__find",
        },
      },
      async () => {
        throw new Error(
          `Connection refused for ${MONGO_URI} using ${ATLAS_SECRET}, ${OPENAI_KEY}, and:\n${PEM}`,
        );
      },
    );

    expect(result.type).toBe("tool");
    expect(result.status).toBe("error");
    expect(result.content).toContain("correct the tool arguments, and retry");
    expect(result.content).toContain(
      "Connection refused for mongodb+srv://[redacted-username]:[redacted-password]@cluster0.example.mongodb.net/admin",
    );
    expect(result.content).toContain("mdb_sa_sk_[redacted-api-key]");
    expect(result.content).toContain("sk-[redacted-api-key]");
    expect(result.content).toContain("[redacted-private-key]");
    expect(result.content).not.toContain("s3cr3t-pass");
    expect(result.content).not.toContain(ATLAS_SECRET);
    expect(result.content).not.toContain(OPENAI_KEY);
    expect(result.content).not.toContain("exampleprivatekeymaterial");
  });

  it("rethrows graph interrupts so Agent Engine can suspend the execution", async () => {
    const interrupt = new GraphInterrupt([]);

    await expect(
      recoverToolCall(
        {
          toolCall: {
            id: "call-2",
            name: "mongodb__drop_database",
          },
        },
        async () => {
          throw interrupt;
        },
      ),
    ).rejects.toBe(interrupt);
  });
});
