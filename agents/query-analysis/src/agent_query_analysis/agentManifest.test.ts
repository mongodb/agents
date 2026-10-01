import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

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
    expect(manifest).not.toMatch(
      /api4\.ipify\.org|ifconfig\.me|icanhazip\.com/,
    );
  });
});

describe("example MCP configuration", () => {
  it("grants only project data-access read-only", () => {
    expect(mcpConfig.roles).toEqual(["GROUP_DATA_ACCESS_READ_ONLY"]);
    expect(envExample).not.toMatch(/ALLOW_WRITE_OPERATIONS/);
  });
});
