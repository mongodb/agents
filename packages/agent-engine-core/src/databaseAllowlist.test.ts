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

import { describe, expect, it, vi } from "vitest";

import { guardAggregateWrite } from "./aggregateWriteApproval.js";
import {
  databaseAllowlistMiddleware,
  guardDatabaseCall,
} from "./databaseAllowlist.js";
import {
  createDatabaseMatcher,
  type DatabaseNamesConfig,
} from "./databaseNames.js";

const interrupt = vi.hoisted(() => vi.fn());

vi.mock("@langchain/langgraph", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@langchain/langgraph")>();
  return { ...actual, interrupt };
});

const allowed = ["orders", /^tenant_\d+$/] satisfies DatabaseNamesConfig;

function call(name: string, args: unknown = {}) {
  return { toolCall: { id: "call-1", name, args } };
}

async function run(
  request: ReturnType<typeof call>,
  databaseNames: DatabaseNamesConfig = allowed,
) {
  const matches = createDatabaseMatcher(databaseNames);
  if (!matches) throw new Error("test needs a restricted databaseNames");
  const handler = vi.fn(async () => "ran");
  const result = await guardDatabaseCall({
    databaseNames,
    matches,
    request,
    handler,
  });
  return { result, ran: handler.mock.calls.length === 1 };
}

describe("guardDatabaseCall", () => {
  it.each([
    ["an allowed name", "mongodb__find", { database: "orders", collection: "c" }],
    ["a name matching a pattern", "mongodb__count", { database: "tenant_42", collection: "c" }],
    ["stringified arguments", "mongodb__list_collections", JSON.stringify({ database: "orders" })],
    ["list_databases without a database", "mongodb__list_databases", {}],
    ["remote_atlas_connect", "mongodb__remote_atlas_connect", { projectId: "p", clusterName: "c" }],
    ["a control plane tool", "mongodb__atlas_list_clusters", { projectId: "p" }],
    ["a MongoDB knowledge tool outside the Atlas MCP", "search_knowledge", { query: "indexes" }],
  ])("runs %s", async (_label, name, args) => {
    expect((await run(call(name, args))).ran).toBe(true);
  });

  it.each([
    ["mongodb__find", { database: "admin", collection: "c" }, "Database admin is not in the databaseNames allowlist. Allowed: orders, names matching the regular expression /^tenant_\\d+$/."],
    ["mongodb__count", { database: "orders_archive", collection: "c" }, "Database orders_archive is not in"],
    ["mongodb__drop_database", { database: "tenant_1_secret" }, "Database tenant_1_secret is not in"],
    ["mongodb__db_stats", { database: "" }, "needs a database"],
    ["mongodb__find", { collection: "c" }, "mongodb__find needs a database"],
    ["mongodb__find", { database: 5 }, "needs a database"],
    ["mongodb__list_collections", "not json", "needs a database"],
  ])("rejects %s with %j", async (name, args, message) => {
    const { result, ran } = await run(call(name, args));
    expect(ran).toBe(false);
    expect(result).toMatchObject({
      type: "tool",
      status: "error",
      name,
      tool_call_id: "call-1",
      content: expect.stringContaining(message),
    });
  });

  it.each([
    ["a leading tab", "\torders"],
    ["a trailing space", "orders "],
    ["a leading space", " orders"],
  ])("rejects a database argument with %s", async (_label, database) => {
    const { result, ran } = await run(
      call("mongodb__find", { database, collection: "c" }),
    );
    expect(ran).toBe(false);
    expect(result).toMatchObject({
      content: expect.stringContaining("not in the databaseNames allowlist"),
    });
  });

  it("rejects every database tool when the list is empty", async () => {
    const { result, ran } = await run(
      call("mongodb__find", { database: "orders", collection: "c" }),
      [],
    );
    expect(ran).toBe(false);
    expect(result).toMatchObject({
      content: "No databases are allowed by databaseNames, so orders cannot be used.",
    });
  });

  describe("$out and $merge targets", () => {
    const aggregate = (pipeline: unknown) =>
      call("mongodb__aggregate", { database: "orders", collection: "c", pipeline });

    it.each([
      ["$out to the same database", [{ $out: "copy" }]],
      ["$out to an allowed database", [{ $out: { db: "tenant_3", coll: "copy" } }]],
      ["$merge into the same database", [{ $merge: { into: "copy" } }]],
      ["$merge into an allowed database", [{ $merge: { into: { db: "orders", coll: "copy" } } }]],
      ["a filter on a field named db", [{ $match: { db: "admin" } }]],
      ["a $lookup", [{ $lookup: { from: "other", localField: "a", foreignField: "b", as: "x" } }]],
      ["a stringified pipeline", JSON.stringify([{ $out: { db: "orders", coll: "copy" } }])],
    ])("runs %s", async (_label, pipeline) => {
      expect((await run(aggregate(pipeline))).ran).toBe(true);
    });

    it.each([
      ["$out", [{ $out: { db: "admin", coll: "copy" } }]],
      ["$merge", [{ $merge: { into: { db: "admin", coll: "copy" } } }]],
      ["a $merge after other stages", [{ $match: {} }, { $merge: { into: { db: "admin", coll: "x" } } }]],
      ["a stringified pipeline", JSON.stringify([{ $out: { db: "admin", coll: "copy" } }])],
      ["a $out inside $unionWith", [{ $unionWith: { coll: "x", pipeline: [{ $out: { db: "admin", coll: "y" } }] } }]],
    ])("rejects %s to a database outside the list", async (_label, pipeline) => {
      const { result, ran } = await run(aggregate(pipeline));
      expect(ran).toBe(false);
      expect(result).toMatchObject({
        content: expect.stringContaining("Database admin is not in the databaseNames allowlist."),
      });
    });

    it("lists every database outside the list in one error", async () => {
      const { result, ran } = await run(
        call("mongodb__aggregate", {
          database: "secret",
          collection: "c",
          pipeline: [
            { $out: { db: "admin", coll: "x" } },
            { $merge: { into: { db: "admin", coll: "y" } } },
          ],
        }),
      );
      expect(ran).toBe(false);
      expect(result).toMatchObject({
        content: expect.stringContaining(
          "Databases secret, admin are not in the databaseNames allowlist.",
        ),
      });
    });

    it("rejects a write destination with surrounding whitespace", async () => {
      const { ran } = await run(
        aggregate([{ $out: { db: "orders ", coll: "copy" } }]),
      );
      expect(ran).toBe(false);
    });

    it("checks aggregate_db and explain the same way", async () => {
      const pipeline = [{ $out: { db: "admin", coll: "copy" } }];
      expect(
        (await run(call("mongodb__aggregate_db", { database: "orders", pipeline }))).ran,
      ).toBe(false);
      expect(
        (
          await run(
            call("mongodb__explain", {
              database: "orders",
              collection: "c",
              method: [{ name: "aggregate", arguments: { pipeline } }],
            }),
          )
        ).ran,
      ).toBe(false);
    });

    it("rejects a pipeline string it cannot parse when it names $out", async () => {
      const { result, ran } = await run(aggregate("[{ $out: { db: 'admin', coll: 'x' } }"));
      expect(ran).toBe(false);
      expect(result).toMatchObject({
        content: expect.stringContaining("could not be parsed"),
      });
    });

    it.each([
      [
        "a find filter holding pipeline JSON text",
        call("mongodb__find", {
          database: "orders",
          collection: "c",
          filter: { note: '[{"$out":{"db":"admin","coll":"copy"}}]' },
        }),
      ],
      [
        "a find filter that mentions $out in plain text",
        call("mongodb__find", {
          database: "orders",
          collection: "c",
          filter: { note: "uses $out and $merge" },
        }),
      ],
      [
        "a stored document that contains a pipeline",
        call("mongodb__insert_many", {
          database: "orders",
          collection: "c",
          documents: [{ pipeline: [{ $out: { db: "admin", coll: "copy" } }] }],
        }),
      ],
      [
        "an explain of a find that holds pipeline JSON text",
        call("mongodb__explain", {
          database: "orders",
          collection: "c",
          method: [
            {
              name: "find",
              arguments: {
                filter: { note: '[{"$out":{"db":"admin","coll":"copy"}}]' },
              },
            },
          ],
        }),
      ],
      [
        "a $match on pipeline JSON text inside an aggregate",
        aggregate([
          { $match: { note: '[{"$out":{"db":"admin","coll":"copy"}}]' } },
        ]),
      ],
    ])("runs %s, since it is data and not a pipeline", async (_label, request) => {
      expect((await run(request)).ran).toBe(true);
    });

    it("rejects arguments nested deeper than 20 levels in a pipeline", async () => {
      const nestedPipeline = (levels: number) => {
        let value: unknown = { ok: true };
        for (let i = 1; i < levels; i++) value = { nested: value };
        return [value];
      };

      expect((await run(aggregate(nestedPipeline(20)))).ran).toBe(true);

      const tooDeep = await run(aggregate(nestedPipeline(21)));
      expect(tooDeep.ran).toBe(false);
      expect(tooDeep.result).toMatchObject({
        content: expect.stringContaining("deeper than 20 levels"),
      });
    });
  });
});

