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

import { describe, expect, it } from "vitest";

import { baseFixture, createTestAtlas, PROJECT } from "../testSupport.js";

const slowQuery = { namespace: "a.b", line: "slow" };
const otherQuery = { namespace: "a.c", line: "other" };

const fixture = {
  ...baseFixture,
  projects: [
    {
      ...baseFixture.projects[0],
      clusters: [
        { name: "c1", advisor: { slowQueries: [slowQuery] } },
        { name: "c2", hosts: ["db-a:27017", "db-b:27017"] },
      ],
    },
  ],
};

const logs = (processId: string) =>
  `/groups/${PROJECT}/processes/${encodeURIComponent(processId)}/performanceAdvisor/slowQueryLogs`;

describe("GET .../processes/:processId/performanceAdvisor/slowQueryLogs", () => {
  it("reports the slow queries from the first node only", async () => {
    const atlas = createTestAtlas(fixture);
    const nodes = [0, 1, 2].map(
      (n) => `c1-shard-00-0${n}.mock.mongodb.net:27017`,
    );
    const counts = await Promise.all(
      nodes.map(
        async (node) => (await atlas.get(logs(node))).body.slowQueries.length,
      ),
    );

    expect(counts).toEqual([1, 0, 0]);
  });

  describe("namespaces filter", () => {
    const mixed = {
      ...baseFixture,
      projects: [
        {
          ...baseFixture.projects[0],
          clusters: [
            {
              name: "c1",
              advisor: { slowQueries: [slowQuery, otherQuery] },
            },
          ],
        },
      ],
    };
    const first = "c1-shard-00-00.mock.mongodb.net:27017";

    it("returns every slow query when no namespace is given", async () => {
      const res = await createTestAtlas(mixed).get(logs(first));

      expect(res.body.slowQueries).toEqual([slowQuery, otherQuery]);
    });

    it("keeps only the requested namespaces", async () => {
      const atlas = createTestAtlas(mixed);

      expect(
        (await atlas.get(`${logs(first)}?namespaces=a.c`)).body.slowQueries,
      ).toEqual([otherQuery]);
      expect(
        (await atlas.get(`${logs(first)}?namespaces=a.b&namespaces=a.c`)).body
          .slowQueries,
      ).toEqual([slowQuery, otherQuery]);
      expect(
        (await atlas.get(`${logs(first)}?namespaces=a.b,a.c`)).body.slowQueries,
      ).toEqual([slowQuery, otherQuery]);
      expect(
        (await atlas.get(`${logs(first)}?namespaces=x.y`)).body.slowQueries,
      ).toEqual([]);
    });
  });

  it("finds a node by an explicitly seeded host", async () => {
    const res = await createTestAtlas(fixture).get(logs("db-b:27017"));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ slowQueries: [] });
  });

  it("answers 404 PROCESS_NOT_FOUND for an unknown host", async () => {
    const res = await createTestAtlas(fixture).get(logs("nowhere:27017"));

    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: 404,
      errorCode: "PROCESS_NOT_FOUND",
      detail: "No process nowhere:27017",
    });
  });
});
