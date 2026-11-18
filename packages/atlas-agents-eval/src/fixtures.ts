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

import fs from "node:fs";
import path from "node:path";

import { parse } from "yaml";

import type { LocalToolSetup } from "./tools/localToolSetup.js";

/** Fixture kinds, keyed by the `toolSetup` field that names them. */
const KINDS = {
  mockAtlas: "atlas",
  localMongo: "mongo",
} as const satisfies Record<keyof LocalToolSetup, string>;

export type FixtureField = keyof typeof KINDS;

/** What a case's `input.custom.toolSetup` holds: fixture names, not data. */
export type NamedToolSetup = Partial<Record<FixtureField, string>>;

/** The fixtures a suite's cases can name, read from one directory. */
export interface FixtureStore {
  names(field: FixtureField): string[];
  /** Throws, naming the valid choices, unless the fixture exists. */
  assertExists(field: FixtureField, name: string): void;
  /**
   * A fresh copy of a fixture's data. The provider validates it, so a bad
   * fixture fails the case that uses it.
   */
  load(field: FixtureField, name: string): unknown;
  /** Replaces each fixture name in a case's `toolSetup` with its data. */
  resolveToolSetup(setup: NamedToolSetup | undefined): Record<string, unknown>;
}

export interface FixtureStoreOptions {
  /** Holds `atlas/<name>.yml` mock Atlas accounts and `mongo/<name>.yml` seeds. */
  readonly dir: string;
}

export function createFixtureStore({ dir }: FixtureStoreOptions): FixtureStore {
  const cache = new Map<string, unknown>();

  const fixtureFile = (field: FixtureField, name: string) =>
    path.join(dir, KINDS[field], `${name}.yml`);

  const names = (field: FixtureField) => {
    const kindDir = path.join(dir, KINDS[field]);
    if (!fs.existsSync(kindDir)) return [];
    return fs
      .readdirSync(kindDir)
      .filter((file) => file.endsWith(".yml"))
      .map((file) => path.basename(file, ".yml"))
      .sort();
  };

  const assertExists = (field: FixtureField, name: string) => {
    if (!/^[a-z0-9-]+$/.test(name) || !fs.existsSync(fixtureFile(field, name))) {
      throw new Error(
        `unknown ${field} fixture "${name}". Available: ${names(field).join(", ")}`,
      );
    }
  };

  const load = (field: FixtureField, name: string) => {
    assertExists(field, name);
    const file = fixtureFile(field, name);
    if (!cache.has(file)) {
      cache.set(file, parse(fs.readFileSync(file, "utf8")));
    }
    return structuredClone(cache.get(file));
  };

  return {
    names,
    assertExists,
    load,
    resolveToolSetup(setup) {
      const resolved: Record<string, unknown> = {};
      for (const field of Object.keys(KINDS) as FixtureField[]) {
        const name = setup?.[field];
        if (name !== undefined) resolved[field] = load(field, name);
      }
      return resolved;
    },
  };
}
