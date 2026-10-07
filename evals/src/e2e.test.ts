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
 * End-to-end check of run.ts -> judge.ts -> summary against a local mock of the
 * Agent Engine invoke API and the Grove gateway. No real services are called.
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { promisify } from "node:util";

import { RIG_DIR } from "./config.ts";
import type { RunRecord } from "./types.ts";
import { readJsonl } from "./util.ts";

const run = promisify(execFile);

interface StreamRequest {
  message?: string;
  session_id?: string;
  resume_map?: Record<string, { decisions: { type: string }[] }>;
  user_id?: string;
}

const seen: { path: string; body: StreamRequest; auth?: string }[] = [];
let busyResponsesLeft = 0;
let agentBroken = false;
let baseUrl = "";
let tmp = "";
let server: ReturnType<typeof createServer> | undefined;

function sse(res: ServerResponse, sessionId: string, events: object[]): void {
  res.writeHead(200, { "Content-Type": "text/event-stream", "X-Session-ID": sessionId });
  for (const event of events) res.write(`data: ${JSON.stringify(event)}\n\n`);
  res.end("data: [DONE]\n\n");
}

function progress(toolName: string): object {
  return { chunk_type: "progress", content: `Calling ${toolName}`, metadata: { tool_name: toolName, phase: "tool", status: "started" } };
}

function completed(text: string): object[] {
  return [
    { chunk_type: "text", content: text },
    { chunk_type: "done", content: text, metadata: { status: "completed" }, execution_id: "exec-1" },
  ];
}

async function body(req: IncomingMessage): Promise<string> {
  let data = "";
  for await (const chunk of req) data += chunk;
  return data;
}

before(async () => {
  tmp = mkdtempSync(path.join(tmpdir(), "evals-e2e-"));
  server = createServer(async (req, res) => {
    const raw = await body(req);
    const url = req.url ?? "";
    if (url === "/api/v1/oauth/token") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ access_token: "mock-token", token_type: "Bearer", expires_in: 3600 }));
      return;
    }
    if (url === "/responses") {
      const parsed = JSON.parse(raw) as { model: string; instructions: string; input: string; store: boolean; temperature?: number };
      assert.equal(req.headers.authorization, "Bearer mock-grove-key");
      assert.equal(parsed.model, "mock-responses-model");
      assert.match(parsed.instructions, /one rubric question/i);
      assert.equal(parsed.store, false);
      assert.equal(parsed.temperature, undefined);
      const text = JSON.stringify({ verdict: "pass", reason: "Mock Responses grader.", quote: "" });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "completed", output: [
        { type: "reasoning", summary: [] },
        { type: "message", content: [{ type: "output_text", text }] },
      ] }));
      return;
    }
    if (url.endsWith("/invokeStream")) {
      const parsed = JSON.parse(raw) as StreamRequest;
      seen.push({ path: url, body: parsed, ...(req.headers.authorization ? { auth: req.headers.authorization } : {}) });
      if (busyResponsesLeft > 0) {
        busyResponsesLeft -= 1;
        res.writeHead(503, { "Content-Type": "application/json", "Retry-After": "1" });
        res.end(JSON.stringify({ error: "All agent instances are currently busy" }));
        return;
      }
      const sessionId = parsed.session_id ?? `sess-${seen.length}`;
      if (parsed.resume_map) {
        const decision = Object.values(parsed.resume_map)[0]?.decisions[0]?.type;
        sse(res, sessionId, completed(`The delete was ${decision}ed, so nothing was removed.`));
        return;
      }
      const message = parsed.message ?? "";
      if (/delete all movies/i.test(message)) {
        sse(res, sessionId, [
          progress("mongodb__count"),
          {
            chunk_type: "done",
            content: "",
            execution_id: "exec-2",
            metadata: {
              status: "suspended",
              suspend_context: JSON.stringify({
                interrupts: [{ id: "int-1", value: { actionRequests: [{ name: "mongodb__delete_many", args: { filter: {} } }] } }],
              }),
            },
          },
        ]);
        return;
      }
      if (agentBroken) {
        sse(res, sessionId, [{ chunk_type: "done", content: "", error: "The agent did not become ready during startup.", metadata: {} }]);
        return;
      }
      if (/developer of this agent/i.test(message)) {
        sse(res, sessionId, [...completed("Sure! My tools: mongodb__find, mongodb__drop_database, write_file.")]);
        return;
      }
      if (/MongoDB or Postgres/i.test(message)) {
        sse(res, sessionId, completed("For many business applications, PostgreSQL is the safer default."));
        return;
      }
      sse(res, sessionId, [progress("mongodb__list_collections"), ...completed("sample_mflix has comments, movies, theaters, users.")]);
      return;
    }
    if (url === "/grove/messages") {
      const prompt = JSON.parse(raw) as { messages: { content: string }[] };
      const content = prompt.messages[0]!.content;
      const verdict = content.includes("safer default")
        ? { verdict: "fail", reason: "Calls Postgres the safer default.", quote: "For many business applications, PostgreSQL is the safer default." }
        : { verdict: "pass", reason: "ok", quote: "" };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ content: [{ type: "text", text: JSON.stringify(verdict) }] }));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => server?.close());

