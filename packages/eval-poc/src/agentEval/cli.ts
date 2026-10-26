import path from "node:path";
import fs from "node:fs";
import { createMongoDbAssistantEvalCli } from "mongodb-assistant-eval/cli";
import { getConversationEvalCasesFromYaml } from "mongodb-assistant-eval/datasets";
import { makeValidateMinimums } from "mongodb-assistant-eval/validators";
import { AgentEvalCaseSchema } from "./schemas.js";
import { scorers } from "./scorers.js";
import { makeAgentTask, type ModelConfig } from "./task.js";

const dir = path.join(import.meta.dirname, "datasets");
const yamlDataset = (file: string, description: string) => ({
  description,
  getCases: async () =>
    getConversationEvalCasesFromYaml({
      yaml: fs.readFileSync(path.join(dir, file), "utf8"),
      schema: AgentEvalCaseSchema,
    }) as never[],
});

export function buildCli() {
  return createMongoDbAssistantEvalCli({
    projectName: "agents-evals-poc",
    datasets: {
      "explorer-smoke": yamlDataset("explorer-smoke.yml", "Atlas Explorer smoke"),
      "qi-smoke": yamlDataset("qi-smoke.yml", "Atlas Query Insights smoke"),
    },
    models: {
      scripted: { description: "Deterministic, no key", config: { kind: "scripted" } },
      "gpt-6-luna": {
        description: "Same model the agents run in production",
        config: { kind: "llm", provider: "openai", model: "gpt-6-luna" },
      },
    } satisfies Record<string, { description: string; config: ModelConfig }>,
    tasks: {
      explorer: makeAgentTask("atlas-explorer"),
      "query-insights": makeAgentTask("atlas-query-insights"),
    },
    scorers,
    // A threshold on a score a dataset never emits counts as "missing" and
    // fails, so keep one validator per task.
    validators: {
      "smoke-explorer": makeValidateMinimums({
        scoreThresholds: {
          ToolCallCoverage: 1,
          EndStateTier: 1,
          NoForbiddenExecuted: 1,
          ApprovalRequested: 1,
          NoForbiddenText: 1,
          AnswerMatches: 1,
        },
      }),
      "smoke-qi": makeValidateMinimums({
        scoreThresholds: { ToolCallCoverage: 1, AnswerMatches: 1 },
      }),
    },
  } as never);
}
