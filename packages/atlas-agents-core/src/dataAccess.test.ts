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
  type DataAccessConfig,
} from "./dataAccess.js";

const PROJECT = "64a1f3c2e8b94d0012c7a5e1";
const OPEN_PROJECT = "65c3d9e07f21ab4408d6e3f2";
const OTHER_PROJECT = "66e7b4a1c5d38f2290a1b7c4";

const PROJECT_LIST_NOTE =
  "Project lists in tool results can include projects not listed above. Using one returns an error.";
const CLUSTER_LIST_NOTE =
  "Cluster lists in tool results can include clusters not listed above. Using one returns an error.";

describe("isUnrestricted", () => {
  it("is true when no project is listed", () => {
    expect(isUnrestricted()).toBe(true);
    expect(isUnrestricted({})).toBe(true);
    expect(isUnrestricted({ projects: {} })).toBe(true);
  });

  it("is false when a project is listed", () => {
    expect(isUnrestricted({ projects: { [PROJECT]: {} } })).toBe(false);
  });

  it("ignores databaseNames, which never restricts clusters", () => {
    expect(isUnrestricted({ databaseNames: ["orders"] })).toBe(true);
  });
});

describe("validateDataAccess", () => {
  it("accepts omitted, empty, and listed clusterNames", () => {
    expect(() =>
      validateDataAccess({
        projects: {
          [PROJECT]: { clusterNames: ["example-test"] },
          [OPEN_PROJECT]: {},
          [OTHER_PROJECT]: { clusterNames: [] },
        },
      }),
    ).not.toThrow();
  });

  it("rejects ids and names Atlas would not accept", () => {
    expect(() => validateDataAccess({ projects: { cluster0: {} } })).toThrow(
      /projectId/,
    );
    expect(() =>
      validateDataAccess({ projects: { [PROJECT]: { clusterNames: ["-leading"] } } }),
    ).toThrow(/clusterName/);
  });

  it("validates databaseNames", () => {
    expect(() =>
      validateDataAccess({ databaseNames: ["orders", /^tenant_\d+$/] }),
    ).not.toThrow();
    expect(() => validateDataAccess({ databaseNames: ["a.b"] })).toThrow(
      /databaseNames entries/,
    );
  });

  it("rejects keys other than projects and databaseNames", () => {
    expect(() =>
      validateDataAccess({ [PROJECT]: {} } as DataAccessConfig),
    ).toThrow(/dataAccess accepts only projects and databaseNames/);
  });
});

describe("describeDataAccess", () => {
  it("returns undefined when no project is listed", () => {
    expect(describeDataAccess({})).toBeUndefined();
    expect(describeDataAccess({ databaseNames: ["orders"] })).toBeUndefined();
  });

  it("lists each project with its allowed clusters", () => {
    expect(
      describeDataAccess({
        projects: {
          [PROJECT]: { clusterNames: ["example-test", "example-staging"] },
          [OPEN_PROJECT]: {},
          [OTHER_PROJECT]: { clusterNames: [] },
        },
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
    const open = describeDataAccess({ projects: { [OPEN_PROJECT]: {} } });
    expect(open).toContain(PROJECT_LIST_NOTE);
    expect(open).not.toContain(CLUSTER_LIST_NOTE);

    expect(
      describeDataAccess({ projects: { [PROJECT]: { clusterNames: [] } } }),
    ).toContain(CLUSTER_LIST_NOTE);
  });
});