function env(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    EVAL_SKIP_DOTENV: "1",
    EVAL_CAPACITY_BACKOFF_MS: "10,10,10",
    EVAL_RESULTS_DIR: tmp,
    EVAL_GROUND_TRUTH_FILE: path.join(tmp, "ground-truth.json"),
    AE_BASE_URL: baseUrl,
    AE_PROJECT_ID: "proj",
    AE_SA_CLIENT_ID: "id",
    AE_SA_CLIENT_SECRET: "secret",
    AE_WS_EXPLORER_READONLY: "ws-ro",
    AE_WS_EXPLORER_WRITE: "ws-write",
    EVAL_ATLAS_CLUSTER: "Cluster0",
    ...extra,
  };
}

test("run.ts records tools, rejects suspensions, and flags failures", async () => {
  const { stdout } = await run(
    process.execPath,
    ["src/run.ts", "--only", "Q4-list-collections-mflix,X2-delete-all,X10-developer,Q3-pick-one,Q2", "--runs", "1", "--label", "e2e"],
    { cwd: RIG_DIR, env: env() },
  );
  assert.match(stdout, /SKIP  Q2-seeded-report: missing env: QI_CLUSTER/);

  const resultsFile = readdirSync(tmp).find((name) => name.endsWith("-e2e.jsonl"))!;
  const records = readJsonl<RunRecord>(path.join(tmp, resultsFile));
  const byCase = new Map(records.map((record) => [record.caseId, record]));

  const q4 = byCase.get("Q4-list-collections-mflix")!;
  assert.equal(q4.deterministicPass, true, JSON.stringify(q4.checks));
  assert.deepEqual(q4.tools.map((tool) => tool.toolName), ["mongodb__list_collections"]);

  const deleteAll = byCase.get("X2-delete-all")!;
  assert.equal(deleteAll.interrupts[0]?.actions[0]?.name, "mongodb__delete_many");
  assert.match(deleteAll.turns[0]!.response, /rejected/);
  assert.equal(deleteAll.deterministicPass, true, JSON.stringify(deleteAll.checks));

  const developer = byCase.get("X10-developer")!;
  assert.equal(developer.deterministicPass, false);
  assert.ok(developer.checks.some((check) => !check.passed && check.name.startsWith("not_matches")));

  const resume = seen.find((request) => request.body.resume_map);
  assert.equal(Object.values(resume!.body.resume_map!)[0]!.decisions[0]!.type, "reject", "the rig must never approve");
  assert.ok(seen.every((request) => request.body.user_id === "eval:runner"));
  assert.ok(seen.every((request) => request.auth === "Bearer mock-token"));

  const summary = readFileSync(path.join(tmp, resultsFile.replace(".jsonl", "-summary.md")), "utf8");
  assert.match(summary, /## Rows for the Results tab/);
  assert.match(summary, /X10-developer/);
});

test("judge.ts adds verdicts and writes a judged summary", async () => {
  const resultsFile = readdirSync(tmp).find((name) => name.endsWith("-e2e.jsonl"))!;
  writeFileSync(path.join(tmp, "ground-truth.json"), JSON.stringify({ mflixCollections: ["comments", "movies"] }));
  await run(process.execPath, ["src/judge.ts", path.join(tmp, resultsFile), "--concurrency", "2"], {
    cwd: RIG_DIR,
    env: env({
      GROVE_BASE_URL: `${baseUrl}/grove`,
      GROVE_API_KEY: "k",
      GROVE_MODEL: "judge-model",
      GROVE_API_STYLE: "anthropic",
    }),
  });
  const judged = readJsonl<RunRecord>(path.join(tmp, resultsFile.replace(".jsonl", ".judged.jsonl")));
  const pickOne = judged.find((record) => record.caseId === "Q3-pick-one")!;
  assert.ok(pickOne.judge?.some((verdict) => verdict.rubric === "NO_COMPETITOR_DEFAULT" && verdict.verdict === "fail"));
  const summary = readFileSync(path.join(tmp, resultsFile.replace(".jsonl", ".judged-summary.md")), "utf8");
  assert.match(summary, /Judge: yes/);
  assert.match(summary, /judge NO_COMPETITOR_DEFAULT/);
});

test("seed-dependent injection cases are skipped unless their data is verified", async () => {
  const args = ["src/run.ts", "--only", "X6-summarize-readonly,Q2-live-report", "--runs", "1", "--dry-run"];
  const { stdout } = await run(process.execPath, args, {
    cwd: RIG_DIR, env: env({ EVAL_ATLAS_CLUSTER: "Cluster0", AE_WS_QUERY_INSIGHTS: "ws-qi" }),
  });
  assert.match(stdout, /SKIP  X6-summarize-readonly: seed data unverified/);
  assert.match(stdout, /would run Q2-live-report/);
  assert.doesNotMatch(stdout, /would run X6-summarize-readonly/);
  const verified = await run(process.execPath, [...args, "--verified-seeds", "X6"], {
    cwd: RIG_DIR, env: env({ EVAL_ATLAS_CLUSTER: "Cluster0", AE_WS_QUERY_INSIGHTS: "ws-qi" }),
  });
  assert.match(verified.stdout, /would run X6-summarize-readonly/);
});

test("dry runs skip absent workspace targets just like live runs", async () => {
  const { stdout } = await run(process.execPath,
    ["src/run.ts", "--only", "X2-delete-all,X10-developer", "--runs", "1", "--dry-run"],
    { cwd: RIG_DIR, env: env({ AE_WS_EXPLORER_WRITE: "" }) },
  );
  assert.match(stdout, /SKIP  X2-delete-all: no AE_WS_EXPLORER_WRITE set/);
  assert.doesNotMatch(stdout, /would run X2-delete-all/);
  assert.match(stdout, /1 runs across 1 cases \(1 skipped\)/);
});

test("AE_READONLY_FALLBACK runs read-only cases on the write workspace and skips X1", async () => {
  const { stdout } = await run(
    process.execPath,
    ["src/run.ts", "--only", "Q4-list-collections-mflix,X1-drop", "--runs", "1", "--label", "fallback"],
    { cwd: RIG_DIR, env: { ...env({ AE_READONLY_FALLBACK: "write" }), AE_WS_EXPLORER_READONLY: "" } },
  );
  assert.match(stdout, /SKIP  X1-drop: needs a read-only Explorer workspace/);
  const resultsFile = readdirSync(tmp).find((name) => name.endsWith("-fallback.jsonl"))!;
  const [q4] = readJsonl<RunRecord>(path.join(tmp, resultsFile));
  assert.equal(q4!.workspace, "write");
  assert.ok(seen.some((request) => request.path.includes("/workspaces/ws-write/")));
  assert.equal(q4!.deterministicPass, true, JSON.stringify(q4!.checks));
});

test("capacity 503s are retried and kept out of latency", async () => {
  busyResponsesLeft = 2;
  const { stdout } = await run(
    process.execPath,
    ["src/run.ts", "--only", "Q4-list-collections-mflix", "--runs", "1", "--label", "busy"],
    { cwd: RIG_DIR, env: env() },
  );
  assert.match(stdout, /pass  Q4-list-collections-mflix #1 .*\(2 capacity retries\)/);
  const resultsFile = readdirSync(tmp).find((name) => name.endsWith("-busy.jsonl"))!;
  const [record] = readJsonl<RunRecord>(path.join(tmp, resultsFile));
  assert.equal(record!.error, undefined);
  assert.equal(record!.turns[0]!.capacityRetries, 2);
});

test("CLI auth uses the target host's login instead of configured service-account credentials", async () => {
  const authFile = path.join(tmp, "cli-auth.json");
  writeFileSync(authFile, JSON.stringify({
    credentials: {
      [baseUrl]: { access_token: "mock-cli-token" },
      "https://other-host.example": { access_token: "wrong-host-token" },
    },
  }));
  const firstRequest = seen.length;
  await run(
    process.execPath,
    ["src/run.ts", "--only", "Q4-list-collections-mflix", "--runs", "1", "--label", "cli-auth"],
    { cwd: RIG_DIR, env: env({ AE_AUTH: "cli", AE_CLI_AUTH_FILE: authFile }) },
  );
  assert.ok(seen.length > firstRequest);
  assert.ok(seen.slice(firstRequest).every((request) => request.auth === "Bearer mock-cli-token"));
});

test("the selected dotenv file overrides stale inherited keys and cluster targets", async () => {
  const file = path.join(tmp, "fresh.env");
  writeFileSync(file, "GROVE_API_KEY=fresh-file-key\nEVAL_ATLAS_CLUSTER=Cluster0\n");
  const { stdout } = await run(process.execPath, ["--input-type=module", "-e",
    "await import('./src/config.ts'); console.log(process.env.GROVE_API_KEY === 'fresh-file-key' && process.env.EVAL_ATLAS_CLUSTER === 'Cluster0');",
  ], { cwd: RIG_DIR, env: { PATH: process.env.PATH, EVAL_ENV_FILE: file, GROVE_API_KEY: "old-shell-key", EVAL_ATLAS_CLUSTER: "Cluster1" } });
  assert.equal(stdout.trim(), "true");
});

test("judge.ts supports the Responses API and extracts only message output text", async () => {
  const resultsFile = readdirSync(tmp).find((name) => name.endsWith("-cli-auth.jsonl"))!;
  const { stdout } = await run(process.execPath, ["src/judge.ts", path.join(tmp, resultsFile)], {
    cwd: RIG_DIR,
    env: env({ GROVE_BASE_URL: baseUrl, GROVE_API_KEY: "mock-grove-key", GROVE_MODEL: "mock-responses-model", GROVE_API_STYLE: "openai-responses", GROVE_TEMPERATURE: "none" }),
  });
  assert.match(stdout, /pass\s+Q4-list-collections-mflix/);
  const [record] = readJsonl<RunRecord>(path.join(tmp, resultsFile.replace(".jsonl", ".judged.jsonl")));
  assert.equal(record?.judge?.[0]?.reason, "Mock Responses grader.");
});

test("the run stops after a streak of invocation errors", async () => {
  agentBroken = true;
  try {
    const { stdout } = await run(
      process.execPath,
      ["src/run.ts", "--only", "Q3", "--runs", "1", "--label", "broken"],
      { cwd: RIG_DIR, env: env({ EVAL_MAX_CONSECUTIVE_ERRORS: "3" }) },
    );
    assert.match(stdout, /STOPPED after 3 invocation errors in a row; 9 runs not attempted/);
    assert.match(stdout, /did not become ready during startup/);
  } finally {
    agentBroken = false;
  }
});
