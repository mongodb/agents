import { z } from "zod";

export interface AccessTokenProvider {
  getAccessToken(signal?: AbortSignal): Promise<string>;
  invalidate(accessToken: string): void;
}

interface ServiceAccountTokenProviderConfig {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
}

interface ServiceAccountTokenProviderOptions {
  fetchFn?: typeof fetch;
  now?: () => number;
  refreshSkewMs?: number;
  timeoutMs?: number;
}

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.literal("Bearer"),
  expires_in: z.number().positive(),
});

export class AgenticAuthenticationError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "AgenticAuthenticationError";
    this.status = status;
  }
}

export class ServiceAccountTokenProvider implements AccessTokenProvider {
  private readonly baseUrl: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;
  private readonly refreshSkewMs: number;
  private readonly timeoutMs: number;
  private cachedToken?: {
    accessToken: string;
    refreshAt: number;
  };
  private pendingExchange?: Promise<{
    accessToken: string;
    refreshAt: number;
  }>;

  constructor(
    config: ServiceAccountTokenProviderConfig,
    options: ServiceAccountTokenProviderOptions = {},
  ) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.fetchFn = options.fetchFn ?? fetch;
    this.now = options.now ?? Date.now;
    this.refreshSkewMs = options.refreshSkewMs ?? 60_000;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  async getAccessToken(signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted();
    if (
      this.cachedToken &&
      this.now() < this.cachedToken.refreshAt
    ) {
      return this.cachedToken.accessToken;
    }
    const pending =
      this.pendingExchange ?? this.startExchange();
    const token = await (signal
      ? waitForAbort(pending, signal)
      : pending);
    return token.accessToken;
  }

  invalidate(accessToken: string): void {
    if (this.cachedToken?.accessToken === accessToken) {
      this.cachedToken = undefined;
    }
  }

  private startExchange(): Promise<{
    accessToken: string;
    refreshAt: number;
  }> {
    const pending = this.exchange();
    this.pendingExchange = pending;
    const clearPending = (): void => {
      if (this.pendingExchange === pending) {
        this.pendingExchange = undefined;
      }
    };
    void pending.then(clearPending, clearPending);
    return pending;
  }

  private async exchange(): Promise<{
    accessToken: string;
    refreshAt: number;
  }> {
    let response: Response;
    try {
      response = await this.fetchFn(
        `${this.baseUrl}/api/v1/oauth/token`,
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${Buffer.from(
              `${this.clientId}:${this.clientSecret}`,
            ).toString("base64")}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            grant_type: "client_credentials",
          }).toString(),
          signal: AbortSignal.timeout(this.timeoutMs),
        },
      );
    } catch {
      throw new AgenticAuthenticationError(
        "Agentic service-account token exchange failed",
        0,
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new AgenticAuthenticationError(
        `Agentic service-account token exchange returned an invalid response (HTTP ${response.status})`,
        response.status,
      );
    }
    const parsed = tokenResponseSchema.safeParse(body);
    if (!response.ok || !parsed.success) {
      throw new AgenticAuthenticationError(
        `Agentic service-account token exchange failed (HTTP ${response.status})`,
        response.status,
      );
    }
    const lifetimeMs = parsed.data.expires_in * 1000;
    const refreshSkewMs = Math.min(
      this.refreshSkewMs,
      lifetimeMs / 2,
    );
    const token = {
      accessToken: parsed.data.access_token,
      refreshAt: this.now() + lifetimeMs - refreshSkewMs,
    };
    this.cachedToken = token;
    return token;
  }
}

function waitForAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      reject(signal.reason);
    };
    const removeAbortListener = (): void => {
      signal.removeEventListener("abort", onAbort);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    void promise.then(
      (value) => {
        removeAbortListener();
        resolve(value);
      },
      (error: unknown) => {
        removeAbortListener();
        reject(error);
      },
    );
  });
}
