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
