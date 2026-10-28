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

const FIXTURE_DIR = path.join(import.meta.dirname, "..", "fixtures");

/** Fixture kinds, keyed by the `toolSetup` field that names them. */
const KINDS = {
  mockAtlas: "atlas",
  localMongo: "mongo",
} as const satisfies Record<keyof LocalToolSetup, string>;

export type FixtureField = keyof typeof KINDS;

/** What a case's `input.custom.toolSetup` holds: fixture names, not data. */
export type NamedToolSetup = Partial<Record<FixtureField, string>>;

const cache = new Map<string, unknown>();

function fixtureFile(field: FixtureField, name: string): string {
  return path.join(FIXTURE_DIR, KINDS[field], `${name}.yml`);
}

export function fixtureNames(field: FixtureField): string[] {
  const dir = path.join(FIXTURE_DIR, KINDS[field]);
  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith(".yml"))
    .map((file) => path.basename(file, ".yml"))
    .sort();
}

/** Throws, naming the valid choices, unless the fixture exists. */
export function assertFixtureExists(field: FixtureField, name: string): void {
  if (!/^[a-z0-9-]+$/.test(name) || !fs.existsSync(fixtureFile(field, name))) {
    throw new Error(
      `unknown ${field} fixture "${name}". Available: ${fixtureNames(field).join(", ")}`,
    );
  }
}

/**
 * A fresh copy of a fixture's data. The provider validates it, so a bad
 * fixture fails the case that uses it.
 */
export function loadFixture(field: FixtureField, name: string): unknown {
  assertFixtureExists(field, name);
  const file = fixtureFile(field, name);
  if (!cache.has(file)) {
    cache.set(file, parse(fs.readFileSync(file, "utf8")));
  }
  return structuredClone(cache.get(file));
}

/** Replaces each fixture name in a case's `toolSetup` with its data. */
export function resolveToolSetup(
  setup: NamedToolSetup | undefined,
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};
  for (const field of Object.keys(KINDS) as FixtureField[]) {
    const name = setup?.[field];
    if (name !== undefined) resolved[field] = loadFixture(field, name);
  }
  return resolved;
}
