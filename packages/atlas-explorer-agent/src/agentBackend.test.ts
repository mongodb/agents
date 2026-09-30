import { describe, expect, it, vi } from "vitest";

import { withoutShellExecution } from "./agentBackend.js";

describe("Atlas deep-agent backend", () => {
  it("keeps audited filesystem methods but hides shell execution", async () => {
    const source = {
      id: "agent-engine-toolpod",
      marker: "source",
      execute: vi.fn(),
      ls: vi.fn(function (this: { marker: string }, path: string) {
        return Promise.resolve({ path, marker: this.marker });
      }),
    };

    const backend = withoutShellExecution(source);

    expect("execute" in backend).toBe(false);
    expect((backend as { execute?: unknown }).execute).toBeUndefined();
    await expect(backend.ls("/app/skills")).resolves.toEqual({
      path: "/app/skills",
      marker: "source",
    });
    expect(source.execute).not.toHaveBeenCalled();
  });
});
