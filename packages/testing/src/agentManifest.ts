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

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  VERIFIED_PROVIDERS,
  isVerifiedProvider,
  providerManifestProblems,
  switchProvider,
  type VerifiedProvider,
} from "./providerManifest.js";

const MCP_SECRETS_PATTERN =
  /required_secrets:\n\s+aer:\n(?:\s+- .+\n)*\s+- ATLAS_MCP_CLIENT_ID\n\s+- ATLAS_MCP_CLIENT_SECRET\n\s+tools:[\s\S]*?"mongodb__\*":\n\s+- ATLAS_MCP_CLIENT_ID\n\s+- ATLAS_MCP_CLIENT_SECRET/;

const MCP_AUTH_PATTERN =
  /auth:\n\s+type: client_credentials\n\s+token_url: https:\/\/cloud\.mongodb\.com\/api\/oauth\/token\n\s+client_id_env: ATLAS_MCP_CLIENT_ID\n\s+client_secret_env: ATLAS_MCP_CLIENT_SECRET/;

const FORBIDDEN_BOOTSTRAP_PATTERN =
  /ATLAS_ORG_ID|ATLAS_PUBLIC_API_KEY|ATLAS_PRIVATE_API_KEY|GROUP_DATA_ACCESS_READ_WRITE/;

const REQUIRED_EGRESS_PATTERNS: ReadonlyArray<{
  fqdn: string;
  pattern: RegExp;
}> = [
  {
    fqdn: "cloud.mongodb.com:443 (component: all)",
    pattern: /- fqdn: cloud\.mongodb\.com\n\s+ports: \[443\]\n\s+component: all/,
  },
  {
    fqdn: "mcp.mongodb.com:443 (component: all)",
    pattern: /- fqdn: mcp\.mongodb\.com\n\s+ports: \[443\]\n\s+component: all/,
  },
  {
    fqdn: "knowledge.mongodb.com:443 (component: tool)",
    pattern:
      /- fqdn: knowledge\.mongodb\.com\n\s+ports: \[443\]\n\s+component: tool/,
  },
];

const IP_DISCOVERY_PATTERN = /api4\.ipify\.org|ifconfig\.me|icanhazip\.com/;

const WRITE_SECRET_PATTERN = /ALLOW_WRITE_OPERATIONS/;

export interface AgentManifestSuiteOptions {
  /** Base URL used to resolve `agent.yaml`, `mcp-config.example.json`, and `.env.example` (e.g. `new URL("../../", import.meta.url)`). */
  agentDirUrl: string | URL;
  /** The LLM provider configured in `config.ts`. */
  provider: string;
  /** When `true`, also asserts `ALLOW_WRITE_OPERATIONS` is absent from `agent.yaml` and `.env.example`. */
  readOnly?: boolean;
}

/**
 * Checks MCP authentication secrets, client-credentials OAuth config, and
 * forbidden bootstrap or write secrets in `agent.yaml`.
 */
export function mcpAuthManifestProblems(
  manifest: string,
  options?: { readOnly?: boolean },
): string[] {
  const problems: string[] = [];

  if (!MCP_SECRETS_PATTERN.test(manifest)) {
    problems.push(
      "required_secrets must inject ATLAS_MCP_CLIENT_ID and ATLAS_MCP_CLIENT_SECRET into aer and mongodb__*",
    );
  }
  if (!MCP_AUTH_PATTERN.test(manifest)) {
    problems.push(
      "mcp.servers.mongodb.auth must use client_credentials with ATLAS_MCP_CLIENT_ID and ATLAS_MCP_CLIENT_SECRET",
    );
  }
  if (FORBIDDEN_BOOTSTRAP_PATTERN.test(manifest)) {
    problems.push(
      "agent.yaml must not reference runtime bootstrap secrets or GROUP_DATA_ACCESS_READ_WRITE",
    );
  }
  if (options?.readOnly && WRITE_SECRET_PATTERN.test(manifest)) {
    problems.push("read-only agent.yaml must not declare ALLOW_WRITE_OPERATIONS");
  }
  return problems;
}

