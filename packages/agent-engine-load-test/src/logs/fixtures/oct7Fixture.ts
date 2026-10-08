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
 * Trimmed `agentengine logs --json --all` lines from the Oct 7, 2026
 * two-turn repro on atlas-explorer (session diag-test-1791392694).
 * Times are the platform record timestamps, which are not in order.
 */

export const oct7Ndjson = `
{"timestamp":"2026-10-07T17:04:54.775Z","level":"INFO","logger":"agent_engine_runner_shared.stdio_capture","message":"17:04:54 | INFO     | [runtime-diag] instance=578a2da3 mode=aer mcp_token_cached server=mongodb n=1 fingerprint=597eb3a25b28 expiry=2026-10-07T17:59:25.668Z cache_updated_at=2026-10-07T16:59:25.671Z uptime=335s","service":"agent","fields":{"component":"aer"}}
{"timestamp":"2026-10-07T17:04:55.162Z","level":"INFO","logger":"agent_engine_runner_shared.stdio_capture","message":"17:04:55 | INFO     | [runtime-diag] instance=578a2da3 mode=aer graph_build n=1 uptime=335s","service":"agent","fields":{"component":"aer"}}
{"timestamp":"2026-10-07T17:04:55.359Z","level":"INFO","logger":"agent_engine_runner_shared.stdio_capture","message":"17:04:55 | INFO     | [runtime-diag] instance=578a2da3 mode=aer execution n=1 session=diag-test-1791392694 execution_id=4ce1c874-55bd-4eb0-a15c-7f7a6b21eaf5 uptime=336s","service":"agent","fields":{"component":"aer"}}
{"timestamp":"2026-10-07T17:05:33.151Z","level":"INFO","logger":"agent_engine_runner_shared.stdio_capture","message":"17:05:33 | INFO     | [runtime-diag] instance=523a05df mode=aer process_start pid=612 host=fctr-c342b1199f7e36d0 mcp_token_cache=mongodb:absent","service":"agent","fields":{"component":"aer"}}
{"timestamp":"2026-10-07T17:05:26.791Z","level":"INFO","logger":"agent_engine_runner_shared.stdio_capture","message":"17:05:26 | INFO     | [runtime-diag] instance=488fe528 mode=aer mcp_token_cached server=mongodb n=1 fingerprint=c71e07bb5962 expiry=2026-10-07T17:59:25.641Z cache_updated_at=2026-10-07T16:59:25.643Z uptime=367s","service":"agent","fields":{"component":"aer"}}
{"timestamp":"2026-10-07T17:05:26.871Z","level":"INFO","logger":"agent_engine_runner_shared.stdio_capture","message":"17:05:26 | INFO     | [runtime-diag] instance=488fe528 mode=aer graph_build n=1 uptime=367s","service":"agent","fields":{"component":"aer"}}
{"timestamp":"2026-10-07T17:05:27.252Z","level":"INFO","logger":"agent_engine_runner_shared.stdio_capture","message":"17:05:27 | INFO     | [runtime-diag] instance=488fe528 mode=aer execution n=1 session=diag-test-1791392694 execution_id=33475f48-69fd-4208-98b6-cae48814d908 uptime=367s","service":"agent","fields":{"component":"aer"}}
{"timestamp":"2026-10-07T17:06:08.413Z","level":"INFO","logger":"agent_engine_runner_shared.stdio_capture","message":"17:06:08 | INFO     | [runtime-diag] instance=e5e73ed3 mode=aer process_start pid=613 host=fctr-de3cf9623dfb8e4d mcp_token_cache=mongodb:absent","service":"agent","fields":{"component":"aer"}}
{"timestamp":"2026-10-07T17:04:54.899Z","level":"INFO","logger":"agent_engine_runner_shared.stdio_capture","message":"17:04:54 | INFO     | [runtime-diag] instance=35b8229a mode=tool mcp_token_cached server=mongodb n=1 fingerprint=2f0dc1d102ec expiry=2026-10-07T17:59:26.166Z cache_updated_at=2026-10-07T16:59:26.172Z uptime=335s","service":"tool","fields":{"component":"tool"}}
{"timestamp":"2026-10-07T17:06:04.235Z","level":"INFO","logger":"agent_engine_runner_shared.stdio_capture","message":"17:06:04 | INFO     | [runtime-diag] instance=15a48507 mode=tool process_start pid=615 host=fctr-c1dc30efb2259695 mcp_token_cache=mongodb:absent","service":"tool","fields":{"component":"tool"}}
{"timestamp":"2026-10-07T17:06:06.136Z","level":"INFO","logger":"agent_engine_runner_shared.stdio_capture","message":"17:06:06 | INFO     | [runtime-diag] instance=15a48507 mode=tool graph_build n=1 uptime=8s","service":"tool","fields":{"component":"tool"}}
`.trim();
