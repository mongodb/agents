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

import type {
  createInputRedactor,
  createInputRefusalMiddleware,
} from "@repo/atlas-explorer-agent";

/**
 * Non-secret Atlas Explorer settings.
 *
 * Agent Engine only injects secret env vars, so provider, model, and prompt
 * persona live here. Changing `llm.provider` also requires the matching
 * key under `required_secrets` and the provider host under
 * `network.egress` in agent.yaml.
 *
 * Leave `systemPrompt.name` empty to keep the default "Atlas Explorer".
 * Leave `systemPrompt.customInstructions` empty to skip extra prompt text.
 * Leave `dataAccess` as `{}` for every project and cluster the MCP
 * configuration can reach. Otherwise map each allowed 24-hex project id to
 * `{}` (all its clusters) or `{ clusterNames: [...] }`.
 *
 * `databaseNames` limits the databases the agent may use, across every
 * allowed cluster. Leave it `undefined` to allow every database, or list
 * names (`"orders"`) and regular expressions (`/^tenant_\d+$/`). A name must
 * match exactly and a regular expression must match the whole name. `[]`
 * allows no databases. Only the `i` and `u` regular expression flags work.
 * Each tool call's `database` argument and the target database of `$out` and
 * `$merge` are checked. Other parts of an aggregation pipeline are not.
 * `$lookup` and `$unionWith` read only from the same database in current
 * MongoDB versions, but if a future version allows cross-database reads,
 * this check will not catch them. `aggregate_db` stages such as `$currentOp`
 * and `$queryStats` report activity on every database. Tool results are not
 * filtered, so the agent can still see names of databases it may not use.
 * Treat this as a guardrail on the agent, not a security boundary, and use
 * Atlas roles and database users for hard limits.
 *
 * `diagnostics.logRuntimeLifecycle` logs `[runtime-diag]` lines showing which
 * process serves each execution and when each process caches a new Atlas MCP
 * access token. Token values are never logged.
 *
 * `inputGuard` screens each user message before the model sees it: it redacts
 * pasted secrets and refuses messages that are too long to screen. `mode` is
 * "enforce", "monitor" (log only) or "off". See
 * {@link createInputRedactor} and {@link createInputRefusalMiddleware}.
 */

import type {
  DataAccessConfig,
  DatabaseNamesConfig,
} from "@repo/atlas-explorer-agent";

export const atlasExplorerConfig = {
  llm: {
    provider: "openai",
    model: "gpt-6-luna",
  },
  systemPrompt: {
    name: "",
    customInstructions: "",
  },
  dataAccess: {} satisfies DataAccessConfig,
  databaseNames: undefined satisfies DatabaseNamesConfig | undefined,
  diagnostics: {
    logRuntimeLifecycle: true,
  },
  inputGuard: {
    mode: "enforce",
  },
} as const;
