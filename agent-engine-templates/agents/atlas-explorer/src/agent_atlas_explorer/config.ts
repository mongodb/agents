/**
 * Non-secret Atlas Explorer settings.
 *
 * Magenta only injects secret env vars, so provider and model live here.
 * Changing `llm.provider` also requires the matching key under
 * `required_secrets` and the provider host under `network.egress` in
 * agent.yaml.
 */

export const atlasExplorerConfig = {
  llm: {
    provider: "openai",
    model: "gpt-6-luna",
  },
} as const;
