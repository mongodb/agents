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

import { describe, expect, it, vi } from "vitest";

import { ServiceAccountTokenProvider } from "./serviceAccountTokenProvider.js";

const config = {
  baseUrl: "https://agentic.example.test/",
  clientId: "agp_sa_id_test",
  clientSecret: "agp_sa_sk_test",
};

function tokenResponse(
  accessToken: string,
  expiresIn = 3600,
): Response {
  return new Response(
    JSON.stringify({
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: expiresIn,
    }),
    {
      status: 200,
      headers: { "content-type": "application/json" },
    },
  );
}

describe("ServiceAccountTokenProvider", () => {
  it("reuses a cached access token while it is fresh", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(tokenResponse("cached-token"));
    const provider = new ServiceAccountTokenProvider(config, {
      fetchFn,
    });

    await expect(provider.getAccessToken()).resolves.toBe(
      "cached-token",
    );
    await expect(provider.getAccessToken()).resolves.toBe(
      "cached-token",
    );

    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("shares one token exchange across concurrent callers", async () => {
    let resolveResponse!: (response: Response) => void;
    const response = new Promise<Response>((resolve) => {
      resolveResponse = resolve;
    });
    const fetchFn = vi.fn<typeof fetch>(() => response);
    const provider = new ServiceAccountTokenProvider(config, {
      fetchFn,
    });

    const first = provider.getAccessToken();
    const second = provider.getAccessToken();
    expect(fetchFn).toHaveBeenCalledTimes(1);

    resolveResponse(tokenResponse("shared-token"));
    await expect(Promise.all([first, second])).resolves.toEqual([
      "shared-token",
      "shared-token",
    ]);
  });

  it("stops one caller at its deadline without cancelling the shared exchange", async () => {
    let resolveResponse!: (response: Response) => void;
    const response = new Promise<Response>((resolve) => {
      resolveResponse = resolve;
    });
    const provider = new ServiceAccountTokenProvider(config, {
      fetchFn: vi.fn<typeof fetch>(() => response),
    });
    const controller = new AbortController();
    const deadlineError = new Error("invocation deadline exceeded");

    const request = provider.getAccessToken(controller.signal);
    controller.abort(deadlineError);
    resolveResponse(tokenResponse("eventually-cached-token"));

    await expect(request).rejects.toBe(deadlineError);
    await expect(provider.getAccessToken()).resolves.toBe(
      "eventually-cached-token",
    );
  });

  it("refreshes a token before it expires", async () => {
    let now = 0;
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(tokenResponse("first-token", 120))
      .mockResolvedValueOnce(tokenResponse("second-token", 120));
    const provider = new ServiceAccountTokenProvider(config, {
      fetchFn,
      now: () => now,
      refreshSkewMs: 30_000,
    });

    await expect(provider.getAccessToken()).resolves.toBe(
      "first-token",
    );
    now = 89_999;
    await expect(provider.getAccessToken()).resolves.toBe(
      "first-token",
    );
    now = 90_000;
    await expect(provider.getAccessToken()).resolves.toBe(
      "second-token",
    );

    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("does not invalidate a newer token for a stale rejected token", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(tokenResponse("first-token"))
      .mockResolvedValueOnce(tokenResponse("second-token"))
      .mockResolvedValueOnce(tokenResponse("unexpected-third-token"));
    const provider = new ServiceAccountTokenProvider(config, {
      fetchFn,
    });

    await expect(provider.getAccessToken()).resolves.toBe(
      "first-token",
    );
    provider.invalidate("first-token");
    await expect(provider.getAccessToken()).resolves.toBe(
      "second-token",
    );
    provider.invalidate("first-token");

    await expect(provider.getAccessToken()).resolves.toBe(
      "second-token",
    );
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("does not expose credentials or token response data in errors", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: `${config.clientId}:${config.clientSecret}:token-data`,
        }),
        { status: 401 },
      ),
    );
    const provider = new ServiceAccountTokenProvider(config, {
      fetchFn,
    });

    const request = provider.getAccessToken();
    await expect(request).rejects.toThrow(
      "Agentic service-account token exchange failed (HTTP 401)",
    );
    await expect(request).rejects.not.toThrow(config.clientSecret);
    await expect(request).rejects.not.toThrow("token-data");
  });
});
