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

// Shared Vitest settings for workspace packages. Each package keeps a
// vitest.config.ts that imports definePackageVitestConfig and passes
// only the settings that differ. Array fields such as include and
// exclude replace the shared values.
//
// This file is .mts so Vite loads it as ESM. The root package.json is
// not "type": "module" because scripts/ still contains CommonJS.

export type PackageVitestOverrides = {
  environment?: "node";
  include?: string[];
  exclude?: string[];
  testTimeout?: number;
  hookTimeout?: number;
  fileParallelism?: boolean;
  sequence?: { concurrent: boolean };
};

const sharedTest = {
  environment: "node" as const,
  include: ["src/**/*.test.ts"],
};

export function definePackageVitestConfig(
  overrides: PackageVitestOverrides = {},
) {
  return {
    test: {
      ...sharedTest,
      ...overrides,
    },
  };
}
