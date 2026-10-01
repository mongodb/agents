import type {
  AgentEngineClient,
  ClientUserMetadata,
  InvocationProgressHandler,
  InvocationResult,
  InvokeInput,
  ResumeInput,
} from "./types.js";
import {
  invokeResponseSchema,
  streamChunkSchema,
  suspendContextSchema,
} from "./types.js";
import {
  type AccessTokenProvider,
  AgenticAuthenticationError,
  ServiceAccountTokenProvider,
} from "./serviceAccountTokenProvider.js";

interface ClientOptions {
  fetchFn?: typeof fetch;
  tokenProvider?: AccessTokenProvider;
  timeoutMs?: number;
}

export type AgenticRequestOutcome =
  | "not_sent"
  | "rejected"
  | "unknown";

interface AgenticApiErrorOptions {
  cause?: unknown;
  code?: string;
  requestOutcome: AgenticRequestOutcome;
  status: number;
}

export class AgenticApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly requestOutcome: AgenticRequestOutcome;

  constructor(message: string, options: AgenticApiErrorOptions) {
    super(message, { cause: options.cause });
    this.name = "AgenticApiError";
    this.status = options.status;
    this.code = options.code;
    this.requestOutcome = options.requestOutcome;
  }
}

export class MagentaClient {
  private readonly config: AgentEngineClient;
  private readonly fetchFn: typeof fetch;
  private readonly tokenProvider?: AccessTokenProvider;
  private readonly timeoutMs: number;

  constructor(config: AgentEngineClient, options: ClientOptions = {}) {
    this.config = {
      ...config,
      baseUrl: config.baseUrl.replace(/\/+$/, ""),
    };
    this.fetchFn = options.fetchFn ?? fetch;
    this.tokenProvider =
      options.tokenProvider ??
      (config.invokeTarget === "gateway"
        ? new ServiceAccountTokenProvider(
            {
              baseUrl: config.baseUrl,
              ...config.serviceAccount,
            },
            { fetchFn: this.fetchFn },
          )
        : undefined);
    this.timeoutMs = options.timeoutMs ?? 280_000;
  }

  invoke(input: InvokeInput): Promise<InvocationResult> {
    const message = input.message.trim();
    if (!message) {
      return Promise.reject(
        new AgenticApiError("Agent message cannot be empty", {
          status: 0,
          code: "INVALID_INPUT",
          requestOutcome: "not_sent",
        }),
      );
    }

    // The cloud gateway blocks by default and treats `wait` as agent payload.
    // The local Playground proxy forwards to OE, where `wait: true` requests
    // the terminal result instead of an accepted/running response.
    return this.post({
      message,
      ...(this.config.invokeTarget === "local" ? { wait: true } : {}),
      ...(input.sessionId ? { session_id: input.sessionId } : {}),
      user_id: input.actorId,
      ...clientUserBody(input),
    });
  }

  invokeStream(
    input: InvokeInput,
    onProgress?: InvocationProgressHandler,
  ): Promise<InvocationResult> {
    const message = input.message.trim();
    if (!message) {
      return Promise.reject(
        new AgenticApiError("Agent message cannot be empty", {
          status: 0,
          code: "INVALID_INPUT",
          requestOutcome: "not_sent",
        }),
      );
    }
    return this.stream(
      {
        message,
        ...(input.sessionId ? { session_id: input.sessionId } : {}),
        user_id: input.actorId,
        ...clientUserBody(input),
      },
      onProgress,
    );
  }

  resume(input: ResumeInput): Promise<InvocationResult> {
    return this.post({
      session_id: input.sessionId,
      user_id: input.actorId,
      ...(this.config.invokeTarget === "local" ? { wait: true } : {}),
      resume_map: buildResumeMap(input),
      ...clientUserBody(input),
    });
  }

  resumeStream(
    input: ResumeInput,
    onProgress?: InvocationProgressHandler,
  ): Promise<InvocationResult> {
    return this.stream(
      {
        session_id: input.sessionId,
        user_id: input.actorId,
        resume_map: buildResumeMap(input),
        ...clientUserBody(input),
      },
      onProgress,
    );
  }

