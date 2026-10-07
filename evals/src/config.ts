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

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { homedir } from "node:os";
import { parseEnv } from "node:util";

import type { WorkspaceKey } from "./types.ts";

export const RIG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// EVAL_SKIP_DOTENV lets tests run against a mock without picking up real credentials.
const envFile = process.env.EVAL_ENV_FILE || path.join(RIG_DIR, ".env");
if (existsSync(envFile) && !process.env.EVAL_SKIP_DOTENV) {
  // This local rig's file is authoritative: old shell exports must not mask a fresh key or target.
  Object.assign(process.env, parseEnv(readFileSync(envFile, "utf8")));
}

export const RESULTS_DIR = process.env.EVAL_RESULTS_DIR || path.join(RIG_DIR, "results");
export const GROUND_TRUTH_FILE = process.env.EVAL_GROUND_TRUTH_FILE || path.join(RIG_DIR, "ground-truth.json");

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export const WORKSPACE_ENV: Record<WorkspaceKey, string> = {
  readonly: "AE_WS_EXPLORER_READONLY",
  write: "AE_WS_EXPLORER_WRITE",
  queryInsights: "AE_WS_QUERY_INSIGHTS",
};

export interface AgentEngineSettings {
  baseUrl: string;
  projectId: string;
  auth:
    | { kind: "serviceAccount"; clientId: string; clientSecret: string }
    | { kind: "apiKey"; apiKey: string }
    | { kind: "cli"; authFile: string };
  workspaces: Partial<Record<WorkspaceKey, string>>;
}

export function agentEngineSettings(): AgentEngineSettings {
  const baseUrl = env("AE_BASE_URL") ?? "https://agentengine.mongodb.com";
  const projectId = env("AE_PROJECT_ID");
  if (!projectId) {
    throw new Error("AE_PROJECT_ID is required. Copy example.env to .env and fill it in.");
  }
  const clientId = env("AE_SA_CLIENT_ID");
  const clientSecret = env("AE_SA_CLIENT_SECRET");
  const apiKey = env("AE_API_KEY");
  let auth: AgentEngineSettings["auth"];
  if (env("AE_AUTH") === "cli") {
    auth = { kind: "cli", authFile: env("AE_CLI_AUTH_FILE") ?? path.join(homedir(), ".agentengine", "auth.json") };
  } else if (clientId && clientSecret) {
    auth = { kind: "serviceAccount", clientId, clientSecret };
  } else if (apiKey) {
    auth = { kind: "apiKey", apiKey };
  } else {
    throw new Error("Set AE_AUTH=cli to use your CLI login, AE_SA_CLIENT_ID and AE_SA_CLIENT_SECRET, or AE_API_KEY.");
  }
  const workspaces: Partial<Record<WorkspaceKey, string>> = {};
  for (const [key, variable] of Object.entries(WORKSPACE_ENV) as [WorkspaceKey, string][]) {
    const id = env(variable);
    if (id) workspaces[key] = id;
  }
  return { baseUrl: baseUrl.replace(/\/+$/, ""), projectId, auth, workspaces };
}

export interface GroveSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
  style: "anthropic" | "openai" | "openai-responses";
  auth: "bearer" | "x-api-key" | "api-key";
  temperature?: number;
}

export function groveSettings(): GroveSettings {
  const baseUrl = env("GROVE_BASE_URL");
  const apiKey = env("GROVE_API_KEY");
  const model = env("GROVE_MODEL");
  if (!baseUrl || !apiKey || !model) {
    throw new Error("GROVE_BASE_URL, GROVE_API_KEY, and GROVE_MODEL are required for the judge.");
  }
  const style = env("GROVE_API_STYLE") ?? "anthropic";
  if (style !== "anthropic" && style !== "openai" && style !== "openai-responses") {
    throw new Error(`GROVE_API_STYLE must be anthropic, openai, or openai-responses, received "${style}"`);
  }
  const auth = env("GROVE_AUTH") ?? "bearer";
  if (auth !== "bearer" && auth !== "x-api-key" && auth !== "api-key") {
    throw new Error(`GROVE_AUTH must be bearer, x-api-key, or api-key, received "${auth}"`);
  }
  const rawTemperature = env("GROVE_TEMPERATURE") ?? "0";
  const temperature = rawTemperature === "none" ? undefined : Number(rawTemperature);
  if (temperature !== undefined && Number.isNaN(temperature)) {
    throw new Error(`GROVE_TEMPERATURE must be a number or "none", received "${rawTemperature}"`);
  }
  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    apiKey,
    model,
    style,
    auth,
    ...(temperature !== undefined ? { temperature } : {}),
  };
}

const PLACEHOLDER = /\{\{([A-Z0-9_]+)\}\}/g;

/** Returns the names of placeholders in `text` that have no value in the environment. */
export function missingPlaceholders(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER)]
    .map((match) => match[1]!)
    .filter((name) => !env(name));
}

export function fillPlaceholders(text: string): string {
  return text.replace(PLACEHOLDER, (_, name: string) => env(name) ?? `{{${name}}}`);
}
