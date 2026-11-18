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

const withWorkspace = () =>
  createTestAtlas({
    ...baseFixture,
    projects: [
      {
        ...baseFixture.projects[0],
        streams: {
          workspaces: [
            {
              name: "w1",
              tier: "SP10",
              connections: [{ name: "events", type: "Kafka" }],
              processors: [
                { name: "running", state: "STARTED" },
                { name: "idle", state: "STOPPED" },
              ],
            },
          ],
        },
      },
    ],
  });

const streams = `/groups/${PROJECT}/streams`;
const workspaceBody = {
  name: "analytics",
  dataProcessRegion: { cloudProvider: "AWS", region: "VIRGINIA_USA" },
};

describe("streams write routes", () => {
  describe("workspaces", () => {
    it("creates a workspace that the read routes then list", async () => {
      const atlas = withWorkspace();
      const created = await atlas.call("POST", streams, workspaceBody);
      const listed = await atlas.get(streams);

      expect(created.status).toBe(200);
      expect(created.body.name).toBe("analytics");
      expect(listed.body.totalCount).toBe(2);
    });

    it("creates a workspace with a sample connection", async () => {
      const atlas = withWorkspace();
      await atlas.call(
        "POST",
        `${streams}:withSampleConnections`,
        workspaceBody,
      );
      const connections = await atlas.get(`${streams}/analytics/connections`);

      expect(connections.body.results).toMatchObject([
        { name: "sample_stream_solar", type: "Sample" },
      ]);
    });

    it("answers 409 for a name that is taken", async () => {
      const res = await withWorkspace().call("POST", streams, {
        ...workspaceBody,
        name: "w1",
      });

      expect(res.status).toBe(409);
      expect(res.body.errorCode).toBe("STREAM_TENANT_NAME_ALREADY_EXISTS");
    });

    it("answers 400 for a body without a region", async () => {
      const res = await withWorkspace().call("POST", streams, { name: "x" });

      expect(res.status).toBe(400);
    });

    it("changes the tier and deletes", async () => {
      const atlas = withWorkspace();
      const updated = await atlas.patch(`${streams}/w1`, {
        streamConfig: { tier: "SP30" },
      });
      const deleted = await atlas.call("DELETE", `${streams}/w1`);
      const after = await atlas.get(streams);

      expect(updated.body.streamConfig.tier).toBe("SP30");
      expect(deleted.status).toBe(202);
      expect(after.body.totalCount).toBe(0);
    });
  });

  describe("connections", () => {
    it("creates one and keeps the password out of the response", async () => {
      const atlas = withWorkspace();
      const res = await atlas.call("POST", `${streams}/w1/connections`, {
        name: "kafka2",
        type: "Kafka",
        authentication: { mechanism: "PLAIN", username: "u", password: "p" },
      });
      const stored = await atlas.get(`${streams}/w1/connections/kafka2`);

      expect(res.body.authentication).toEqual({
        mechanism: "PLAIN",
        username: "u",
      });
      expect(stored.body).toMatchObject({ name: "kafka2", state: "READY" });
    });

    it("answers 409 for a name that is taken", async () => {
      const res = await withWorkspace().call(
        "POST",
        `${streams}/w1/connections`,
        { name: "events", type: "Kafka" },
      );

      expect(res.status).toBe(409);
    });

    it("updates and deletes", async () => {
      const atlas = withWorkspace();
      const updated = await atlas.patch(`${streams}/w1/connections/events`, {
        bootstrapServers: "b:9092",
      });
      const deleted = await atlas.call(
        "DELETE",
        `${streams}/w1/connections/events`,
      );
      const after = await atlas.get(`${streams}/w1/connections/events`);

      expect(updated.body.bootstrapServers).toBe("b:9092");
      expect(deleted.status).toBe(202);
      expect(after.status).toBe(404);
    });
  });

  describe("processors", () => {
    const pipeline = [{ $source: { connectionName: "events" } }];

    it("creates a processor in CREATED state with the workspace tier", async () => {
      const res = await withWorkspace().call(
        "POST",
        `${streams}/w1/processor`,
        { name: "etl", pipeline },
      );

      expect(res.body).toMatchObject({
        name: "etl",
        state: "CREATED",
        tier: "SP10",
      });
    });

    it("starts and stops a processor", async () => {
      const atlas = withWorkspace();
      const start = await atlas.call(
        "POST",
        `${streams}/w1/processor/idle:start`,
      );
      const started = await atlas.get(`${streams}/w1/processor/idle`);
      const stop = await atlas.call(
        "POST",
        `${streams}/w1/processor/idle:stop`,
      );
      const stopped = await atlas.get(`${streams}/w1/processor/idle`);

      expect(start.status).toBe(202);
      expect(started.body.state).toBe("STARTED");
      expect(stop.status).toBe(202);
      expect(stopped.body.state).toBe("STOPPED");
    });

    it("startWith applies the tier", async () => {
      const atlas = withWorkspace();
      await atlas.call("POST", `${streams}/w1/processor/idle:startWith`, {
        tier: "SP30",
      });
      const res = await atlas.get(`${streams}/w1/processor/idle`);

      expect(res.body).toMatchObject({ state: "STARTED", tier: "SP30" });
    });

    it("answers 409 for the wrong state", async () => {
      const atlas = withWorkspace();
      const start = await atlas.call(
        "POST",
        `${streams}/w1/processor/running:start`,
      );
      const stop = await atlas.call(
        "POST",
        `${streams}/w1/processor/idle:stop`,
      );
      const patch = await atlas.patch(`${streams}/w1/processor/running`, {
        name: "renamed",
      });
      const remove = await atlas.call(
        "DELETE",
        `${streams}/w1/processor/running`,
      );

      expect([start.status, stop.status, patch.status, remove.status]).toEqual([
        409, 409, 409, 409,
      ]);
    });

    it("modifies and deletes a stopped processor", async () => {
      const atlas = withWorkspace();
      const patched = await atlas.patch(`${streams}/w1/processor/idle`, {
        pipeline,
      });
      const deleted = await atlas.call(
        "DELETE",
        `${streams}/w1/processor/idle`,
      );
      const after = await atlas.get(`${streams}/w1/processor/idle`);

      expect(patched.body.pipeline).toEqual(pipeline);
      expect(deleted.status).toBe(202);
      expect(after.status).toBe(404);
    });

    it("answers 404 for an action the mock does not know", async () => {
      const res = await withWorkspace().call(
        "POST",
        `${streams}/w1/processor/idle:pause`,
      );

      expect(res.body.errorCode).toBe("NOT_IMPLEMENTED_IN_MOCK");
    });
  });
});
