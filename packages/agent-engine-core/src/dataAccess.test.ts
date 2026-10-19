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

import { describeDataAccess, resolveDataAccess } from "./dataAccess.js";

const PROJECT = "648c61425116351907dba2db";
const OTHER_PROJECT = "6a982c0522ab3c3c953c5ead";

describe("resolveDataAccess", () => {
  it("treats an omitted or empty map as unrestricted", () => {
    expect(resolveDataAccess()).toBeUndefined();
    expect(resolveDataAccess({})).toBeUndefined();
  });

  it("keeps omitted, empty, and listed clusterNames distinct", () => {
    expect(
      resolveDataAccess({
        [` ${PROJECT} `]: {
          clusterNames: [" docs-chatbot-test ", "docs-chatbot-test"],
        },
        [OTHER_PROJECT]: {},
      }),
    ).toEqual({
      [PROJECT]: { clusterNames: ["docs-chatbot-test"] },
      [OTHER_PROJECT]: {},
    });
    expect(resolveDataAccess({ [PROJECT]: { clusterNames: [] } })).toEqual({
      [PROJECT]: { clusterNames: [] },
    });
  });

  it("rejects ids and names Atlas would not accept", () => {
    expect(() => resolveDataAccess({ cluster0: {} })).toThrow(/projectId/);
    expect(() =>
      resolveDataAccess({ [PROJECT]: { clusterNames: ["-leading"] } }),
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
        [PROJECT]: { clusterNames: ["docs-chatbot-test", "docs-chatbot-staging"] },
        [OTHER_PROJECT]: {},
        "507f1f77bcf86cd799439011": { clusterNames: [] },
      }),
    ).toBe(
      [
        "Access is limited to these Atlas projects and clusters. Do not use any other project or cluster:",
        `- Project ${PROJECT}: clusters docs-chatbot-test, docs-chatbot-staging`,
        `- Project ${OTHER_PROJECT}: all clusters`,
        "- Project 507f1f77bcf86cd799439011: no clusters allowed",
      ].join("\n"),
    );
  });
});