/**
 * Checks that `agent.yaml` keeps OAuth, MCP, and knowledge egress rules while
 * excluding public IP discovery hosts.
 */
export function mcpEgressManifestProblems(manifest: string): string[] {
  const problems: string[] = [];

  for (const { fqdn, pattern } of REQUIRED_EGRESS_PATTERNS) {
    if (!pattern.test(manifest)) {
      problems.push(`network.egress is missing ${fqdn}`);
    }
  }
  if (IP_DISCOVERY_PATTERN.test(manifest)) {
    problems.push("network.egress must not allow IP discovery hosts");
  }
  return problems;
}

/**
 * Checks that `mcp-config.example.json` grants only `GROUP_DATA_ACCESS_READ_ONLY`
 * and (when `readOnly` is set) `.env.example` omits `ALLOW_WRITE_OPERATIONS`.
 */
export function exampleMcpConfigProblems(
  mcpConfig: { roles?: unknown },
  options?: { readOnly?: boolean; envExample?: string },
): string[] {
  const problems: string[] = [];
  const roles = Array.isArray(mcpConfig.roles) ? mcpConfig.roles : [];

  if (
    roles.length !== 1 ||
    roles[0] !== "GROUP_DATA_ACCESS_READ_ONLY"
  ) {
    problems.push(
      "mcp-config.example.json roles must equal [\"GROUP_DATA_ACCESS_READ_ONLY\"]",
    );
  }
  if (
    options?.readOnly &&
    options.envExample !== undefined &&
    WRITE_SECRET_PATTERN.test(options.envExample)
  ) {
    problems.push(
      "read-only .env.example must not mention ALLOW_WRITE_OPERATIONS",
    );
  }
  return problems;
}

/**
 * Registers the standard Vitest suites for an agent directory's `agent.yaml`,
 * `mcp-config.example.json`, and `.env.example`.
 */
export function defineAgentManifestTests(
  options: AgentManifestSuiteOptions,
): void {
  const manifest = readFileSync(
    new URL("agent.yaml", options.agentDirUrl),
    "utf8",
  );
  const mcpConfig = JSON.parse(
    readFileSync(new URL("mcp-config.example.json", options.agentDirUrl), "utf8"),
  ) as { roles: string[] };
  const envExample = readFileSync(
    new URL(".env.example", options.agentDirUrl),
    "utf8",
  );

  describe("agent.yaml MCP authentication", () => {
    it(
      options.readOnly
        ? "injects read-only MCP credentials and no write secret"
        : "injects dedicated MCP credentials without runtime bootstrap access",
      () => {
        expect(
          mcpAuthManifestProblems(manifest, { readOnly: options.readOnly }),
        ).toEqual([]);
      },
    );

    it("keeps OAuth and MCP egress while removing IP discovery hosts", () => {
      expect(mcpEgressManifestProblems(manifest)).toEqual([]);
    });
  });

  describe("agent.yaml model provider", () => {
    const configured = options.provider;

    it("is a provider whose manifest requirements are known", () => {
      expect(isVerifiedProvider(configured)).toBe(true);
    });

    it("declares the key and egress host for the provider in config.ts", () => {
      expect(
        providerManifestProblems(manifest, configured as VerifiedProvider),
      ).toEqual([]);
    });

    it.each(Object.keys(VERIFIED_PROVIDERS) as VerifiedProvider[])(
      "is consistent after switching config.ts and agent.yaml to %s",
      (target) => {
        const switched = switchProvider(
          manifest,
          configured as VerifiedProvider,
          target,
        );

        expect(providerManifestProblems(switched, target)).toEqual([]);
        expect(envExample).toMatch(
          new RegExp(`^${VERIFIED_PROVIDERS[target].secret}=`, "m"),
        );
      },
    );
  });

  describe("example MCP configuration", () => {
    it(
      options.readOnly
        ? "grants only project data-access read-only"
        : "defaults the Atlas identity to project data-access read-only",
      () => {
        expect(
          exampleMcpConfigProblems(mcpConfig, {
            readOnly: options.readOnly,
            envExample,
          }),
        ).toEqual([]);
      },
    );
  });
}
