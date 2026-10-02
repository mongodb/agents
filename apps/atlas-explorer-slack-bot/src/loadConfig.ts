import { z } from "zod";

import { slackBotConfig } from "./config.js";
import type { AgentEngineClientConfig } from "@repo/agent-engine-chat/agent-engine";

export type RuntimeMode = "socket" | "http";

export interface SlackBotConfig {
  mode: RuntimeMode;
  chat: {
    allowedActorIds: string[];
  };
  slack: {
    botToken: string;
    appToken?: string;
    signingSecret?: string;
    botDisplayName: string;
  };
  agentEngine: AgentEngineClientConfig;
  store: {
    mongoUri?: string;
    databaseName: string;
  };
}

const DEFAULT_SLACK_BOT_NAME = "AtlasExplorer";

const requiredString = z.string().trim().min(1, "is required");
const emptyStringToUndefined = (value: unknown): unknown =>
  typeof value === "string" && value.trim() === "" ? undefined : value;
const optionalString = z.preprocess(
  emptyStringToUndefined,
  z.string().trim().min(1).optional(),
);
const optionalUrl = z.preprocess(
  emptyStringToUndefined,
  z.url().optional(),
);

const environmentSchema = z
  .object({
    SLACK_BOT_TOKEN: requiredString,
    AGENTIC_SA_CLIENT_ID: optionalString,
    AGENTIC_SA_CLIENT_SECRET: optionalString,
    AGENTIC_PROJECT_ID: optionalString,
    AGENTIC_WORKSPACE_ID: optionalString,
    AGENTIC_INVOKE_TARGET: z
      .enum(["gateway", "local"])
      .optional()
      .default("gateway"),
    SLACK_SIGNING_SECRET: optionalString,
    MONGODB_URI: optionalString,
    SLACK_APP_TOKEN: optionalString,
    SLACK_BOT_DISPLAY_NAME: optionalString,
    CHAT_ALLOWED_USER_IDS: optionalString,
    AGENTIC_BASE_URL: optionalUrl,
    THREAD_STORE_DB: optionalString,
  })
  .passthrough();

function formatEnvironmentError(error: z.ZodError): string {
  const issues = error.issues.map((issue) => {
    const variable = String(issue.path[0] ?? "environment");
    return `${variable} ${issue.message}`;
  });
  return `Invalid environment: ${issues.join("; ")}`;
}

export function loadConfig(
  environment: Record<string, string | undefined>,
  mode: RuntimeMode,
): SlackBotConfig {
  const result = environmentSchema.safeParse(environment);
  const issues = result.success ? [] : [...result.error.issues];
  const parsed = result.success ? result.data : environment;

  if (mode === "socket" && !parsed.SLACK_APP_TOKEN?.trim()) {
    issues.push({
      code: "custom",
      message: "is required in Socket Mode",
      path: ["SLACK_APP_TOKEN"],
    });
  }
  if (mode === "http" && !parsed.SLACK_SIGNING_SECRET?.trim()) {
    issues.push({
      code: "custom",
      message: "is required in HTTP mode",
      path: ["SLACK_SIGNING_SECRET"],
    });
  }
  if (mode === "http" && !parsed.MONGODB_URI?.trim()) {
    issues.push({
      code: "custom",
      message: "is required in HTTP mode",
      path: ["MONGODB_URI"],
    });
  }
  if (
    !parsed.CHAT_ALLOWED_USER_IDS?.split(",").some(
      (actorId) => actorId.trim().length > 0,
    )
  ) {
    issues.push({
      code: "custom",
      message: "is required",
      path: ["CHAT_ALLOWED_USER_IDS"],
    });
  }
  if (
    parsed.CHAT_ALLOWED_USER_IDS &&
    parsed.CHAT_ALLOWED_USER_IDS.split(",")
      .map((actorId) => actorId.trim())
      .filter(Boolean)
      .some(
        (actorId) =>
          !/^[a-z][a-z0-9_-]*:.+$/i.test(actorId),
      )
  ) {
    issues.push({
      code: "custom",
      message:
        "must contain platform-qualified IDs such as slack:U123",
      path: ["CHAT_ALLOWED_USER_IDS"],
    });
  }
  const invokeTarget =
    parsed.AGENTIC_INVOKE_TARGET?.trim() === "local"
      ? "local"
      : "gateway";
  if (invokeTarget === "gateway") {
    for (const variable of [
      "AGENTIC_SA_CLIENT_ID",
      "AGENTIC_SA_CLIENT_SECRET",
      "AGENTIC_PROJECT_ID",
      "AGENTIC_WORKSPACE_ID",
    ] as const) {
      if (!parsed[variable]?.trim()) {
        issues.push({
          code: "custom",
          message: "is required for the gateway target",
          path: [variable],
        });
      }
    }
  }
  if (issues.length > 0) {
    throw new Error(formatEnvironmentError(new z.ZodError(issues)));
  }
  if (!result.success) {
    throw new Error(formatEnvironmentError(result.error));
  }

  const values = result.data;
  const allowedActorIds = [
    ...new Set(
      (values.CHAT_ALLOWED_USER_IDS ?? "")
        .split(",")
        .map((actorId) => actorId.trim())
        .filter(Boolean)
        .map(normalizePlatformPrefix),
    ),
  ];
  return {
    mode,
    chat: {
      allowedActorIds,
    },
    slack: {
      botToken: values.SLACK_BOT_TOKEN,
      ...(values.SLACK_APP_TOKEN
        ? { appToken: values.SLACK_APP_TOKEN }
        : {}),
      ...(values.SLACK_SIGNING_SECRET
        ? { signingSecret: values.SLACK_SIGNING_SECRET }
        : {}),
      botDisplayName:
        values.SLACK_BOT_DISPLAY_NAME ??
        (slackBotConfig.name.trim() || DEFAULT_SLACK_BOT_NAME),
    },
    agentEngine: buildAgenticConfig(values, invokeTarget),
    store: {
      ...(values.MONGODB_URI ? { mongoUri: values.MONGODB_URI } : {}),
      databaseName: values.THREAD_STORE_DB ?? "atlas_explorer_slack",
    },
  };
}

function buildAgenticConfig(
  values: z.infer<typeof environmentSchema>,
  invokeTarget: "gateway" | "local",
): AgentEngineClientConfig {
  const baseUrl = (
    values.AGENTIC_BASE_URL ??
    (invokeTarget === "local"
      ? "http://localhost:3000"
      : "https://agentic-platform.mongodb.com")
  ).replace(/\/+$/, "");
  if (invokeTarget === "local") {
    return { baseUrl, invokeTarget };
  }

  const clientId = values.AGENTIC_SA_CLIENT_ID;
  const clientSecret = values.AGENTIC_SA_CLIENT_SECRET;
  const projectId = values.AGENTIC_PROJECT_ID;
  const workspaceId = values.AGENTIC_WORKSPACE_ID;
  if (!clientId || !clientSecret || !projectId || !workspaceId) {
    throw new Error(
      "Gateway configuration was not validated before construction",
    );
  }
  return {
    baseUrl,
    invokeTarget,
    projectId,
    serviceAccount: { clientId, clientSecret },
    workspaceId,
  };
}

function normalizePlatformPrefix(actorId: string): string {
  const separator = actorId.indexOf(":");
  return `${actorId.slice(0, separator).toLowerCase()}${actorId.slice(
    separator,
  )}`;
}
