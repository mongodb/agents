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

import {
  exampleMcpConfigProblems,
  mcpAuthManifestProblems,
  mcpEgressManifestProblems,
} from "./agentManifest.js";

const VALID_MANIFEST = `required_secrets:
    aer:
        - OPENAI_API_KEY
        - ATLAS_MCP_CLIENT_ID
        - ATLAS_MCP_CLIENT_SECRET
    tools:
        invoke_llm:
            - OPENAI_API_KEY
        "mongodb__*":
            - ATLAS_MCP_CLIENT_ID
            - ATLAS_MCP_CLIENT_SECRET
network:
    egress:
        - fqdn: cloud.mongodb.com
          ports: [443]
          component: all
        - fqdn: mcp.mongodb.com
          ports: [443]
          component: all
        - fqdn: api.openai.com
          ports: [443]
          component: tool
        - fqdn: knowledge.mongodb.com
          ports: [443]
          component: tool
mcp:
    servers:
        mongodb:
            transport: streamable_http
            url: https://mcp.mongodb.com
            auth:
                type: client_credentials
                token_url: https://cloud.mongodb.com/api/oauth\/token
                client_id_env: ATLAS_MCP_CLIENT_ID
                client_secret_env: ATLAS_MCP_CLIENT_SECRET
`;

describe("mcpAuthManifestProblems", () => {
  it("accepts a manifest with dedicated MCP client credentials", () => {
    expect(mcpAuthManifestProblems(VALID_MANIFEST)).toEqual([]);
  });

  it("flags missing MCP secrets or client_credentials auth", () => {
    const withoutSecret = VALID_MANIFEST.replaceAll(
      "ATLAS_MCP_CLIENT_SECRET",
      "OTHER_SECRET",
    );

    expect(mcpAuthManifestProblems(withoutSecret)).toEqual([
      "required_secrets must inject ATLAS_MCP_CLIENT_ID and ATLAS_MCP_CLIENT_SECRET into aer and mongodb__*",
      "mcp.servers.mongodb.auth must use client_credentials with ATLAS_MCP_CLIENT_ID and ATLAS_MCP_CLIENT_SECRET",
    ]);
  });

  it("flags runtime bootstrap secrets and read-write role references", () => {
    for (const forbidden of [
      "ATLAS_ORG_ID",
      "ATLAS_PUBLIC_API_KEY",
      "ATLAS_PRIVATE_API_KEY",
      "GROUP_DATA_ACCESS_READ_WRITE",
    ]) {
      expect(mcpAuthManifestProblems(`${VALID_MANIFEST}\n# ${forbidden}`)).toEqual([
        "agent.yaml must not reference runtime bootstrap secrets or GROUP_DATA_ACCESS_READ_WRITE",
      ]);
    }
  });

  it("flags ALLOW_WRITE_OPERATIONS only when readOnly is enabled", () => {
    const withWriteSecret = `${VALID_MANIFEST}\n# ALLOW_WRITE_OPERATIONS`;

    expect(mcpAuthManifestProblems(withWriteSecret)).toEqual([]);
    expect(mcpAuthManifestProblems(withWriteSecret, { readOnly: true })).toEqual([
      "read-only agent.yaml must not declare ALLOW_WRITE_OPERATIONS",
    ]);
  });
});

describe("mcpEgressManifestProblems", () => {
  it("accepts a manifest with OAuth, MCP, and knowledge egress", () => {
    expect(mcpEgressManifestProblems(VALID_MANIFEST)).toEqual([]);
  });

  it("flags missing required egress rules", () => {
    const withoutKnowledge = VALID_MANIFEST.replace(
      "knowledge.mongodb.com",
      "other.example.com",
    );

    expect(mcpEgressManifestProblems(withoutKnowledge)).toEqual([
      "network.egress is missing knowledge.mongodb.com:443 (component: tool)",
    ]);
  });

  it("flags IP discovery hosts", () => {
    for (const host of ["api4.ipify.org", "ifconfig.me", "icanhazip.com"]) {
      expect(
        mcpEgressManifestProblems(`${VALID_MANIFEST}\n        - fqdn: ${host}`),
      ).toEqual(["network.egress must not allow IP discovery hosts"]);
    }
  });
});

describe("exampleMcpConfigProblems", () => {
  it("accepts a read-only MCP config and clean .env.example", () => {
    expect(
      exampleMcpConfigProblems(
        { roles: ["GROUP_DATA_ACCESS_READ_ONLY"] },
        { readOnly: true, envExample: "ATLAS_MCP_CLIENT_ID=\n" },
      ),
    ).toEqual([]);
  });

  it("rejects roles other than GROUP_DATA_ACCESS_READ_ONLY", () => {
    expect(
      exampleMcpConfigProblems({ roles: ["GROUP_DATA_ACCESS_READ_WRITE"] }),
    ).toEqual([
      'mcp-config.example.json roles must equal ["GROUP_DATA_ACCESS_READ_ONLY"]',
    ]);
  });

  it("flags ALLOW_WRITE_OPERATIONS in .env.example when readOnly is enabled", () => {
    const envWithWrites = "ALLOW_WRITE_OPERATIONS=\n";

    expect(
      exampleMcpConfigProblems(
        { roles: ["GROUP_DATA_ACCESS_READ_ONLY"] },
        { envExample: envWithWrites },
      ),
    ).toEqual([]);
    expect(
      exampleMcpConfigProblems(
        { roles: ["GROUP_DATA_ACCESS_READ_ONLY"] },
        { readOnly: true, envExample: envWithWrites },
      ),
    ).toEqual([
      "read-only .env.example must not mention ALLOW_WRITE_OPERATIONS",
    ]);
  });
});
