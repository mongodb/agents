import { describe, expect, it } from "vitest";

import { checkFlood } from "./flood.js";

const NOW = new Date("2026-09-15T13:00:30.000Z");

describe("checkFlood", () => {
  it("detects the tenth message within thirty seconds", () => {
    const seenAt = Array.from(
      { length: 9 },
      (_, index) =>
        new Date(NOW.getTime() - (index + 1) * 1_000),
    );

    const result = checkFlood(seenAt, NOW);

    expect(result.isFlood).toBe(true);
    expect(result.seenAt).toHaveLength(10);
  });

  it("does not count messages outside the window", () => {
    const seenAt = [
      new Date(NOW.getTime() - 30_001),
      ...Array.from(
        { length: 8 },
        (_, index) =>
          new Date(NOW.getTime() - (index + 1) * 1_000),
      ),
    ];

    const result = checkFlood(seenAt, NOW);

    expect(result.isFlood).toBe(false);
    expect(result.seenAt).toHaveLength(9);
  });

  it("supports custom thresholds without actor semantics", () => {
    const result = checkFlood(
      [new Date(NOW.getTime() - 500)],
      NOW,
      { count: 2, windowMs: 1_000 },
    );

    expect(result.isFlood).toBe(true);
  });
});
