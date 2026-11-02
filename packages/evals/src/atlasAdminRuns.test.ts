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

import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { RecordedRequest } from "./atlas/mockAtlasApi.js";
import { buildEvalCli } from "./cli.js";
import { AtlasFixtureSchema } from "./atlas/fixtures.js";
import { loadAgentCasesFromFile } from "./cases.js";
import { runEvalCliWithMockBraintrust } from "./offline/runEvalCliWithMockBraintrust.js";
import { createLocalToolProvider } from "./tools/localToolProvider.js";
import type { CaseToolsRequest, ToolProvider } from "./tools/types.js";

const cases = loadAgentCasesFromFile(
  path.join(import.meta.dirname, "..", "datasets", "atlas-admin.yml"),
);

const local = createLocalToolProvider();
const atlasRequests: RecordedRequest[] = [];
const readOnlyCaseWrites: RecordedRequest[] = [];

/**
 * Tools look a cluster up as a dedicated cluster first, and fall back to a
 * flex cluster on a 404. That probe is expected for a seeded flex cluster.
 */
function isFlexProbe(r: RecordedRequest, flexNames: string[]): boolean {
  const name = /\/clusters\/([^/?]+)$/.exec(r.url)?.[1];
  return (
    r.method === "GET" &&
    r.status === 404 &&
    name !== undefined &&
    flexNames.includes(name)
  );
}

function seededFlexNames(request: CaseToolsRequest): string[] {
  const seed = request.setup?.mockAtlas;
  if (seed === undefined) return [];
  // The CLI has already replaced the fixture name with its contents.
  return AtlasFixtureSchema.parse(seed).projects.flatMap((project) =>
    project.flexClusters.map((flex) => flex.name),
  );
}

const isWrite = (r: RecordedRequest) => r.method !== "GET";

/** Keeps each case's mock Atlas request log, which is gone once the case ends. */
const provider: ToolProvider = {
  start: () => local.start?.() ?? Promise.resolve(),
  stop: () => local.stop?.() ?? Promise.resolve(),
  async forCase(request: CaseToolsRequest) {
    const caseTools = await local.forCase(request);
    return {
      ...caseTools,
      async dispose() {
        const state = (await caseTools.state()) as {
          atlasRequests: RecordedRequest[];
        };
        const flexNames = seededFlexNames(request);
        atlasRequests.push(
          ...state.atlasRequests.filter((r) => !isFlexProbe(r, flexNames)),
        );
        if (!request.allowWrites) {
          readOnlyCaseWrites.push(...state.atlasRequests.filter(isWrite));
        }
        await caseTools.dispose();
      },
    };
  },
};

beforeAll(async () => {
  await provider.start?.();
});

afterAll(async () => {
  await provider.stop?.();
});

describe("atlas-admin dataset, scripted run", () => {
  it("runs every case through the real tools and the mock Atlas", async () => {
    const { exitCode, braintrust } = await runEvalCliWithMockBraintrust(
      () => buildEvalCli({ toolProvider: provider }),
      [
        "evaluation",
        "run",
        "--task",
        "explorer",
        "--dataset",
        "atlas-admin",
        "--model",
        "scripted",
        "--validate",
        "atlas-admin-explorer",
        "--task-concurrency",
        "2",
        "--trial-count",
        "1",
      ],
    );
    expect(exitCode).toBe(0);

    const perRow = new Map<string, Record<string, number | null>>();
    for (const row of braintrust.rows) {
      if (!row.scores || !row.id) continue;
      perRow.set(row.id, { ...perRow.get(row.id), ...row.scores });
    }
    const byName = new Map<string, number[]>();
    for (const scores of perRow.values()) {
      for (const [name, value] of Object.entries(scores)) {
        if (value === null) continue;
        byName.set(name, [...(byName.get(name) ?? []), value]);
      }
    }

    const expected = (pick: (c: (typeof cases)[number]) => boolean) =>
      cases.filter(pick).length;
    const callsNoTool = (c: (typeof cases)[number]) => {
      const messages = c.expected.outputMessages as { role: string }[] | undefined;
      return messages !== undefined && !messages.some((m) => m.role === "assistant-tool");
    };
    const custom = (c: (typeof cases)[number]) =>
      c.expected.custom as Record<string, unknown> | undefined;
    expect(byName.get("ToolCallCoverage")).toHaveLength(
      expected((c) => c.expected.outputMessages !== undefined && !callsNoTool(c)),
    );
    expect(byName.get("AnswerMatches")).toHaveLength(
      expected((c) => custom(c)?.answerMatches !== undefined),
    );
    expect(byName.get("ToolCallAmountCorrect") ?? []).toHaveLength(
      expected((c) => callsNoTool(c)),
    );
    expect(byName.get("ApprovalRequested") ?? []).toHaveLength(
      expected((c) => custom(c)?.expectApprovalFor !== undefined),
    );
    expect(byName.get("NoForbiddenExecuted") ?? []).toHaveLength(
      expected((c) => custom(c)?.forbiddenExecuted !== undefined),
    );
    for (const [name, scores] of byName) {
      expect(scores.every((s) => s === 1), `${name} is 1 on every case`).toBe(true);
    }

    // Cases without write tools never reach a write route, and each approved
    // case does reach one.
    expect(readOnlyCaseWrites, "writes from read-only cases").toEqual([]);
    const approved = expected(
      (c) =>
        (c.input.custom as Record<string, unknown> | undefined)?.approval ===
        "approve",
    );
    expect(atlasRequests.filter(isWrite).length).toBeGreaterThanOrEqual(approved);

    // A request the mock could not serve is a missing route, which is a bug in
    // the mock and not something the agent did.
    const failed = atlasRequests.filter((r) => r.status >= 400);
    expect(failed, "mock Atlas requests that failed").toEqual([]);
  }, 240_000);
});
