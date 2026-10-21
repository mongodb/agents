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

import {
  describeDataAccess,
  isUnrestricted,
  validateDataAccess,
} from "./dataAccess.js";

const PROJECT = "64a1f3c2e8b94d0012c7a5e1";
const OPEN_PROJECT = "65c3d9e07f21ab4408d6e3f2";
const OTHER_PROJECT = "66e7b4a1c5d38f2290a1b7c4";

const PROJECT_LIST_NOTE =
  "Project lists in tool results can include projects not listed above. Using one returns an error.";
const CLUSTER_LIST_NOTE =
  "Cluster lists in tool results can include clusters not listed above. Using one returns an error.";

describe("isUnrestricted", () => {
  it("is true only for an omitted or empty map", () => {
    expect(isUnrestricted()).toBe(true);
    expect(isUnrestricted({})).toBe(true);
    expect(isUnrestricted({ [PROJECT]: {} })).toBe(false);
  });
});

describe("validateDataAccess", () => {
  it("accepts omitted, empty, and listed clusterNames", () => {
    expect(() =>
      validateDataAccess({
        [PROJECT]: { clusterNames: ["example-test"] },
        [OPEN_PROJECT]: {},
        [OTHER_PROJECT]: { clusterNames: [] },
      }),
    ).not.toThrow();
  });

  it("rejects ids and names Atlas would not accept", () => {
    expect(() => validateDataAccess({ cluster0: {} })).toThrow(/projectId/);
    expect(() =>
      validateDataAccess({ [PROJECT]: { clusterNames: ["-leading"] } }),
    ).toThrow(/clusterName/);
  });
});

describe("describeDataAccess", () => {
  it("returns undefined when unrestricted", () => {
    expect(describeDataAccess({})).toBeUndefined();
  });

  it("lists each project with its allowed clusters", () => {
    expect(
      describeDataAccess({
        [PROJECT]: { clusterNames: ["example-test", "example-staging"] },
        [OPEN_PROJECT]: {},
        [OTHER_PROJECT]: { clusterNames: [] },
      }),
    ).toBe(
      [
        "Access is limited to these Atlas projects and clusters. Do not use any other project or cluster:",
        `- Project ${PROJECT}: clusters example-test, example-staging`,
        `- Project ${OPEN_PROJECT}: all clusters`,
        `- Project ${OTHER_PROJECT}: no clusters allowed`,
        "",
        PROJECT_LIST_NOTE,
        CLUSTER_LIST_NOTE,
      ].join("\n"),
    );
  });

  it("adds the cluster note only when a project limits its clusters", () => {
    const open = describeDataAccess({ [OPEN_PROJECT]: {} });
    expect(open).toContain(PROJECT_LIST_NOTE);
    expect(open).not.toContain(CLUSTER_LIST_NOTE);

    expect(
      describeDataAccess({ [PROJECT]: { clusterNames: [] } }),
    ).toContain(CLUSTER_LIST_NOTE);
  });
});
