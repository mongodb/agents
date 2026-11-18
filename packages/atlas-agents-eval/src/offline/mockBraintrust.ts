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

import http from "node:http";
import zlib from "node:zlib";

type Row = Record<string, unknown> & {
  id?: string;
  scores?: Record<string, number | null>;
  span_attributes?: { name?: string; type?: string };
};

export interface MockBraintrust {
  url: string;
  requests: { method: string; path: string }[];
  /** Every row uploaded through /logs3, flattened. */
  rows: Row[];
  close: () => Promise<void>;
}

/**
 * Minimal in-process stand-in for the Braintrust API, enough for the eval
 * CLI's `Eval()` call. The CLI has no offline mode and needs an API key,
 * so offline and CI smoke runs point it at this server instead.
 */
export async function startMockBraintrust(): Promise<MockBraintrust> {
  const requests: MockBraintrust["requests"] = [];
  const rows: Row[] = [];
  let url = "";

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const path = (req.url ?? "").split("?")[0] ?? "";
      requests.push({ method: req.method ?? "", path });
      let raw: Buffer = Buffer.concat(chunks);
      if (req.headers["content-encoding"] === "gzip") {
        raw = zlib.gunzipSync(raw);
      }
      let body: Record<string, unknown> = {};
      try {
        body = raw.length ? JSON.parse(raw.toString("utf8")) : {};
      } catch {
        // Non-JSON bodies carry nothing the mock needs.
      }
      const json = (obj: unknown) => {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(obj));
      };
      if (path.endsWith("/api/apikey/login")) {
        return json({
          org_info: [
            { id: "org1", name: "mock-org", api_url: url, proxy_url: url },
          ],
        });
      }
      if (path.endsWith("/api/project/register")) {
        return json({ project: { id: "proj1", name: body.project_name } });
      }
      if (path.endsWith("/api/experiment/register")) {
        return json({
          project: { id: "proj1", name: body.project_name },
          experiment: {
            id: "exp1",
            name: body.experiment_name ?? "exp",
            created: new Date().toISOString(),
          },
        });
      }
      if (path.endsWith("/logs3")) {
        for (const row of (body.rows as Row[] | undefined) ?? []) {
          rows.push(row);
        }
        return json({});
      }
      if (path.endsWith("/experiment-comparison2")) {
        return json({ scores: aggregateScores(rows), metrics: {} });
      }
      return json({});
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  url = `http://127.0.0.1:${address.port}`;
  return {
    url,
    requests,
    rows,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

/** Average each named score over the rows that carry it, merged by row id. */
function aggregateScores(rows: Row[]) {
  const perRow = new Map<string, Record<string, number | null>>();
  for (const row of rows) {
    if (!row.scores || !row.id) continue;
    perRow.set(row.id, { ...perRow.get(row.id), ...row.scores });
  }
  const sums: Record<string, { sum: number; n: number }> = {};
  for (const scores of perRow.values()) {
    for (const [name, value] of Object.entries(scores)) {
      if (typeof value !== "number") continue;
      const entry = (sums[name] ??= { sum: 0, n: 0 });
      entry.sum += value;
      entry.n += 1;
    }
  }
  return Object.fromEntries(
    Object.entries(sums).map(([name, { sum, n }]) => [
      name,
      { name, score: sum / n, diff: 0, improvements: 0, regressions: 0 },
    ]),
  );
}
