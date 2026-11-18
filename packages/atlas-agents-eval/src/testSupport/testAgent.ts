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

import path from "node:path";

import {
  buildAtlasExplorerAgentOptions,
  type AtlasExplorerConfig,
} from "@mongodb-js/atlas-explorer-agent";

import type { AgentDefinition } from "../agents/definition.js";

/** The workspace's Atlas Explorer package, for its `skills/`. */
const EXPLORER_PACKAGE_DIR = path.resolve(
  import.meta.dirname,
  "../../../atlas-explorer-agent",
);

const config = {
  llm: { provider: "openai", model: "test-model" },
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
  diagnostics: { logRuntimeLifecycle: false },
  inputGuard: { mode: "enforce" },
} as const satisfies AtlasExplorerConfig;

/**
 * A write-capable agent with no data access limits, for the harness's own
 * tests. It is Atlas Explorer's prompt, tool policy and middleware, so writes
 * pause for approval as they do in a real agent.
 */
export const testAgent: AgentDefinition = {
  name: "test-agent",
  agentDir: EXPLORER_PACKAGE_DIR,
  inputGuardMode: config.inputGuard.mode,
  supportsWrites: true,
  buildOptions({ tools, allowWrites, defaultData, extraInstructions }) {
    const base = config.systemPrompt;
    return buildAtlasExplorerAgentOptions({
      config: {
        ...config,
        systemPrompt: {
          ...base,
          defaultData: defaultData ?? base.defaultData,
          customInstructions: [base.customInstructions, extraInstructions]
            .filter(Boolean)
            .join("\n\n"),
        },
      },
      tools,
      allowWriteOperations: allowWrites,
    });
  },
};

/** {@link testAgent} without writes, like an agent that never offers them. */
export const readOnlyTestAgent: AgentDefinition = {
  ...testAgent,
  name: "read-only-test-agent",
  supportsWrites: false,
  buildOptions: (args) => testAgent.buildOptions({ ...args, allowWrites: false }),
};
