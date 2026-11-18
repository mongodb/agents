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

import { Agent, setGlobalDispatcher } from "undici";

/**
 * Makes every `fetch` in this process open a fresh connection per request.
 *
 * Each tool call opens its own MCP session on localhost, so connection reuse
 * saves nothing. It also races: `mongodb-mcp-server` closes idle connections
 * after 5 s, and under CPU load a call can pick a connection the server has
 * just closed and fail with `fetch failed` (`UND_ERR_SOCKET`). `pipelining: 0`
 * turns keep-alive off.
 *
 * Import this module for its side effect.
 */
setGlobalDispatcher(new Agent({ pipelining: 0 }));
