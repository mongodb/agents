/**
 * Non-secret Atlas Query Insights settings.
 *
 * Leave `systemPrompt.name` empty to keep "Atlas Query Insights".
 * Leave `systemPrompt.customInstructions` empty to skip extra prompt text.
 * Leave `scope.projectId` and `scope.clusterName` empty to let the agent
 * resolve the target. A set field must be a 24-hex project id or an Atlas
 * cluster name. `maxQueryShapes` is how many shapes the report covers.
 */

export const atlasQueryInsightsConfig = {
  llm: {
    provider: "openai",
    model: "gpt-6.1-sol",
  },
  systemPrompt: {
    name: "",
    customInstructions: "",
  },
  scope: {
    projectId: "",
    clusterName: "",
  },
  maxQueryShapes: 3,
} as const;
