import { describe, expect, it } from "vitest";

import { selectTools, writeOperationsAllowed } from "./toolPolicy.js";

const allowlist = new Set(["mongodb__find", "mongodb__aggregate"]);

describe("writeOperationsAllowed", () => {
  it("treats unset, empty, and false values as disabled", () => {
    expect(writeOperationsAllowed({})).toBe(false);
    expect(writeOperationsAllowed({ ALLOW_WRITE_OPERATIONS: "" })).toBe(false);
    expect(writeOperationsAllowed({ ALLOW_WRITE_OPERATIONS: "   " })).toBe(
      false,
    );
    expect(writeOperationsAllowed({ ALLOW_WRITE_OPERATIONS: "false" })).toBe(
      false,
    );
    expect(writeOperationsAllowed({ ALLOW_WRITE_OPERATIONS: " FALSE " })).toBe(
      false,
    );
  });

  it("treats other non-empty values as enabled", () => {
    expect(writeOperationsAllowed({ ALLOW_WRITE_OPERATIONS: "1" })).toBe(true);
    expect(writeOperationsAllowed({ ALLOW_WRITE_OPERATIONS: "true" })).toBe(
      true,
    );
  });
});

describe("selectTools", () => {
  const discovered = [
    { name: "mongodb__find" },
    { name: "mongodb__aggregate" },
    { name: "mongodb__insert_many" },
  ];

  it("keeps only the allowlist when writes are disabled", () => {
    expect(selectTools(discovered, allowlist, false)).toEqual([
      { name: "mongodb__find" },
      { name: "mongodb__aggregate" },
    ]);
  });

  it("keeps every tool when writes are enabled", () => {
    expect(selectTools(discovered, allowlist, true)).toEqual(discovered);
  });
});
