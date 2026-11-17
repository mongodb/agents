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

/**
 * Connection settings for an OpenAI-compatible endpoint.
 *
 * The agent's model (`buildLLM`) and the evals judge both build their OpenAI
 * client from this, so the Grove gateway and Azure OpenAI quirks live in one
 * place.
 */

export interface OpenAIConnection {
  baseURL: string;
  defaultHeaders?: Record<string, string>;
  defaultQuery?: Record<string, string>;
}

export interface OpenAIConnectionOptions {
  baseUrl: string;
  apiKey: string;
  /** Defaults to `AZURE_OPENAI_API_VERSION`, then a pinned version. */
  azureApiVersion?: string;
}

/**
 * Grove is an Azure OpenAI compatible gateway. It reads the key from an
 * `api-key` header and serves the OpenAI routes under `/v1`, so anything the
 * caller appended after `/v1` is dropped. A raw Azure deployment URL needs the
 * same header plus an `api-version` query parameter.
 */
export function resolveOpenAIConnection(
  opts: OpenAIConnectionOptions,
  env: { AZURE_OPENAI_API_VERSION?: string } = process.env,
): OpenAIConnection {
  const { baseUrl, apiKey } = opts;
  const headers: Record<string, string> = {};
  const query: Record<string, string> = {};
  let baseURL = baseUrl.replace(/\/$/, "");

  if (baseUrl.includes("grove-foundry")) {
    baseURL = baseUrl.split("/v1")[0] + "/v1";
    headers["api-key"] = apiKey;
  }
  if (baseUrl.toLowerCase().includes("/openai/deployments/")) {
    query["api-version"] =
      opts.azureApiVersion ??
      env.AZURE_OPENAI_API_VERSION ??
      "2024-12-01-preview";
    headers["api-key"] = apiKey;
  }

  return {
    baseURL,
    defaultHeaders: Object.keys(headers).length ? headers : undefined,
    defaultQuery: Object.keys(query).length ? query : undefined,
  };
}
