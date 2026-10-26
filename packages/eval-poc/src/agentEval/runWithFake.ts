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

import { startFakeBraintrust } from "../fakeBraintrust.js";

const fake = await startFakeBraintrust();
process.env.BRAINTRUST_API_KEY = "fake";
process.env.BRAINTRUST_API_URL = fake.url;
process.env.BRAINTRUST_APP_URL = fake.url;

const { buildCli } = await import("./cli.js");
let code = 0;
try {
  await buildCli().parseAsync();
} catch (e) {
  console.error("CLI failed:", e);
  code = 1;
}
await new Promise((r) => setTimeout(r, 1500));
const names = new Map<string, number>();
for (const r of fake.rows) {
  const n = r.span_attributes?.name ?? r.span_attributes?.type ?? "?";
  names.set(n, (names.get(n) ?? 0) + 1);
}
console.log("\n[fake braintrust] rows uploaded:", fake.rows.length);
console.log("[fake braintrust] span names:", Object.fromEntries(names));
await fake.close();
process.exit(code || process.exitCode || 0);
