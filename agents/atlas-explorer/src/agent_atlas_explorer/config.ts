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
 * Leave `dataAccess` empty (`{}`) for unrestricted access across projects and
 * clusters; otherwise map each allowed 24-hex `projectId` to `{}` (all
 * clusters in that project) or `{ clusterNames: [...] }`.
 *
 * `diagnostics.logRuntimeLifecycle` logs `[runtime-diag]` lines showing which
 * process serves each execution and when each process caches a new Atlas MCP
 * access token. Token values are never logged.
 */

import type { DataAccessConfig } from "@repo/atlas-explorer-agent";

export const atlasExplorerConfig = {
  llm: {
    provider: "openai",
    model: "gpt-6-luna",
  },
  systemPrompt: {
    name: "",
    customInstructions: "",
  },
  dataAccess: {} as DataAccessConfig,
  diagnostics: {
    logRuntimeLifecycle: true,
  },
} as const;