  private async post(body: Record<string, unknown>): Promise<InvocationResult> {
    const sessionId =
      typeof body.session_id === "string" ? body.session_id : undefined;
    const response = await this.sendRequest(
      this.invokeUrl(),
      body,
      sessionId,
      "Agentic request failed",
    );

    const rawBody = await readResponseText(response);
    let raw: unknown;
    try {
      raw = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      throw new AgenticApiError(
        `Agentic API returned non-JSON content (HTTP ${response.status})`,
        {
          status: response.status,
          code: "INVALID_RESPONSE",
          requestOutcome: requestOutcomeForResponse(response.status),
        },
      );
    }

    const parsed = invokeResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new AgenticApiError(
        "Agentic API returned an invalid response",
        {
          status: response.status,
          code: "INVALID_RESPONSE",
          requestOutcome: response.ok
            ? "unknown"
            : requestOutcomeForResponse(response.status),
        },
      );
    }

    const data = parsed.data;
    if (!response.ok || data.success === false) {
      throw new AgenticApiError(
        data.error ?? `Agentic API request failed (HTTP ${response.status})`,
        {
          status: response.status,
          code: data.code,
          requestOutcome: requestOutcomeForResponse(
            response.status,
            data.code,
          ),
        },
      );
    }

    const returnedSessionId =
      data.session_id ?? response.headers.get("X-Session-ID") ?? undefined;
    if (!returnedSessionId) {
      throw new AgenticApiError(
        "Agentic API returned an invalid response without a session ID",
        {
          status: response.status,
          code: "INVALID_RESPONSE",
          requestOutcome: "unknown",
        },
      );
    }

    if (data.status === "error" || data.status === "cancelled") {
      throw new AgenticApiError(
        data.error ?? `Agentic execution ${data.status}`,
        {
          status: response.status,
          code:
            data.status === "error"
              ? "EXECUTION_ERROR"
              : "EXECUTION_CANCELLED",
          requestOutcome: "unknown",
        },
      );
    }

    const completedOutput =
      data.response !== undefined
        ? data.response
        : formatAgentResult(data.result);
    if (
      data.status === "completed" ||
      (data.status === undefined && completedOutput !== undefined)
    ) {
      if (completedOutput === undefined) {
        throw new AgenticApiError(
          "Agentic API returned an invalid response without agent output",
          {
            status: response.status,
            code: "INVALID_RESPONSE",
            requestOutcome: "unknown",
          },
        );
      }
      return {
        kind: "completed",
        response: completedOutput,
        sessionId: returnedSessionId,
        ...(data.execution_id ? { executionId: data.execution_id } : {}),
      };
    }

    if (data.status === "suspended") {
      if (!data.execution_id) {
        throw new AgenticApiError(
          "Agentic API returned a suspended execution without an execution ID",
          {
            status: response.status,
            code: "INVALID_RESPONSE",
            requestOutcome: "unknown",
          },
        );
      }
      const interrupts = data.suspend_context?.interrupts;
      if (!interrupts?.length) {
        throw new AgenticApiError(
          "Agentic API returned a suspended execution without interrupt details",
          {
            status: response.status,
            code: "INVALID_RESPONSE",
            requestOutcome: "unknown",
          },
        );
      }
      return {
        kind: "suspended",
        sessionId: returnedSessionId,
        executionId: data.execution_id,
        interrupts,
        ...(data.suspend_context?.resume_schema
          ? { resumeSchema: data.suspend_context.resume_schema }
          : {}),
      };
    }

