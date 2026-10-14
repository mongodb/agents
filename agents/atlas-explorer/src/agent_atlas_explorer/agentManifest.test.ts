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

import {
  VERIFIED_PROVIDERS,
  isVerifiedProvider,
  providerManifestProblems,
  switchProvider,
  type VerifiedProvider,
} from "@repo/agent-engine-core/testing";
import { describe, expect, it } from "vitest";

import { atlasExplorerConfig } from "./config.js";

const manifest = readFileSync(
  new URL("../../agent.yaml", import.meta.url),
  "utf8",
);

const mcpConfig = JSON.parse(
  readFileSync(new URL("../../mcp-config.example.json", import.meta.url), "utf8"),
) as { roles: string[] };

const envExample = readFileSync(
  new URL("../../.env.example", import.meta.url),
  "utf8",
);

describe("agent.yaml MCP authentication", () => {
  it("injects dedicated MCP credentials without runtime bootstrap access", () => {
    expect(manifest).toMatch(
      /required_secrets:\n\s+aer:\n(?:\s+- .+\n)*\s+- ATLAS_MCP_CLIENT_ID\n\s+- ATLAS_MCP_CLIENT_SECRET\n\s+tools:[\s\S]*?"mongodb__\*":\n\s+- ATLAS_MCP_CLIENT_ID\n\s+- ATLAS_MCP_CLIENT_SECRET/,
    );
    expect(manifest).toMatch(
      /auth:\n\s+type: client_credentials\n\s+token_url: https:\/\/cloud\.mongodb\.com\/api\/oauth\/token\n\s+client_id_env: ATLAS_MCP_CLIENT_ID\n\s+client_secret_env: ATLAS_MCP_CLIENT_SECRET/,
    );
    expect(manifest).not.toMatch(
      /ATLAS_ORG_ID|ATLAS_PUBLIC_API_KEY|ATLAS_PRIVATE_API_KEY/,
    );
  });

  it("keeps OAuth and MCP egress while removing IP discovery hosts", () => {
    expect(manifest).toMatch(
      /- fqdn: cloud\.mongodb\.com\n\s+ports: \[443\]\n\s+component: all/,
    );
    expect(manifest).toMatch(
      /- fqdn: mcp\.mongodb\.com\n\s+ports: \[443\]\n\s+component: all/,
    );
    expect(manifest).toMatch(
      /- fqdn: knowledge\.mongodb\.com\n\s+ports: \[443\]\n\s+component: tool/,
    );
    expect(manifest).not.toMatch(
      /api4\.ipify\.org|ifconfig\.me|icanhazip\.com/,
    );
  });
});

describe("agent.yaml model provider", () => {
  const configured = atlasExplorerConfig.llm.provider as string;

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
  it("defaults the Atlas identity to project data-access read-only", () => {
    expect(mcpConfig.roles).toEqual(["GROUP_DATA_ACCESS_READ_ONLY"]);
  });
});
