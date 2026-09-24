import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";

import {
  installAtlasMcpClientInfo,
  readPackageClientInfo,
  type McpClientInfo,
} from "./mcpClientInfo.js";

const clientInfo: McpClientInfo = {
  name: "atlas-explorer",
  version: "0.1.0",
};

function fetchTarget(
  impl: ReturnType<typeof vi.fn<typeof fetch>> = vi.fn<typeof fetch>(async () =>
    new Response("ok"),
  ),
) {
  return { impl, target: { fetch: impl } };
}

async function postedBody(
  impl: ReturnType<typeof vi.fn<typeof fetch>>,
  target: { fetch: typeof fetch },
  url: string,
  body: unknown,
): Promise<unknown> {
  await target.fetch(url, {
    method: "POST",
    body: JSON.stringify(body),
  });
  const forwardedBody = impl.mock.calls[0]?.[1]?.body;
  if (typeof forwardedBody !== "string") return forwardedBody;
  return JSON.parse(forwardedBody);
}

describe("readPackageClientInfo", () => {
  it("reads name and version from package.json", () => {
    const packageJson = JSON.parse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
    ) as { name: string; version: string };

    expect(readPackageClientInfo()).toEqual({
      name: packageJson.name,
      version: packageJson.version,
    });
  });

  it("fails when name or version is missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "atlas-explorer-package-"));
    const file = join(dir, "package.json");
    writeFileSync(file, JSON.stringify({ name: "atlas-explorer" }));

    expect(() => readPackageClientInfo(pathToFileURL(file))).toThrow(
      /missing version/,
    );

    writeFileSync(file, JSON.stringify({ version: "0.1.0" }));
    expect(() => readPackageClientInfo(pathToFileURL(file))).toThrow(
      /missing name/,
    );
  });
});

describe("installAtlasMcpClientInfo", () => {
  it("stamps clientInfo onto a tools/call and keeps progressToken", async () => {
    const { impl, target } = fetchTarget();
    installAtlasMcpClientInfo(target, clientInfo);

    const body = await postedBody(impl, target, "https://mcp.mongodb.com/mcp", {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "search",
        arguments: { q: "otters" },
        _meta: { progressToken: "token-1" },
      },
    });

    expect(body).toEqual({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "search",
        arguments: { q: "otters" },
        _meta: {
          progressToken: "token-1",
          "io.modelcontextprotocol/clientInfo": clientInfo,
        },
      },
    });
  });

  it("replaces clientInfo on initialize", async () => {
    const { impl, target } = fetchTarget();
    installAtlasMcpClientInfo(target, clientInfo);

    const body = await postedBody(impl, target, "https://mcp.mongodb.com/", {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "agentic-platform-runner", version: "1.0.0" },
      },
    });

    expect(body).toMatchObject({
      method: "initialize",
      params: {
        clientInfo,
        _meta: { "io.modelcontextprotocol/clientInfo": clientInfo },
      },
    });
  });

  it("forwards notifications, other hosts, and non-JSON bodies unchanged", async () => {
    const original = vi.fn<typeof fetch>(async () => new Response("ok"));
    const { target } = fetchTarget(original);
    installAtlasMcpClientInfo(target, clientInfo);

    const notification = {
      jsonrpc: "2.0",
      method: "notifications/initialized",
    };
    await target.fetch("https://mcp.mongodb.com/", {
      method: "POST",
      body: JSON.stringify(notification),
    });

    const openai = { model: "gpt-5.6-luna" };
    await target.fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      body: JSON.stringify(openai),
    });

    const token = { grant_type: "client_credentials" };
    await target.fetch("https://cloud.mongodb.com/api/oauth/token", {
      method: "POST",
      body: JSON.stringify(token),
    });

    expect(JSON.parse(String(original.mock.calls[0]?.[1]?.body))).toEqual(
      notification,
    );
    expect(JSON.parse(String(original.mock.calls[1]?.[1]?.body))).toEqual(
      openai,
    );
    expect(JSON.parse(String(original.mock.calls[2]?.[1]?.body))).toEqual(
      token,
    );
  });

  it("returns the original response", async () => {
    const response = new Response("stream");
    const { target } = fetchTarget(vi.fn<typeof fetch>(async () => response));
    installAtlasMcpClientInfo(target, clientInfo);

    await expect(
      target.fetch("https://mcp.mongodb.com/", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list",
          params: {},
        }),
      }),
    ).resolves.toBe(response);
  });

  it("does not nest when installed twice", () => {
    const { target } = fetchTarget();
    installAtlasMcpClientInfo(target, clientInfo);
    const wrapped = target.fetch;
    installAtlasMcpClientInfo(target, {
      name: "other-agent",
      version: "9.9.9",
    });

    expect(target.fetch).toBe(wrapped);
  });
});