    throw new AgenticApiError(
      `Agentic API returned unsupported execution status: ${data.status ?? "missing"}`,
      {
        status: response.status,
        code: "INVALID_RESPONSE",
        requestOutcome: "unknown",
      },
    );
  }

  private async stream(
    body: Record<string, unknown>,
    onProgress?: InvocationProgressHandler,
  ): Promise<InvocationResult> {
    const sessionId =
      typeof body.session_id === "string" ? body.session_id : undefined;
    const response = await this.sendRequest(
      this.invokeStreamUrl(),
      body,
      sessionId,
      "Agentic stream failed",
    );

    if (!response.ok) {
      const rawBody = await readResponseText(response);
      let errorBody: {
        error?: string;
        message?: string;
        detail?: string;
        code?: string;
      } = {};
      try {
        errorBody = rawBody ? JSON.parse(rawBody) : {};
      } catch {
        throw new AgenticApiError(
          `Agentic API returned non-JSON content (HTTP ${response.status})`,
          {
            status: response.status,
            code: "INVALID_RESPONSE",
            requestOutcome: requestOutcomeForResponse(response.status),
          },
        );
      }
      throw new AgenticApiError(
        errorBody.error ??
          errorBody.message ??
          errorBody.detail ??
          `Agentic stream failed (HTTP ${response.status})`,
        {
          status: response.status,
          code: errorBody.code,
          requestOutcome: requestOutcomeForResponse(
            response.status,
            errorBody.code,
          ),
        },
      );
    }

    const returnedSessionId =
      response.headers.get("X-Session-ID") ?? sessionId;

    let executionId: string | undefined;
    let finalContent: string | undefined;
    let streamedContent = "";
    let completed = false;
    let suspendedContext: unknown;
    for await (const data of readSseData(response)) {
      const parsed = streamChunkSchema.safeParse(data);
      if (!parsed.success) {
        throw new AgenticApiError(
          "Agentic stream returned an invalid event",
          {
            status: response.status,
            code: "INVALID_RESPONSE",
            requestOutcome: "unknown",
          },
        );
      }
      const chunk = parsed.data;
      executionId ??=
        chunk.execution_id || chunk.metadata.execution_id || undefined;
      if (chunk.chunk_type === "progress") {
        await onProgress?.({
          content: chunk.content,
          phase: chunk.metadata.phase,
          toolName: chunk.metadata.tool_name,
          status: chunk.metadata.status,
        });
      } else if (chunk.chunk_type === "text") {
        streamedContent += chunk.content;
      } else if (chunk.chunk_type === "done") {
        if (chunk.metadata.status === "suspended") {
          const rawContext = chunk.metadata.suspend_context;
          try {
            suspendedContext = rawContext ? JSON.parse(rawContext) : undefined;
          } catch {
            throw new AgenticApiError(
              "Agentic stream returned malformed suspend context",
              {
                status: response.status,
                code: "INVALID_RESPONSE",
                requestOutcome: "unknown",
              },
            );
          }
        } else {
          completed = true;
          finalContent = chunk.content || streamedContent;
        }
      }
      if (chunk.error) {
        throw new AgenticApiError(
          chunk.error,
          {
            status: response.status,
            code: chunk.code ?? "EXECUTION_ERROR",
            requestOutcome: "unknown",
          },
        );
      }
    }

    if (!returnedSessionId) {
      throw new AgenticApiError(
        "Agentic stream returned an invalid response without a session ID",
        {
          status: response.status,
          code: "INVALID_RESPONSE",
          requestOutcome: "unknown",
        },
      );
    }
    if (suspendedContext !== undefined) {
      const parsedContext = suspendContextSchema.safeParse(suspendedContext);
      if (!executionId || !parsedContext.success) {
        throw new AgenticApiError(
          "Agentic stream returned invalid interrupt details",
          {
            status: response.status,
            code: "INVALID_RESPONSE",
            requestOutcome: "unknown",
          },
        );
      }
      return {
        kind: "suspended",
        sessionId: returnedSessionId,
        executionId,
        interrupts: parsedContext.data.interrupts,
        ...(parsedContext.data.resume_schema
          ? { resumeSchema: parsedContext.data.resume_schema }
          : {}),
      };
    }
    if (!completed || finalContent === undefined) {
      throw new AgenticApiError(
        "Agentic stream ended without a completed result",
        {
          status: response.status,
          code: "INVALID_RESPONSE",
          requestOutcome: "unknown",
        },
      );
    }
    return {
      kind: "completed",
      response: finalContent,
      sessionId: returnedSessionId,
      ...(executionId ? { executionId } : {}),
    };
  }

  private async sendRequest(
    url: string,
    body: Record<string, unknown>,
    sessionId: string | undefined,
    fallbackError: string,
  ): Promise<Response> {
    const signal = AbortSignal.timeout(this.timeoutMs);
    for (let attempt = 0; ; attempt += 1) {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      let accessToken: string | undefined;
      if (this.tokenProvider) {
        try {
          accessToken =
            await this.tokenProvider.getAccessToken(signal);
        } catch (error) {
          throw new AgenticApiError(
            "Agentic service-account authentication failed",
            {
              status:
                error instanceof AgenticAuthenticationError
                  ? error.status
                  : 0,
              code: "AUTHENTICATION_FAILED",
              requestOutcome:
                attempt === 0 ? "not_sent" : "rejected",
              cause: error,
            },
          );
        }
        headers.Authorization = `Bearer ${accessToken}`;
      }
      if (sessionId) {
        headers["X-Session-ID"] = sessionId;
      }

      let response: Response;
      try {
        response = await this.fetchFn(url, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : fallbackError;
        throw new AgenticApiError(message, {
          status: 0,
          code: "REQUEST_FAILED",
          requestOutcome: "unknown",
          cause: error,
        });
      }

      if (
        response.status === 401 &&
        this.tokenProvider &&
        accessToken &&
        attempt === 0
      ) {
        await response.body?.cancel().catch(() => undefined);
        this.tokenProvider.invalidate(accessToken);
        continue;
      }
      return response;
    }
  }

  private invokeUrl(): string {
    if (this.config.invokeTarget === "local") {
      return `${this.config.baseUrl}/invoke`;
    }
    const projectId = encodeURIComponent(this.config.projectId);
    const workspaceId = encodeURIComponent(this.config.workspaceId);
    return `${this.config.baseUrl}/api/v1/projects/${projectId}/workspaces/${workspaceId}/invoke`;
  }

  private invokeStreamUrl(): string {
    if (this.config.invokeTarget === "local") {
      return `${this.config.baseUrl}/invoke/stream`;
    }
    const projectId = encodeURIComponent(this.config.projectId);
    const workspaceId = encodeURIComponent(this.config.workspaceId);
    return `${this.config.baseUrl}/api/v1/projects/${projectId}/workspaces/${workspaceId}/invokeStream`;
  }
}

