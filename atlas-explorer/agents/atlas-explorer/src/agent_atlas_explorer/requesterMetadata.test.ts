import { AIMessage, HumanMessage } from "@langchain/core/messages";
import {
  MemorySaver,
  emptyCheckpoint,
  type BaseCheckpointSaver,
  type Checkpoint,
} from "@langchain/langgraph";
import { MongoDBSaver } from "@langchain/langgraph-checkpoint-mongodb";
import { Binary, MongoClient, type Db } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { stampClientUser } from "./clientUser.js";
import { withRequesterMetadata } from "./requesterMetadata.js";

const ada = {
  id: "U100",
  username: "ada",
  full_name: "Ada Lovelace",
  actor_id: "slack:U100",
};

const grace = {
  id: "U200",
  username: "grace",
  full_name: "Grace Hopper",
  actor_id: "slack:U200",
};

function checkpointWith(channelValues: Record<string, unknown>): Checkpoint {
  return { ...emptyCheckpoint(), channel_values: channelValues };
}

async function putAndRead(
  checkpoint: Checkpoint,
): Promise<Record<string, unknown>> {
  const saver: BaseCheckpointSaver<string | number> = withRequesterMetadata(
    new MemorySaver(),
  );
  const config = { configurable: { thread_id: "thread-1" } };
  await saver.put(config, checkpoint, { source: "loop", step: 1, parents: {} }, {});
  const tuple = await saver.getTuple(config);
  return (tuple?.metadata ?? {}) as unknown as Record<string, unknown>;
}

describe("withRequesterMetadata", () => {
  it("records the newest stamped requester as queryable metadata", async () => {
    const metadata = await putAndRead(
      checkpointWith({
        messages: [
          stampClientUser(
            new HumanMessage({ id: "m1", content: "what can you do" }),
            { client: "slack", user: ada },
          ),
          stampClientUser(
            new HumanMessage({ id: "m2", content: "connect to the cluster" }),
            { client: "slack", user: grace },
          ),
        ],
      }),
    );

    expect(metadata.requester).toEqual({
      client: "slack",
      user: grace,
      message_id: "m2",
      message_type: "human",
    });
  });

  it("keeps the engine-owned metadata fields intact", async () => {
    const metadata = await putAndRead(
      checkpointWith({
        messages: [
          stampClientUser(new HumanMessage({ id: "m1", content: "hi" }), {
            client: "slack",
            user: ada,
          }),
        ],
      }),
    );

    expect(metadata.source).toBe("loop");
    expect(metadata.step).toBe(1);
    expect(metadata.parents).toEqual({});
  });

  it("reads the input checkpoint where messages are still under __start__", async () => {
    const metadata = await putAndRead(
      checkpointWith({
        messages: [],
        __start__: {
          messages: [
            stampClientUser(
              new HumanMessage({ id: "m1", content: "what can you do" }),
              { client: "slack", user: ada },
            ),
          ],
          user_id: "6aa41c21338e53cedff0159c",
        },
      }),
    );

    expect(metadata.requester).toEqual({
      client: "slack",
      user: ada,
      message_id: "m1",
      message_type: "human",
    });
  });

  it("records the approver when a resume stamps the model turn", async () => {
    const metadata = await putAndRead(
      checkpointWith({
        messages: [
          stampClientUser(new HumanMessage({ id: "m1", content: "drop it" }), {
            client: "slack",
            user: ada,
          }),
          stampClientUser(new AIMessage({ id: "m2", content: "approved?" }), {
            client: "slack",
            user: grace,
          }),
        ],
      }),
    );

    expect(metadata.requester).toEqual({
      client: "slack",
      user: grace,
      message_id: "m2",
      message_type: "ai",
    });
  });

  it("omits the requester when no message carries client user extras", async () => {
    const metadata = await putAndRead(
      checkpointWith({
        messages: [new HumanMessage({ id: "m1", content: "hi" })],
      }),
    );

    expect(metadata).not.toHaveProperty("requester");
    expect(metadata.source).toBe("loop");
  });

  it("omits the requester when the stamped extras are malformed", async () => {
    const human = new HumanMessage({ id: "m1", content: "hi" });
    human.additional_kwargs = { client: "slack", user: { username: "ada" } };

    const metadata = await putAndRead(checkpointWith({ messages: [human] }));

    expect(metadata).not.toHaveProperty("requester");
  });
});

const DATABASE_NAME = "atlas_explorer_checkpoint_tests";
const THREAD_ID = "sess-abc123:workspace-xyz";

describe("withRequesterMetadata on the MongoDB checkpointer", () => {
  let server: MongoMemoryServer;
  let client: MongoClient;
  let database: Db;

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    client = new MongoClient(server.getUri());
    await client.connect();
    database = client.db(DATABASE_NAME);
  }, 120_000);

  beforeEach(async () => {
    await database.dropDatabase();
  });

  afterAll(async () => {
    await client?.close();
    await server?.stop();
  });

  function mongoSaver(): BaseCheckpointSaver<string | number> {
    return withRequesterMetadata(
      new MongoDBSaver({ client, dbName: DATABASE_NAME }),
    );
  }

  /** Mirrors a fresh invoke, where the input still sits under `__start__`. */
  async function putStampedInvoke(
    threadId: string,
    user: typeof ada,
  ): Promise<void> {
    await mongoSaver().put(
      { configurable: { thread_id: threadId, checkpoint_ns: "" } },
      checkpointWith({
        messages: [],
        __start__: {
          messages: [
            stampClientUser(
              new HumanMessage({ id: "m1", content: "what can you do" }),
              { client: "slack", user },
            ),
          ],
        },
      }),
      { source: "input", step: -1, parents: {} },
      {},
    );
  }

  it("writes the requester as plain BSON beside the serialized checkpoint", async () => {
    await putStampedInvoke(THREAD_ID, ada);

    const doc = await database
      .collection("checkpoints")
      .findOne({ thread_id: THREAD_ID });

    expect(doc?.metadata_search).toEqual({
      source: "input",
      step: -1,
      parents: {},
      requester: {
        client: "slack",
        user: ada,
        message_id: "m1",
        message_type: "human",
      },
    });
    // The state itself stays an opaque blob; only the projection is queryable.
    expect(doc?.checkpoint).toBeInstanceOf(Binary);
    expect(doc?.type).toBe("json");
  });

  it("finds a thread by requester without decoding any checkpoint", async () => {
    await putStampedInvoke(THREAD_ID, ada);
    await putStampedInvoke("other-session:workspace-xyz", grace);

    const matches = await database
      .collection("checkpoints")
      .find({ "metadata_search.requester.user.actor_id": ada.actor_id })
      .toArray();

    expect(matches.map((doc) => doc.thread_id)).toEqual([THREAD_ID]);
  });

  it("exposes the requester to the checkpointer's own list filter", async () => {
    await putStampedInvoke(THREAD_ID, ada);
    await putStampedInvoke("other-session:workspace-xyz", grace);

    const threadIds: unknown[] = [];
    for await (const tuple of mongoSaver().list(
      { configurable: {} },
      { filter: { "requester.user.username": ada.username } },
    )) {
      threadIds.push(tuple.config.configurable?.["thread_id"]);
    }

    expect(threadIds).toEqual([THREAD_ID]);
  });
});
