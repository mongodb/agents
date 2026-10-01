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
} as const;
