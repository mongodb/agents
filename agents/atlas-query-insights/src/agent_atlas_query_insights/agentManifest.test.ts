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

import { atlasQueryInsightsConfig } from "./config.js";

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
  it("injects read-only MCP credentials and no write secret", () => {
    expect(manifest).toMatch(
      /required_secrets:\n\s+aer:\n(?:\s+- .+\n)*\s+- ATLAS_MCP_CLIENT_ID\n\s+- ATLAS_MCP_CLIENT_SECRET\n\s+tools:[\s\S]*?"mongodb__\*":\n\s+- ATLAS_MCP_CLIENT_ID\n\s+- ATLAS_MCP_CLIENT_SECRET/,
    );
    expect(manifest).toMatch(
      /auth:\n\s+type: client_credentials\n\s+token_url: https:\/\/cloud\.mongodb\.com\/api\/oauth\/token\n\s+client_id_env: ATLAS_MCP_CLIENT_ID\n\s+client_secret_env: ATLAS_MCP_CLIENT_SECRET/,
    );
    expect(manifest).not.toMatch(/ALLOW_WRITE_OPERATIONS/);
    expect(manifest).not.toMatch(
      /ATLAS_ORG_ID|ATLAS_PUBLIC_API_KEY|ATLAS_PRIVATE_API_KEY|GROUP_DATA_ACCESS_READ_WRITE/,
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

const VERIFIED_PROVIDERS = {
  openai: { secret: "OPENAI_API_KEY", host: "api.openai.com" },
  anthropic: { secret: "ANTHROPIC_API_KEY", host: "api.anthropic.com" },
} as const;

type VerifiedProvider = keyof typeof VERIFIED_PROVIDERS;

function listItemsUnder(text: string, key: string): string[] {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line.trim() === `${key}:`);
  if (start === -1) {
    return [];
  }
  const items: string[] = [];
  for (const line of lines.slice(start + 1)) {
    const item = /^\s+- (.+)$/.exec(line);
    if (!item) {
      break;
    }
    items.push(item[1]!.trim());
  }
  return items;
}

function egressRules(text: string) {
  return [
    ...text.matchAll(
      /- fqdn: (\S+)\n\s+ports: \[(.*?)\]\n\s+component: (\w+)/g,
    ),
  ].map(([, fqdn, ports, component]) => ({
    fqdn: fqdn!,
    ports: ports!.split(",").map((port) => port.trim()),
    component: component!,
  }));
}

function providerManifestProblems(
  text: string,
  provider: VerifiedProvider,
): string[] {
  const { secret, host } = VERIFIED_PROVIDERS[provider];
  const aerSecrets = listItemsUnder(text, "aer");
  const invokeLlmSecrets = listItemsUnder(text, "invoke_llm");
  const egress = egressRules(text);
  const problems: string[] = [];

  if (!aerSecrets.includes(secret)) {
    problems.push(`required_secrets.aer is missing ${secret}`);
  }
  if (!invokeLlmSecrets.includes(secret)) {
    problems.push(`required_secrets.tools.invoke_llm is missing ${secret}`);
  }
  if (
    !egress.some(
      (rule) =>
        rule.fqdn === host &&
        rule.component === "tool" &&
        rule.ports.includes("443"),
    )
  ) {
    problems.push(`network.egress has no tool rule for ${host}:443`);
  }

  for (const [name, other] of Object.entries(VERIFIED_PROVIDERS)) {
    if (name === provider) {
      continue;
    }
    if (aerSecrets.includes(other.secret)) {
      problems.push(`required_secrets.aer still lists ${other.secret}`);
    }
    if (invokeLlmSecrets.includes(other.secret)) {
      problems.push(
        `required_secrets.tools.invoke_llm still lists ${other.secret}`,
      );
    }
    if (egress.some((rule) => rule.fqdn === other.host)) {
      problems.push(`network.egress still allows ${other.host}`);
    }
  }
  return problems;
}

function switchProvider(
  text: string,
  from: VerifiedProvider,
  to: VerifiedProvider,
): string {
  return text
    .replaceAll(VERIFIED_PROVIDERS[from].secret, VERIFIED_PROVIDERS[to].secret)
    .replaceAll(VERIFIED_PROVIDERS[from].host, VERIFIED_PROVIDERS[to].host);
}

describe("agent.yaml model provider", () => {
  const configured = atlasQueryInsightsConfig.llm.provider as VerifiedProvider;

  it("is a provider whose manifest requirements this suite knows", () => {
    expect(Object.keys(VERIFIED_PROVIDERS)).toContain(configured);
  });

  it("declares the key and egress host for the provider in config.ts", () => {
    expect(providerManifestProblems(manifest, configured)).toEqual([]);
  });

  it.each(Object.keys(VERIFIED_PROVIDERS) as VerifiedProvider[])(
    "is consistent after switching config.ts and agent.yaml to %s",
    (target) => {
      const switched = switchProvider(manifest, configured, target);

      expect(providerManifestProblems(switched, target)).toEqual([]);
    },
  );

  it("flags a switch that changed only the secret", () => {
    const target: VerifiedProvider =
      configured === "anthropic" ? "openai" : "anthropic";
    const secretOnly = manifest.replaceAll(
      VERIFIED_PROVIDERS[configured].secret,
      VERIFIED_PROVIDERS[target].secret,
    );

    expect(providerManifestProblems(secretOnly, target)).toEqual([
      `network.egress has no tool rule for ${VERIFIED_PROVIDERS[target].host}:443`,
      `network.egress still allows ${VERIFIED_PROVIDERS[configured].host}`,
    ]);
  });

  it("flags a switch that changed only the egress host", () => {
    const target: VerifiedProvider =
      configured === "anthropic" ? "openai" : "anthropic";
    const hostOnly = manifest.replaceAll(
      VERIFIED_PROVIDERS[configured].host,
      VERIFIED_PROVIDERS[target].host,
    );

    expect(providerManifestProblems(hostOnly, target)).toEqual([
      `required_secrets.aer is missing ${VERIFIED_PROVIDERS[target].secret}`,
      `required_secrets.tools.invoke_llm is missing ${VERIFIED_PROVIDERS[target].secret}`,
      `required_secrets.aer still lists ${VERIFIED_PROVIDERS[configured].secret}`,
      `required_secrets.tools.invoke_llm still lists ${VERIFIED_PROVIDERS[configured].secret}`,
    ]);
  });
});

describe("example MCP configuration", () => {
  it("grants only project data-access read-only", () => {
    expect(mcpConfig.roles).toEqual(["GROUP_DATA_ACCESS_READ_ONLY"]);
    expect(envExample).not.toMatch(/ALLOW_WRITE_OPERATIONS/);
  });
});
