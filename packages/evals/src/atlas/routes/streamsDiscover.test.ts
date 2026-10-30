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
  baseFixture,
  createTestAtlas,
  OTHER_PROJECT,
  PROJECT,
} from "../testSupport.js";

const workspace = (name: string, extra: object = {}) => ({ name, ...extra });

const fixture = (streams: object) => ({
  ...baseFixture,
  projects: [{ ...baseFixture.projects[0], streams }],
});

const withStreams = () =>
  createTestAtlas(
    fixture({
      workspaces: [
        workspace("w1", {
          connections: [
            {
              name: "events",
              type: "Kafka",
              state: "READY",
              authentication: { password: "x" },
            },
            { name: "sink", type: "Cluster" },
          ],
          processors: [
            { name: "p1", state: "STARTED" },
            { name: "p2", state: "FAILED", tier: "SP30" },
          ],
        }),
        workspace("w2", {
          cloudProvider: "GCP",
          region: "CENTRAL_US",
          tier: "SP30",
        }),
      ],
      privateLinks: [{ _id: "pl-1", provider: "AWS", state: "DONE" }],
      accountDetails: [
        {
          cloudProvider: "AWS",
          regionName: "us-east-1",
          awsAccountId: "1",
          vpcId: "vpc-1",
        },
      ],
    }),
  );

const streams = `/groups/${PROJECT}/streams`;

describe("streams read routes", () => {
  describe("GET /groups/:groupId/streams", () => {
    it("lists the workspaces in the Atlas shape", async () => {
      const res = await withStreams().get(streams);

      expect(res.status).toBe(200);
      expect(res.body.totalCount).toBe(2);
      expect(res.body.results[1]).toMatchObject({
        name: "w2",
        dataProcessRegion: { cloudProvider: "GCP", region: "CENTRAL_US" },
        streamConfig: { tier: "SP30", maxTierSize: "SP50" },
      });
      expect(res.body.results[0]).not.toHaveProperty("connections");
    });

    it("is empty for a project without workspaces", async () => {
      const res = await createTestAtlas().get(streams);

      expect(res.body).toEqual({ results: [], totalCount: 0, links: [] });
    });

    it("pages with pageNum and itemsPerPage", async () => {
      const atlas = withStreams();
      const first = await atlas.get(`${streams}?itemsPerPage=1&pageNum=1`);
      const second = await atlas.get(`${streams}?itemsPerPage=1&pageNum=2`);
      const third = await atlas.get(`${streams}?itemsPerPage=1&pageNum=3`);

      expect(first.body.results.map((w: { name: string }) => w.name)).toEqual([
        "w1",
      ]);
      expect(second.body.results.map((w: { name: string }) => w.name)).toEqual([
        "w2",
      ]);
      expect(third.body.results).toEqual([]);
      expect(third.body.totalCount).toBe(2);
    });

    it("answers 404 for an unknown project", async () => {
      const res = await createTestAtlas().get(
        `/groups/${OTHER_PROJECT}/streams`,
      );

      expect(res.body.errorCode).toBe("GROUP_NOT_FOUND");
    });
  });

  describe("GET /groups/:groupId/streams/:tenantName", () => {
    it("returns one workspace, with connections when asked", async () => {
      const atlas = withStreams();
      const plain = await atlas.get(`${streams}/w1`);
      const full = await atlas.get(`${streams}/w1?includeConnections=true`);

      expect(plain.body.name).toBe("w1");
      expect(plain.body).not.toHaveProperty("connections");
      expect(full.body.connections).toHaveLength(2);
    });

    it("answers 404 STREAM_TENANT_NOT_FOUND for another name", async () => {
      const res = await withStreams().get(`${streams}/nope`);

      expect(res.status).toBe(404);
      expect(res.body.errorCode).toBe("STREAM_TENANT_NOT_FOUND");
    });
  });

  describe("connections", () => {
    it("lists a workspace's connections", async () => {
      const res = await withStreams().get(`${streams}/w1/connections`);

      expect(res.body.results.map((c: { name: string }) => c.name)).toEqual([
        "events",
        "sink",
      ]);
    });

    it("returns one connection with every field the fixture holds", async () => {
      const res = await withStreams().get(`${streams}/w1/connections/events`);

      expect(res.body).toMatchObject({
        name: "events",
        type: "Kafka",
        authentication: { password: "x" },
      });
    });

    it("answers 404 for a connection that does not exist", async () => {
      const res = await withStreams().get(`${streams}/w1/connections/nope`);

      expect(res.body.errorCode).toBe("STREAM_CONNECTION_NOT_FOUND");
    });

    it("answers 404 for the workspace first", async () => {
      const res = await withStreams().get(`${streams}/nope/connections`);

      expect(res.body.errorCode).toBe("STREAM_TENANT_NOT_FOUND");
    });
  });

  describe("processors", () => {
    it("lists a workspace's processors", async () => {
      const res = await withStreams().get(`${streams}/w1/processors`);

      expect(res.body.results).toMatchObject([
        { name: "p1", state: "STARTED", tier: "SP10" },
        { name: "p2", state: "FAILED", tier: "SP30" },
      ]);
    });

    it("returns one processor", async () => {
      const res = await withStreams().get(`${streams}/w1/processor/p2`);

      expect(res.body).toMatchObject({ name: "p2", state: "FAILED" });
    });

    it("answers 404 for a processor that does not exist", async () => {
      const res = await withStreams().get(`${streams}/w1/processor/nope`);

      expect(res.status).toBe(404);
      expect(res.body.errorCode).toBe("STREAM_PROCESSOR_NOT_FOUND");
    });

    it("defaults a processor's state to CREATED", async () => {
      const atlas = createTestAtlas(
        fixture({
          workspaces: [workspace("w", { processors: [{ name: "p" }] })],
        }),
      );
      const res = await atlas.get(`${streams}/w/processor/p`);

      expect(res.body.state).toBe("CREATED");
    });
  });

  describe("networking", () => {
    it("lists PrivateLink connections, not as a workspace named privateLinkConnections", async () => {
      const res = await withStreams().get(`${streams}/privateLinkConnections`);

      expect(res.status).toBe(200);
      expect(res.body.results).toMatchObject([
        { _id: "pl-1", provider: "AWS" },
      ]);
    });

    it("returns account details for a provider and region", async () => {
      const res = await withStreams().get(
        `${streams}/accountDetails?cloudProvider=AWS&regionName=us-east-1`,
      );

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ awsAccountId: "1", vpcId: "vpc-1" });
    });

    it("answers 404 for a region without account details", async () => {
      const res = await withStreams().get(
        `${streams}/accountDetails?cloudProvider=AWS&regionName=eu-west-1`,
      );

      expect(res.status).toBe(404);
      expect(res.body.errorCode).toBe("ACCOUNT_DETAILS_NOT_FOUND");
    });
  });
});
