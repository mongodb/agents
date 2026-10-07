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

import type { GroveSettings } from "./config.ts";

const RETRYABLE = new Set([408, 409, 425, 429, 500, 502, 503, 504, 529]);
const MAX_ATTEMPTS = 4;

function authHeaders(settings: GroveSettings): Record<string, string> {
  switch (settings.auth) {
    case "bearer":
      return { Authorization: `Bearer ${settings.apiKey}` };
    case "x-api-key":
      return { "x-api-key": settings.apiKey };
    case "api-key":
      return { "api-key": settings.apiKey };
  }
}

function request(settings: GroveSettings, system: string, user: string): { url: string; body: unknown; headers: Record<string, string> } {
  const temperature = settings.temperature !== undefined ? { temperature: settings.temperature } : {};
  if (settings.style === "anthropic") {
    return {
      url: `${settings.baseUrl}/messages`,
      headers: { "anthropic-version": "2023-06-01" },
      body: {
        model: settings.model,
        max_tokens: 1024,
        system,
        messages: [{ role: "user", content: user }],
        ...temperature,
      },
    };
  }
  if (settings.style === "openai-responses") {
    return {
      url: `${settings.baseUrl}/responses`,
      headers: {},
      body: {
        model: settings.model,
        instructions: system,
        input: user,
        store: false,
        ...temperature,
      },
    };
  }
  return {
    url: `${settings.baseUrl}/chat/completions`,
    headers: {},
    body: {
      model: settings.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      ...temperature,
    },
  };
}

function extractText(style: GroveSettings["style"], data: unknown): string {
  if (style === "anthropic") {
    const content = (data as { content?: { type?: string; text?: string }[] }).content ?? [];
    return content
      .filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("");
  }
  if (style === "openai-responses") {
    const response = data as {
      status?: string;
      output?: { type?: string; content?: { type?: string; text?: string }[] }[];
    };
    if (response.status && response.status !== "completed") {
      throw new Error(`Grove response status: ${response.status}`);
    }
    return (response.output ?? [])
      .filter((item) => item.type === "message")
      .flatMap((item) => item.content ?? [])
      .filter((block) => block.type === "output_text")
      .map((block) => block.text ?? "")
      .join("");
  }
  const choices = (data as { choices?: { message?: { content?: string } }[] }).choices ?? [];
  return choices[0]?.message?.content ?? "";
}

/** One completion through the Grove gateway, with retries on rate limits and 5xx. */
export async function complete(settings: GroveSettings, system: string, user: string): Promise<string> {
  const { url, body, headers } = request(settings, system, user);
  let lastError = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders(settings), ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
    const text = await response.text();
    if (response.ok) {
      return extractText(settings.style, JSON.parse(text));
    }
    lastError = `Grove HTTP ${response.status}: ${text.slice(0, 500)}`;
    if (response.status === 403 && /rbac/i.test(text)) {
      throw new Error(`${lastError}\nCheck GROVE_BASE_URL and that the gateway is reachable from this network (VPN, if it needs one).`);
    }
    if (!RETRYABLE.has(response.status)) break;
    const retryAfter = Number(response.headers.get("retry-after"));
    const delayMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 1000;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error(lastError);
}
