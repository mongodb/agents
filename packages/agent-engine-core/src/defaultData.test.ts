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
  describeDefaultData,
  type DefaultDataConfig,
} from "./defaultData.js";

const EMPTY: DefaultDataConfig = {
  projectId: "",
  clusterName: "",
  databaseName: "",
  collectionName: "",
};

describe("describeDefaultData", () => {
  it("returns undefined when omitted", () => {
    expect(describeDefaultData()).toBeUndefined();
  });

  it("returns undefined when every field is empty or whitespace", () => {
    expect(describeDefaultData(EMPTY)).toBeUndefined();
    expect(
      describeDefaultData({
        projectId: "  ",
        clusterName: "\n",
        databaseName: "\t",
        collectionName: " \n\t ",
      }),
    ).toBeUndefined();
  });

  it("renders one set field and leaves the others out", () => {
    const text = describeDefaultData({
      ...EMPTY,
      clusterName: "prod orders",
    });

    expect(text).toContain("- clusterName: prod orders");
    expect(text).not.toContain("- projectId:");
    expect(text).not.toContain("- database:");
    expect(text).not.toContain("- collection:");
    expect(text).not.toContain("namespaces:");
  });

  it("copies a non-hex project id and a database name with spaces", () => {
    const text = describeDefaultData({
      ...EMPTY,
      projectId: "not-a-hex",
      databaseName: "orders archive",
    });

    expect(text).toContain("- projectId: not-a-hex");
    expect(text).toContain("- database: orders archive");
    expect(text).not.toContain("- clusterName:");
    expect(text).not.toContain("- collection:");
    expect(text).toContain(
      "A database without a collection is not a namespaces filter.",
    );
    expect(text).toContain(
      "When dataAccess is set, it still rejects a project or cluster outside its list.",
    );
    expect(text).toContain(
      "When databaseNames is set, it still rejects a database outside its list.",
    );
  });

  it("renders all four fields and the namespaces value", () => {
    const text = describeDefaultData({
      projectId: "64a1",
      clusterName: "c 1",
      databaseName: "orders",
      collectionName: "sales",
    });

    expect(text).toContain("- projectId: 64a1");
    expect(text).toContain("- clusterName: c 1");
    expect(text).toContain("- database: orders");
    expect(text).toContain("- collection: sales");
    expect(text).toContain(
      'When calling mongodb__atlas_get_performance_advisor, pass namespaces: ["orders.sales"].',
    );
    expect(text).not.toContain("is not a namespaces filter");
  });
});
