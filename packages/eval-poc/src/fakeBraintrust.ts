import http from "node:http";
import zlib from "node:zlib";

export interface FakeBraintrust {
  url: string;
  requests: { method: string; path: string }[];
  /** Every row uploaded through /logs3, flattened. */
  rows: Record<string, any>[];
  close: () => Promise<void>;
}

/** Minimal in-process stand-in for the Braintrust API, enough for Eval(). */
export async function startFakeBraintrust(): Promise<FakeBraintrust> {
  const requests: FakeBraintrust["requests"] = [];
  const rows: Record<string, any>[] = [];
  let url = "";

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const path = (req.url ?? "").split("?")[0];
      requests.push({ method: req.method ?? "", path });
      let raw: Buffer = Buffer.concat(chunks);
      if (req.headers["content-encoding"] === "gzip") raw = zlib.gunzipSync(raw);
      let body: any = {};
      try {
        body = raw.length ? JSON.parse(raw.toString("utf8")) : {};
      } catch {
        /* non-JSON body */
      }
      const json = (obj: unknown) => {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(obj));
      };
      if (path.endsWith("/api/apikey/login")) {
        return json({
          org_info: [
            { id: "org1", name: "fake-org", api_url: url, proxy_url: url },
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
        for (const r of body.rows ?? []) rows.push(r);
        return json({});
      }
      if (path.endsWith("/experiment-comparison2")) {
        return json({ scores: aggregateScores(rows), metrics: {} });
      }
      return json({});
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address() as { port: number };
  url = `http://127.0.0.1:${addr.port}`;
  return {
    url,
    requests,
    rows,
    close: () => new Promise((r) => server.close(() => r())),
  };
}

/** Average each named score over the rows that carry it (merging by row id). */
function aggregateScores(rows: Record<string, any>[]) {
  const perRow = new Map<string, Record<string, number | null>>();
  for (const r of rows) {
    if (!r.scores) continue;
    const prev = perRow.get(r.id) ?? {};
    perRow.set(r.id, { ...prev, ...r.scores });
  }
  const sums: Record<string, { sum: number; n: number }> = {};
  for (const scores of perRow.values()) {
    for (const [name, v] of Object.entries(scores)) {
      if (typeof v !== "number") continue;
      (sums[name] ??= { sum: 0, n: 0 }).sum += v;
      sums[name].n += 1;
    }
  }
  return Object.fromEntries(
    Object.entries(sums).map(([name, { sum, n }]) => [
      name,
      { name, score: sum / n, diff: 0, improvements: 0, regressions: 0 },
    ]),
  );
}
