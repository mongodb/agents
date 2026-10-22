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
 * `systemPrompt.defaultData` is a prompt hint. Each string may be anything.
 * Leave a field `""` or `undefined` when it is unset. The prompt passes
 * `projectId` and `clusterName` as those arguments, and `databaseName`
 * and `collectionName` as `database` and `collection`. These strings are
 * not checked. A project or cluster outside `dataAccess.projects`, or a
 * database outside `dataAccess.databaseNames`, still fails when the agent
 * uses it.
 *
 * `dataAccess` limits what the agent can reach. Leave it as `{}` for no
 * restriction. Otherwise set either or both of these keys:
 *
 * - `projects` limits clusters. Map each allowed 24-hex project id to `{}`
 *   (all its clusters) or `{ clusterNames: [...] }`. Omit `projects` to allow
 *   every cluster.
 * - `databaseNames` limits the databases the agent may use, across every
 *   allowed cluster. Omit it to allow every database. `[]` allows none.
 *   Otherwise list strings (`"orders"`) and regular expressions
 *   (`/^tenant_\d+$/`).
 *   - A string must equal the database name.
 *   - A regular expression is tested against the name as written, so anchor
 *     it to match the whole name. It can only use the `i` and `u` flags.
 *
 * `dataAccess.databaseNames` is a guardrail in the agent. The hard boundary
 * is the MCP access token, which can't be limited to specific databases
 * today. What `dataAccess.databaseNames` covers:
 *
 * - Checked: each tool call's `database` argument, and the target database of
 *   `$out` and `$merge` in the pipeline of `aggregate`, `aggregate_db`, and
 *   `explain`.
 * - Not checked: other parts of an aggregation pipeline.
 * - Not checked: cluster-level `aggregate_db` stages such as `$currentOp`
 *   and `$queryStats`, which report activity on every database.
 * - Not filtered: tool results, so the agent can still see names of
 *   databases it may not use.
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

import type { AtlasExplorerConfig } from "@repo/atlas-explorer-agent";

export const atlasExplorerConfig = {
  llm: {
    provider: "openai",
    model: "gpt-6-luna",
  },
  systemPrompt: {
    name: "",
    customInstructions: "",
    defaultData: {
      projectId: "",
      clusterName: "",
      databaseName: "",
      collectionName: "",
    },
  },
  dataAccess: {},
  diagnostics: {
    logRuntimeLifecycle: true,
  },
  inputGuard: {
    mode: "enforce",
  },
} as const satisfies AtlasExplorerConfig;
