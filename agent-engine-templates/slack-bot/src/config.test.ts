import { describe, expect, it } from "vitest";

import { loadConfig } from "./config.js";

const sharedEnv = {
  SLACK_BOT_TOKEN: "xoxb-test",
  AGENTIC_SA_CLIENT_ID: "agp_sa_id_test",
  AGENTIC_SA_CLIENT_SECRET: "agp_sa_sk_test",
  AGENTIC_PROJECT_ID: "project-1",
  AGENTIC_WORKSPACE_ID: "workspace-1",
  CHAT_ALLOWED_USER_IDS: "slack:U123",
};

describe("loadConfig", () => {
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
        botDisplayName: "AtlasExplorer",
        botToken: "xoxb-test",
      },
      agentic: {
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

    expect(config.agentic.baseUrl).toBe("https://agentic.example.test");
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

    expect(config.agentic).toEqual({
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
