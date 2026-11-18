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

export {
  agentToolName,
  disabledToolsEnv,
  isManagedMcpTool,
  LOCAL_ONLY_MCP_TOOLS,
  MANAGED_MCP_TOOLS,
  serverToolName,
} from "../mcp/managedTools.js";
export {
  inheritedEnv,
  startMcpServer,
  stopProcess,
  type McpServerProcess,
  type StartMcpServerOptions,
} from "../mcp/startMcpServer.js";
export { knowledgeTools } from "./knowledgeTools.js";
export {
  createLocalToolProvider,
  type LocalToolProviderOptions,
} from "./localToolProvider.js";
export { LocalToolSetupSchema, type LocalToolSetup } from "./localToolSetup.js";
export type {
  CaseTools,
  CaseToolsRequest,
  MongoAccess,
  ToolProvider,
} from "./types.js";
export { withNamedFixtures } from "./withNamedFixtures.js";
