import { beforeEach, describe, expect, it, vi } from "vitest";

import { loadConfig } from "./loadConfig.js";

const staticConfig = vi.hoisted(() => ({ name: "" }));
vi.mock("./config.js", () => ({ slackBotConfig: staticConfig }));

const DEFAULT_BOT_NAME = "AtlasExplorer";
const CONFIG_BOT_NAME = "ConfigBot";
const ENV_BOT_NAME = "EnvBot";

const sharedEnv = {
  SLACK_BOT_TOKEN: "xoxb-test",
  AGENTIC_SA_CLIENT_ID: "agp_sa_id_test",
  AGENTIC_SA_CLIENT_SECRET: "agp_sa_sk_test",
  AGENTIC_PROJECT_ID: "project-1",
  AGENTIC_WORKSPACE_ID: "workspace-1",
  CHAT_ALLOWED_USER_IDS: "slack:U123",
};

describe("loadConfig", () => {
  beforeEach(() => {
    staticConfig.name = "";
  });

  it("loads Socket Mode without a MongoDB connection", () => {
    const config = loadConfig(
      {
        ...sharedEnv,
        SLACK_APP_TOKEN: "xapp-test",
      },
      "socket",
    );

    expect(config).toEqual({
      mode: "socket",
      chat: {
        allowedActorIds: ["slack:U123"],
      },
      slack: {
        appToken: "xapp-test",
        botDisplayName: DEFAULT_BOT_NAME,
        botToken: "xoxb-test",
      },
      agentEngine: {
        baseUrl: "https://agentic-platform.mongodb.com",
        invokeTarget: "gateway",
        projectId: "project-1",
        serviceAccount: {
          clientId: "agp_sa_id_test",
          clientSecret: "agp_sa_sk_test",
        },
        workspaceId: "workspace-1",
      },
      store: {
        databaseName: "atlas_explorer_slack",
      },
    });
  });

  describe("bot display name", () => {
    const socketEnv = { ...sharedEnv, SLACK_APP_TOKEN: "xapp-test" };

    it("uses a trimmed SLACK_BOT_DISPLAY_NAME", () => {
      const config = loadConfig(
        { ...socketEnv, SLACK_BOT_DISPLAY_NAME: ` ${ENV_BOT_NAME} ` },
        "socket",
      );

      expect(config.slack.botDisplayName).toBe(ENV_BOT_NAME);
    });

    it("prefers SLACK_BOT_DISPLAY_NAME over the checked-in config name", () => {
      staticConfig.name = CONFIG_BOT_NAME;

      const config = loadConfig(
        { ...socketEnv, SLACK_BOT_DISPLAY_NAME: ENV_BOT_NAME },
        "socket",
      );

      expect(config.slack.botDisplayName).toBe(ENV_BOT_NAME);
    });

    it("uses the trimmed checked-in config name when the env var is unset", () => {
      staticConfig.name = ` ${CONFIG_BOT_NAME} `;

      const config = loadConfig(socketEnv, "socket");

      expect(config.slack.botDisplayName).toBe(CONFIG_BOT_NAME);
    });

    it("uses the checked-in config name when the env var is blank", () => {
      staticConfig.name = CONFIG_BOT_NAME;

      const config = loadConfig(
        { ...socketEnv, SLACK_BOT_DISPLAY_NAME: "   " },
        "socket",
      );

      expect(config.slack.botDisplayName).toBe(CONFIG_BOT_NAME);
    });

    it("falls back to AtlasExplorer when the env var and config name are blank", () => {
      staticConfig.name = "   ";

      const config = loadConfig(
        { ...socketEnv, SLACK_BOT_DISPLAY_NAME: "   " },
        "socket",
      );

      expect(config.slack.botDisplayName).toBe(DEFAULT_BOT_NAME);
    });
  });

  it("requires persistent storage and request signing in HTTP mode", () => {
    expect(() => loadConfig(sharedEnv, "http")).toThrow(
      /SLACK_SIGNING_SECRET.*MONGODB_URI/s,
    );
  });

  it("requires and parses a platform-qualified chat allowlist", () => {
    const httpEnv = {
      ...sharedEnv,
      SLACK_SIGNING_SECRET: "signing-secret",
      MONGODB_URI: "mongodb://localhost:27017",
      CHAT_ALLOWED_USER_IDS: undefined,
    };
    expect(() => loadConfig(httpEnv, "http")).toThrow(
      /CHAT_ALLOWED_USER_IDS/,
    );

    const config = loadConfig(
      {
        ...httpEnv,
        CHAT_ALLOWED_USER_IDS:
          " slack:U123, discord:U456 ,slack:U123 ",
      },
      "http",
    );
    expect(config.chat.allowedActorIds).toEqual([
      "slack:U123",
      "discord:U456",
    ]);
  });

  it("rejects unqualified IDs in the new cross-platform allowlist", () => {
    expect(() =>
      loadConfig(
        {
          ...sharedEnv,
          CHAT_ALLOWED_USER_IDS: "U123",
          SLACK_APP_TOKEN: "xapp-test",
        },
        "socket",
      ),
    ).toThrow(/platform-qualified/i);
  });

  it("normalizes an Agentic base URL before requests are built", () => {
    const config = loadConfig(
      {
        ...sharedEnv,
        SLACK_APP_TOKEN: "xapp-test",
        AGENTIC_BASE_URL: "https://agentic.example.test///",
      },
      "socket",
    );

    expect(config.agentEngine.baseUrl).toBe("https://agentic.example.test");
  });

  it("selects the local Playground invoke contract explicitly", () => {
    const config = loadConfig(
      {
        SLACK_BOT_TOKEN: "xoxb-test",
        CHAT_ALLOWED_USER_IDS: "slack:U123",
        SLACK_APP_TOKEN: "xapp-test",
        AGENTIC_INVOKE_TARGET: "local",
        AGENTIC_BASE_URL: "",
        AGENTIC_SA_CLIENT_ID: "",
        AGENTIC_SA_CLIENT_SECRET: "",
        AGENTIC_PROJECT_ID: "",
        AGENTIC_WORKSPACE_ID: "",
        SLACK_SIGNING_SECRET: "",
        MONGODB_URI: "",
      },
      "socket",
    );

    expect(config.agentEngine).toEqual({
      baseUrl: "http://localhost:3000",
      invokeTarget: "local",
    });
  });

  it.each([
    ["AGENTIC_SA_CLIENT_ID", undefined, "agp_sa_sk_test"],
    ["AGENTIC_SA_CLIENT_SECRET", "agp_sa_id_test", undefined],
  ] as const)(
    "rejects a partial service-account pair missing %s",
    (missingVariable, clientId, clientSecret) => {
      expect(() =>
        loadConfig(
          {
            ...sharedEnv,
            AGENTIC_SA_CLIENT_ID: clientId,
            AGENTIC_SA_CLIENT_SECRET: clientSecret,
            SLACK_APP_TOKEN: "xapp-test",
          },
          "socket",
        ),
      ).toThrow(new RegExp(missingVariable));
    },
  );

  it("identifies missing shared credentials by environment variable name", () => {
    expect(() =>
      loadConfig(
        {
          SLACK_APP_TOKEN: "xapp-test",
        },
        "socket",
      ),
    ).toThrow(
      /SLACK_BOT_TOKEN.*AGENTIC_SA_CLIENT_ID.*AGENTIC_SA_CLIENT_SECRET.*AGENTIC_PROJECT_ID.*AGENTIC_WORKSPACE_ID/s,
    );
  });
});
