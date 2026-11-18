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
import os from "node:os";
import path from "node:path";

import { stringify } from "yaml";

import { createFixtureStore, type FixtureStore } from "../fixtures.js";

/**
 * A fixture store in a fresh temporary directory, holding `atlas/<name>.yml`
 * and `mongo/<name>.yml` for each entry. For the harness's own tests.
 */
export function tempFixtureStore(fixtures: {
  atlas?: Record<string, unknown>;
  mongo?: Record<string, unknown>;
}): FixtureStore & { readonly dir: string; remove(): void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "eval-fixtures-"));
  for (const [kind, entries] of Object.entries(fixtures)) {
    fs.mkdirSync(path.join(dir, kind));
    for (const [name, data] of Object.entries(entries ?? {})) {
      fs.writeFileSync(path.join(dir, kind, `${name}.yml`), stringify(data));
    }
  }
  return {
    ...createFixtureStore({ dir }),
    dir,
    remove: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}
