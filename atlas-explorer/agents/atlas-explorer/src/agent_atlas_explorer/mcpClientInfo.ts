/**
 * Stamp Atlas Explorer's identity onto MongoDB Atlas MCP requests.
 *
 * The runner constructs the MCP client and only forwards tool arguments, so
 * Atlas Explorer never sees `params._meta`. The SDK posts each JSON-RPC
 * message through global `fetch`. This wrapper rewrites those bodies until
 * the runner sets `io.modelcontextprotocol/clientInfo` itself.
 */

import { readFileSync } from "node:fs";

const MCP_CLIENT_INFO_META_KEY = "io.modelcontextprotocol/clientInfo";
const ATLAS_MCP_HOST = "mcp.mongodb.com";
const WRAPPER_MARK = Symbol.for("atlas-explorer.mcp-client-info-fetch");

export interface McpClientInfo {
  name: string;
  version: string;
}

type FetchInput = string | URL | Request;

type FetchTarget = {
  fetch: (input: FetchInput, init?: RequestInit) => Promise<Response>;
};

type MarkedFetch = FetchTarget["fetch"] & { [WRAPPER_MARK]?: true };

export function readPackageClientInfo(
  packageJsonUrl: URL = new URL("../../package.json", import.meta.url),
): McpClientInfo {
  const parsed: unknown = JSON.parse(readFileSync(packageJsonUrl, "utf8"));
  return clientInfoFromPackageManifest(parsed);
}

export function installAtlasMcpClientInfo(
  target: FetchTarget = globalThis,
  clientInfo: McpClientInfo = readPackageClientInfo(),
): void {
  const current = target.fetch as MarkedFetch;
  if (current[WRAPPER_MARK] === true) return;

  const original = current.bind(target);
  const wrapped: MarkedFetch = async (input, init) => {
    const stamped = stampAtlasMcpRequest(input, init, clientInfo);
    return original(stamped.input, stamped.init);
  };
  wrapped[WRAPPER_MARK] = true;
  target.fetch = wrapped;
}

export function stampAtlasMcpRequest(
  input: FetchInput,
  init: RequestInit | undefined,
  clientInfo: McpClientInfo,
): { input: FetchInput; init: RequestInit | undefined } {
  if (!isAtlasMcpPost(input, init) || typeof init?.body !== "string") {
    return { input, init };
  }
  const stamped = stampJsonRpcBody(init.body, clientInfo);
  if (stamped === undefined) return { input, init };
  return { input, init: { ...init, body: stamped } };
}

function clientInfoFromPackageManifest(parsed: unknown): McpClientInfo {
  const manifest =
    parsed !== null && typeof parsed === "object"
      ? (parsed as { name?: unknown; version?: unknown })
      : {};
  if (typeof manifest.name !== "string" || manifest.name === "") {
    throw new Error("atlas-explorer package.json is missing name");
  }
  if (typeof manifest.version !== "string" || manifest.version === "") {
    throw new Error("atlas-explorer package.json is missing version");
  }
  return { name: manifest.name, version: manifest.version };
}

function isAtlasMcpPost(
  input: FetchInput,
  init: RequestInit | undefined,
): boolean {
  const url = requestUrl(input);
  if (url?.hostname !== ATLAS_MCP_HOST) return false;
  const method = init?.method ?? (input instanceof Request ? input.method : "GET");
  return method.toUpperCase() === "POST";
}

function requestUrl(input: FetchInput): URL | undefined {
  try {
    if (typeof input === "string" || input instanceof URL) return new URL(input);
    return new URL(input.url);
  } catch {
    return undefined;
  }
}

function stampJsonRpcBody(
  body: string,
  clientInfo: McpClientInfo,
): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return undefined;
  }
  if (!isJsonRpcRequest(parsed)) return undefined;
  const params = requestParams(parsed.params);
  if (params === undefined) return undefined;

  const existingMeta = params["_meta"];
  const meta =
    existingMeta !== null &&
    typeof existingMeta === "object" &&
    !Array.isArray(existingMeta)
      ? { ...(existingMeta as Record<string, unknown>) }
      : {};
  params["_meta"] = {
    ...meta,
    [MCP_CLIENT_INFO_META_KEY]: clientInfo,
  };
  if (parsed.method === "initialize") {
    params["clientInfo"] = clientInfo;
  }
  return JSON.stringify({ ...parsed, params });
}

function isJsonRpcRequest(
  value: unknown,
): value is { method: string; params?: unknown } {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as { method?: unknown; id?: unknown };
  return typeof record.method === "string" && "id" in record;
}

function requestParams(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined) return {};
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return { ...(value as Record<string, unknown>) };
}
