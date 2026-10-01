/**
 * Non-secret Query Analysis settings.
 *
 * Leave `systemPrompt.name` empty to keep "Query Analysis".
 * Leave `systemPrompt.customInstructions` empty to skip extra prompt text.
 * Leave `scope.projectId` and `scope.clusterName` empty to let the agent
 * resolve the target. A set field must be a 24-hex project id or an Atlas
 * cluster name. `maxQueryShapes` is how many shapes the report covers.
 */

export const queryAnalysisConfig = {
  llm: {
    provider: "openai",
    model: "gpt-6-luna",
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
