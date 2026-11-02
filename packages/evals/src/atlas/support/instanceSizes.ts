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

/** Dedicated instance sizes the mock accepts, `M10` and up. */
export const INSTANCE_SIZE =
  /^M(10|20|30|40|50|60|80|100|140|160|200|300|400|700)$/;

const ORDER = [10, 20, 30, 40, 50, 60, 80, 100, 140, 160, 200, 300, 400, 700];

/** True when `size` is `M30` or larger. */
export function isM30OrLarger(size: string): boolean {
  return ORDER.indexOf(Number(size.slice(1))) >= ORDER.indexOf(30);
}
