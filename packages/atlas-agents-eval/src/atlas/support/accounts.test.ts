/**
 * Copyright 2026 MongoDB, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { describe, expect, it } from "vitest";

import { AccountRegistry } from "./accounts.js";
import { baseFixture, ORG } from "../testSupport.js";

describe("AccountRegistry", () => {
  it("finds a registered account by client id", () => {
    const registry = new AccountRegistry();
    registry.register("a", baseFixture);

    expect(registry.find("a")?.fixture.orgs).toHaveLength(1);
    expect(registry.find("b")).toBeUndefined();
  });

  it("refuses a duplicate client id", () => {
    const registry = new AccountRegistry();
    registry.register("a", baseFixture);

    expect(() => registry.register("a", baseFixture)).toThrow(/already exists/);
  });

  it("refuses a malformed fixture", () => {
    const registry = new AccountRegistry();

    expect(() =>
      registry.register("bad", {
        projects: [{ id: "short", name: "x", orgId: ORG }],
      }),
    ).toThrow(/24 lowercase hex/);
  });

  it("forgets a released account and allows the id again", () => {
    const registry = new AccountRegistry();
    registry.register("a", baseFixture).release();

    expect(registry.find("a")).toBeUndefined();
    expect(() => registry.register("a", baseFixture)).not.toThrow();
  });

  it("keeps a reused id registered when a stale handle releases again", () => {
    const registry = new AccountRegistry();
    const first = registry.register("a", baseFixture);
    first.release();
    registry.register("a", baseFixture);
    first.release();

    expect(registry.find("a")).toBeDefined();
  });

  it("gives each account its own copy of the data", () => {
    const registry = new AccountRegistry();
    const a = registry.register("a", baseFixture);
    const b = registry.register("b", baseFixture);
    registry.find("a")!.fixture.projects[0].clusters[0].paused = true;

    expect(a.state().projects[0].clusters[0].paused).toBe(true);
    expect(b.state().projects[0].clusters[0].paused).toBe(false);
  });

  it("returns state that cannot change the account", () => {
    const registry = new AccountRegistry();
    const account = registry.register("a", baseFixture);
    account.state().projects[0].clusters[0].paused = true;

    expect(account.state().projects[0].clusters[0].paused).toBe(false);
  });
});
