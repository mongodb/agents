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
 * "enforce" applies the guard: it refuses over-long messages and redacts
 * pasted secrets. "monitor" logs what enforce would do without changing the
 * message. "off" disables the guard.
 */
export type InputGuardMode = "enforce" | "monitor" | "off";

/** The per-agent `inputGuard` block in `config.ts`. */
export interface InputGuardConfig {
  readonly mode: InputGuardMode;
}
