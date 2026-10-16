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
 *
 * `diagnostics.logRuntimeLifecycle` logs `[runtime-diag]` lines showing which
 * process serves each execution and when each process caches a new Atlas MCP
 * access token. Token values are never logged.
 *
 * `inputGuard` screens each user message before the model sees it: it redacts
 * pasted secrets and refuses messages that are too long to screen. `mode` is
 * "enforce", "monitor" (log only) or "off".
 */

export const atlasExplorerConfig = {
  llm: {
    provider: "openai",
    model: "gpt-6-luna",
  },
  systemPrompt: {
    name: "",
    customInstructions: "",
  },
  diagnostics: {
    logRuntimeLifecycle: true,
  },
  inputGuard: {
    mode: "enforce",
  },
} as const;
