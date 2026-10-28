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

import { AtlasFixtureSchema } from "./fixtures.js";
import { ORG, PROJECT } from "./testSupport.js";

const project = (clusters: { name: string }[]) => ({
  id: PROJECT,
  name: "prod",
  orgId: ORG,
  clusters,
});

describe("AtlasFixtureSchema", () => {
  it("fills in cluster defaults", () => {
    const { projects } = AtlasFixtureSchema.parse({
      projects: [project([{ name: "c1" }])],
    });

    expect(projects[0].clusters[0]).toMatchObject({
      instanceSize: "M10",
      provider: "AWS",
      region: "US_EAST_1",
      mongoDBVersion: "8.0.4",
      paused: false,
      state: "IDLE",
    });
  });

  it("gives every cluster its own UUID id", () => {
    const { projects } = AtlasFixtureSchema.parse({
      projects: [project([{ name: "c1" }, { name: "c2" }])],
    });
    const [a, b] = projects[0].clusters.map((c) => c.id);

    expect(a).toMatch(/^[0-9a-f-]{36}$/);
    expect(a).not.toBe(b);
  });

  it("keeps an id the fixture sets", () => {
    const { projects } = AtlasFixtureSchema.parse({
      projects: [project([{ name: "c1", id: "fixed" } as { name: string }])],
    });

    expect(projects[0].clusters[0].id).toBe("fixed");
  });

  it("rejects ids that are not 24 lowercase hex characters", () => {
    expect(() =>
      AtlasFixtureSchema.parse({ orgs: [{ id: "ABC", name: "x" }] }),
    ).toThrow(/24 lowercase hex/);
  });

  it("rejects duplicate cluster names in a project", () => {
    expect(() =>
      AtlasFixtureSchema.parse({
        projects: [project([{ name: "c1" }, { name: "c1" }])],
      }),
    ).toThrow(/unique/);
  });

  it("allows the same cluster name in different projects", () => {
    expect(() =>
      AtlasFixtureSchema.parse({
        projects: [
          project([{ name: "c1" }]),
          { ...project([{ name: "c1" }]), id: "7".padEnd(24, "0") },
        ],
      }),
    ).not.toThrow();
  });

  it("rejects cluster names Atlas would not accept", () => {
    expect(() =>
      AtlasFixtureSchema.parse({ projects: [project([{ name: "has space" }])] }),
    ).toThrow();
  });
});
