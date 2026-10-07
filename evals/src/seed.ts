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

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { RESULTS_DIR, RIG_DIR } from "./config.ts";
import { parseArgs, timestamp } from "./util.ts";

// The seed runner refuses to write anywhere except the SRV host you name in SEED_EXPECTED_HOST.
// Copy the host from the Atlas connect dialog yourself so a stale or pasted URI cannot hit another cluster.
const SCRIPTS = ["redteam-notes.mongosh.js", "high-impact-additive.mongosh.js", "x7-injected-slow-queries.mongosh.js", "refresh-slow-queries.mongosh.js"];

export function validateSeedTarget(uri: string, expectedHost: string): URL {
  let parsed: URL;
  try { parsed = new URL(uri); } catch { throw new Error("SEED_MONGODB_URI must be a MongoDB SRV connection URI."); }
  if (parsed.protocol !== "mongodb+srv:" || parsed.hostname !== expectedHost) {
    throw new Error(`Seed target must be the SRV hostname set in SEED_EXPECTED_HOST: ${expectedHost}.`);
  }
  return parsed;
}

function redact(text: string, uri: string): string {
  let safe = text.split(uri).join("[seed connection redacted]");
  const password = new URL(uri).password;
  if (password) {
    safe = safe.split(password).join("[redacted]");
    try { safe = safe.split(decodeURIComponent(password)).join("[redacted]"); } catch { /* already redacted */ }
  }
  return safe.replace(/mongodb(?:\+srv)?:\/\/[^\s]+/gi, "[MongoDB URI redacted]");
}

async function runScript(file: string, uri: string): Promise<string> {
  const absolute = path.join(RIG_DIR, "seed", file);
  if (!existsSync(absolute)) throw new Error(`Missing seed script ${file}`);
  // The URI is passed through the child's environment, never command arguments or shell text.
  const code = `db = connect(process.env.SEED_MONGODB_URI); load(${JSON.stringify(absolute)}); void 0;`;
  const child = spawn("mongosh", ["--nodb", "--norc", "--quiet", "--eval", code], {
    env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, SEED_MONGODB_URI: uri },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding("utf8");
    stream.on("data", (chunk: string) => {
      output += chunk;
      process.stdout.write(redact(chunk, uri));
    });
  }
  await new Promise<void>((resolve, reject) => {
    child.on("error", () => reject(new Error("Could not start mongosh; ensure it is installed.")));
    child.on("close", (status) => status === 0 ? resolve() : reject(new Error(`${file} failed (exit ${status}).`)));
  });
  return output;
}

async function main(): Promise<void> {
  const { flags } = parseArgs(process.argv.slice(2));
  if (flags.has("help")) {
    console.log("Usage: node src/seed.ts --dry-run | --check | --apply | --verify | --refresh-slow | --postcheck\nReads SEED_MONGODB_URI from the selected local env file. Target: only the SRV host named in SEED_EXPECTED_HOST.");
    return;
  }
  const apply = flags.has("apply");
  const verify = flags.has("verify");
  const check = flags.has("check");
  const refresh = flags.has("refresh-slow");
  const postcheck = flags.has("postcheck");
  if (!apply && !verify && !check && !refresh && !postcheck) {
    console.log(`Target: the cluster named in SEED_EXPECTED_HOST\nAdditive scripts: ${SCRIPTS.join(", ")}\nNo drops, deletes, profiling changes, or replacement updates. About 690 MB of synthetic documents.\nUse --apply to insert fixtures and run 190 bounded scan queries, then verify/export ground truth.\nRequires SEED_MONGODB_URI and SEED_EXPECTED_HOST, with write access to redteam/highImpact in the local env file.`);
    return;
  }
  const uri = process.env.SEED_MONGODB_URI?.trim();
  const expectedHost = process.env.SEED_EXPECTED_HOST?.trim();
  if (!uri || !expectedHost) throw new Error("Set SEED_MONGODB_URI (a write connection to a disposable test cluster) and SEED_EXPECTED_HOST (its SRV hostname) in evals/.env.");
  validateSeedTarget(uri, expectedHost);
  console.log(`Target verified: ${expectedHost}`);
  await runScript("check-connection.mongosh.js", uri);
  if (check && !apply && !verify && !refresh && !postcheck) return;
  if (postcheck) {
    const output = await runScript("verify-writes.mongosh.js", uri);
    mkdirSync(RESULTS_DIR, { recursive: true });
    writeFileSync(path.join(RESULTS_DIR, `${timestamp()}-seed-postcheck.json`), `${JSON.stringify({
      checkedAt: new Date().toISOString(), host: expectedHost,
      passed: output.includes("No eval writes found."), output: redact(output, uri),
    }, null, 2)}\n`);
    if (!apply && !verify && !refresh) return;
  }
  if (refresh && !apply) await runScript("refresh-slow-queries.mongosh.js", uri);
  if (apply) {
    for (const script of SCRIPTS) {
      console.log(`Running ${script}`);
      await runScript(script, uri);
    }
  }
  const verification = await runScript("verify-seeds.mongosh.js", uri);
  const verificationLine = verification.split("\n").find((line) => line.startsWith("{\"verifiedAt\""));
  if (!verificationLine) throw new Error("Seed verification produced no JSON; do not mark seeds verified.");
  mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(path.join(RESULTS_DIR, `${timestamp()}-seeds.json`), `${JSON.stringify({
    host: expectedHost,
    applied: apply, refreshedSlowQueries: refresh,
    scripts: apply ? SCRIPTS : refresh ? ["refresh-slow-queries.mongosh.js"] : [], fixtures: JSON.parse(verificationLine),
    performanceAdvisorVerified: false,
  }, null, 2)}\n`);
  const truthOutput = await runScript("ground-truth.mongosh.js", uri);
  const truth = JSON.parse(truthOutput.slice(truthOutput.indexOf("{"), truthOutput.lastIndexOf("}") + 1));
  writeFileSync(path.join(RIG_DIR, "ground-truth.json"), `${JSON.stringify(truth, null, 2)}\n`);
  console.log("Fixture verification and ground-truth export complete. Verify Performance Advisor exposes the seeded logs before --verified-seeds Q2,X7.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.join(RIG_DIR, "src", "seed.ts")) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
