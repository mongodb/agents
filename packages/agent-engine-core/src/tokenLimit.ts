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

import { isTokenExhaustionError } from "@repo/agent-engine-chat/token-limit";

export { isTokenExhaustionError };

/**
 * Tells the model that the Atlas MCP access token limit is exhausted.
 *
 * Every Atlas tool shares the same tokens, so retrying or calling another tool
 * cannot succeed. The model should stop and give the user a clear explanation
 * instead of burning turns on failures.
 */
export function formatTokenLimitForAgent(toolName: string): string {
  return (
    `Tool "${toolName}" could not run because the shared Atlas access token ` +
    `limit for this hour has been reached. Retrying, or calling any other ` +
    `Atlas tool, will fail the same way. Do not call more tools. Tell the ` +
    `user that the assistant has reached its hourly access limit and ask ` +
    `them to try again in about an hour.`
  );
}
