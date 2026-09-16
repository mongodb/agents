import { describe, expect, it } from "vitest";

import { persistUserRunsFromPayload } from "./userRun.js";

const recordedAt = "2026-09-16T15:01:00.000Z";

describe("persistUserRunsFromPayload", () => {
  it("appends a slack client user run", () => {
    expect(
      persistUserRunsFromPayload(
        {},
        {
          message: "List projects",
          client: "slack",
          user: {
            id: "U123",
            username: "ada",
            full_name: "Ada Lovelace",
            actor_id: "slack:U123",
          },
        },
        recordedAt,
      ),
    ).toEqual({
      user_runs: [
        {
          client: "slack",
          user: {
            id: "U123",
            username: "ada",
            full_name: "Ada Lovelace",
            actor_id: "slack:U123",
          },
          recorded_at: recordedAt,
        },
      ],
    });
  });

  it("appends a teams client user run without replacing prior rows", () => {
    const prior = persistUserRunsFromPayload(
      {},
      {
        client: "slack",
        user: { id: "U123", actor_id: "slack:U123" },
      },
      recordedAt,
    );
    expect(
      persistUserRunsFromPayload(
        prior ?? {},
        {
          client: "msteams",
          user: { id: "29:abc", actor_id: "msteams:29:abc" },
        },
        "2026-09-16T15:04:00.000Z",
      ),
    ).toEqual({
      user_runs: [
        {
          client: "slack",
          user: { id: "U123", actor_id: "slack:U123" },
          recorded_at: recordedAt,
        },
        {
          client: "msteams",
          user: { id: "29:abc", actor_id: "msteams:29:abc" },
          recorded_at: "2026-09-16T15:04:00.000Z",
        },
      ],
    });
  });

  it("no-ops when client or user extras are absent", () => {
    expect(
      persistUserRunsFromPayload({ user_runs: [] }, { message: "hi" }, recordedAt),
    ).toBeUndefined();
    expect(
      persistUserRunsFromPayload(
        {},
        { client: "slack" },
        recordedAt,
      ),
    ).toBeUndefined();
    expect(
      persistUserRunsFromPayload(
        {},
        { user: { id: "U123" } },
        recordedAt,
      ),
    ).toBeUndefined();
  });
});
