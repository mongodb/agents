import { readFile } from "node:fs/promises";

import { waitUntil } from "@vercel/functions";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getHttpRuntime } from "../runtime.js";

vi.mock("@vercel/functions", () => ({
  waitUntil: vi.fn(),
}));

vi.mock("../runtime.js", () => ({
  getHttpRuntime: vi.fn(),
}));

describe("Slack webhook route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("forwards the untouched request and Vercel waitUntil", async () => {
    const request = new Request(
      "https://example.com/api/webhooks/slack",
      {
        method: "POST",
        body: JSON.stringify({ type: "url_verification" }),
      },
    );
    const response = new Response("ok");
    const webhook = vi.fn().mockResolvedValue(response);
    vi.mocked(getHttpRuntime).mockResolvedValue({
      bot: {
        webhooks: { slack: webhook },
      },
    } as never);
    const { POST, maxDuration } =
      await import("../../api/webhooks/slack.js");

    await expect(POST(request)).resolves.toBe(response);

    expect(webhook).toHaveBeenCalledWith(request, { waitUntil });
    expect(maxDuration).toBe(300);
  });

  it("keeps API-only Vercel project settings in source control", async () => {
    const vercelConfig = JSON.parse(
      await readFile(
        new URL("../../vercel.json", import.meta.url),
        "utf8",
      ),
    );
    const packageConfig = JSON.parse(
      await readFile(
        new URL("../../package.json", import.meta.url),
        "utf8",
      ),
    );

    expect(vercelConfig).toMatchObject({
      buildCommand: "pnpm --filter @repo/agent-engine-chat build",
      fluid: true,
      framework: null,
      regions: ["iad1"],
    });
    expect(packageConfig.engines.node).toBe("22.x");
    expect(packageConfig.scripts.vercel).toBe(
      "pnpm dlx --allow-build=esbuild vercel",
    );
    expect(packageConfig.devDependencies).not.toHaveProperty(
      "vercel",
    );
  });
});
