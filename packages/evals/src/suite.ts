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

import path from "node:path";

import {
  loadAgentCasesFromFile,
  parseAgentCases,
  type AgentCaseOptions,
} from "@mongodb-js/atlas-agents-eval";
import { createFixtureStore } from "@mongodb-js/atlas-agents-eval";
import { MONGO_CHECKS } from "./mongoChecks/registry.js";
import { RepoEvalCaseSchema } from "./queryInsightsSchemas.js";

/** The mock Atlas accounts and MongoDB seeds in this package's `fixtures/`. */
export const FIXTURES = createFixtureStore({
  dir: path.join(import.meta.dirname, "..", "fixtures"),
});

/** How this package's datasets load: its fixtures, checks and case schema. */
export const CASE_OPTIONS = {
  fixtures: FIXTURES,
  mongoChecks: MONGO_CHECKS,
  schema: RepoEvalCaseSchema,
} satisfies AgentCaseOptions<typeof RepoEvalCaseSchema>;

export const DATASET_DIR = path.join(import.meta.dirname, "..", "datasets");

export function parseCases(yaml: string, label: string) {
  return parseAgentCases(yaml, label, CASE_OPTIONS);
}

export function loadCases(file: string) {
  return loadAgentCasesFromFile(file, CASE_OPTIONS);
}
