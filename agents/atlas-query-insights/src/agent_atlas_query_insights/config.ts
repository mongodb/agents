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
} from "@repo/atlas-query-insights-agent";

/**
 * Non-secret Atlas Query Insights settings.
 *
 * Leave `systemPrompt.name` empty to keep "Atlas Query Insights".
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
 * - Checked: each tool call's `database` argument, the target database of
 *   `$out` and `$merge` in the pipeline of `aggregate`, `aggregate_db`, and
 *   `explain`, and `namespaces` in `atlas_get_performance_advisor`.
 * - Not checked: other parts of an aggregation pipeline.
 * - Not filtered: tool results, so the agent can still see names of
 *   databases it may not use.
 *
 * `maxQueryShapes` is how many shapes the report covers.
 *
 * `inputGuard` screens each user message before the model sees it: it redacts
 * pasted secrets and refuses messages that are too long to screen. `mode` is
 * "enforce", "monitor" (log only) or "off". See
 * {@link createInputRedactor} and {@link createInputRefusalMiddleware}.
 */

import type { AtlasQueryInsightsConfig } from "@repo/atlas-query-insights-agent";

export const atlasQueryInsightsConfig = {
  llm: {
    provider: "openai",
    model: "gpt-6.1-sol",
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
  maxQueryShapes: 3,
  inputGuard: {
    mode: "enforce",
  },
} as const satisfies AtlasQueryInsightsConfig;