describe("after an approval edit", () => {
  it.each([
    [
      "a disallowed database",
      { database: "admin", collection: "c", pipeline: [{ $out: "copy" }] },
    ],
    [
      "a disallowed $out destination",
      {
        database: "orders",
        collection: "c",
        pipeline: [{ $out: { db: "admin", coll: "copy" } }],
      },
    ],
  ])("rejects an edit to %s", async (_label, editedArgs) => {
    interrupt.mockReturnValue({
      decisions: [
        {
          type: "edit",
          editedAction: { name: "mongodb__aggregate", args: editedArgs },
        },
      ],
    });
    const matches = createDatabaseMatcher(allowed);
    if (!matches) throw new Error("test needs a restricted databaseNames");
    const handler = vi.fn(async () => "ran");
    const original = call("mongodb__aggregate", {
      database: "orders",
      collection: "c",
      pipeline: [{ $out: "copy" }],
    });

    const result = await guardAggregateWrite(original, (edited) =>
      guardDatabaseCall({
        databaseNames: allowed,
        matches,
        request: edited,
        handler,
      }),
    );

    expect(handler).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: "error",
      content: expect.stringContaining("not in the databaseNames allowlist"),
    });
  });
});

describe("databaseAllowlistMiddleware", () => {
  it("accepts omitted and listed names", () => {
    expect(() => databaseAllowlistMiddleware()).not.toThrow();
    expect(() => databaseAllowlistMiddleware([])).not.toThrow();
    expect(() => databaseAllowlistMiddleware(allowed)).not.toThrow();
  });

  it("throws at startup on an invalid entry", () => {
    expect(() => databaseAllowlistMiddleware(["a.b"])).toThrow(/databaseNames/);
  });

  it("lets every call through when omitted", async () => {
    const middleware = databaseAllowlistMiddleware();
    const handler = vi.fn(async () => "ran");
    const request = call("mongodb__find", { database: "admin", collection: "c" });
    // @ts-expect-error: the test passes a minimal tool call request
    await expect(middleware.wrapToolCall?.(request, handler)).resolves.toBe("ran");
    expect(handler).toHaveBeenCalledWith(request);
  });
});