const CONFIRMED_REJECTION_STATUSES = new Set([
  400, 401, 403, 404, 422,
]);

function requestOutcomeForResponse(
  status: number,
  code?: string,
): AgenticRequestOutcome {
  return code === "RESUME_INPUT_INVALID" ||
    CONFIRMED_REJECTION_STATUSES.has(status)
    ? "rejected"
    : "unknown";
}

async function readResponseText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch (error) {
    throw new AgenticApiError(
      "Agentic API response body could not be read",
      {
        status: response.status,
        code: "INVALID_RESPONSE",
        requestOutcome: response.ok
          ? "unknown"
          : requestOutcomeForResponse(response.status),
        cause: error,
      },
    );
  }
}

function clientUserBody(input: {
  client?: string;
  user?: ClientUserMetadata;
}): Record<string, unknown> {
  return {
    ...(input.client !== undefined ? { client: input.client } : {}),
    ...(input.user !== undefined ? { user: input.user } : {}),
  };
}

function buildResumeMap(input: ResumeInput): Record<string, unknown> {
  const decisions = Array.isArray(input.decision)
    ? input.decision
    : [input.decision];
  return Object.fromEntries(
    [
      { interruptId: input.interruptId, decisions },
      ...(input.additionalInterrupts ?? []).map((interrupt) => ({
        interruptId: interrupt.interruptId,
        decisions: Array.isArray(interrupt.decision)
          ? interrupt.decision
          : [interrupt.decision],
      })),
    ].map(({ interruptId, decisions: interruptDecisions }) => [
      interruptId,
      { decisions: interruptDecisions },
    ]),
  );
}

async function* readSseData(
  response: Response,
): AsyncGenerator<unknown, void, undefined> {
  if (!response.body) {
    throw new AgenticApiError(
      "Agentic stream returned an empty response body",
      {
        status: response.status,
        code: "INVALID_RESPONSE",
        requestOutcome: "unknown",
      },
    );
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    let lineEnd = buffer.indexOf("\n");
    while (lineEnd >= 0) {
      const line = buffer.slice(0, lineEnd).trim();
      buffer = buffer.slice(lineEnd + 1);
      if (line.startsWith("data:")) {
        const data = line.slice("data:".length).trim();
        if (data && data !== "[DONE]") {
          try {
            yield JSON.parse(data);
          } catch {
            throw new AgenticApiError(
              "Agentic stream returned malformed JSON",
              {
                status: response.status,
                code: "INVALID_RESPONSE",
                requestOutcome: "unknown",
              },
            );
          }
        }
      }
      lineEnd = buffer.indexOf("\n");
    }
    if (done) {
      break;
    }
  }
}

function formatAgentResult(result: unknown): string | undefined {
  if (result === undefined) {
    return undefined;
  }
  if (typeof result === "string") {
    return result;
  }
  if (result && typeof result === "object") {
    const value = result as Record<string, unknown>;
    if (typeof value.content === "string") {
      return value.content;
    }
    if (typeof value.response === "string") {
      return value.response;
    }
  }
  return JSON.stringify(result);
}
