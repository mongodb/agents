import { MongoMemoryServer } from "mongodb-memory-server-core";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  closeSharedMongoConnection,
  createMongoConnection,
  getSharedMongoConnection,
} from "./mongoConnection.js";

const originalEnvironment = {
  MONGODB_URI: process.env.MONGODB_URI,
  NODE_ENV: process.env.NODE_ENV,
  VERCEL: process.env.VERCEL,
};

describe("Mongo connection provider", () => {
  let server: MongoMemoryServer;

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
  }, 120_000);

  beforeEach(async () => {
    await closeSharedMongoConnection();
    delete process.env.MONGODB_URI;
    process.env.NODE_ENV = "test";
    delete process.env.VERCEL;
  });

  afterAll(async () => {
    await closeSharedMongoConnection();
    await server.stop();
    restoreEnvironment();
  });

  it("connects to an explicit deployment", async () => {
    const connection = await createMongoConnection({
      uri: server.getUri(),
      databaseName: "explicit",
    });

    await expect(
      connection.database.command({ ping: 1 }),
    ).resolves.toMatchObject({ ok: 1 });
    expect(connection.isEmbedded).toBe(false);

    await connection.close();
  });

  it("shares one in-flight close operation among callers", async () => {
    const connection = await createMongoConnection({
      uri: server.getUri(),
      databaseName: "concurrent_close",
    });
    let releaseClose!: () => void;
    const closeGate = new Promise<void>((resolve) => {
      releaseClose = resolve;
    });
    const originalClose = connection.client.close.bind(
      connection.client,
    );
    vi.spyOn(connection.client, "close").mockImplementation(
      async () => {
        await closeGate;
        await originalClose();
      },
    );

    const first = connection.close();
    let secondFinished = false;
    const second = connection.close().then(() => {
      secondFinished = true;
    });
    await Promise.resolve();
    expect(secondFinished).toBe(false);

    releaseClose();
    await Promise.all([first, second]);
  });

  it("caches one connection for warm runtime reuse", async () => {
    const options = {
      uri: server.getUri(),
      databaseName: "shared",
    };

    const [first, second] = await Promise.all([
      getSharedMongoConnection(options),
      getSharedMongoConnection(options),
    ]);

    expect(first).toBe(second);
    expect(first.client).toBe(second.client);
  });

  it("invalidates the shared cache when a caller closes it", async () => {
    const options = {
      uri: server.getUri(),
      databaseName: "shared_close",
    };
    const first = await getSharedMongoConnection(options);

    await first.close();
    const second = await getSharedMongoConnection(options);

    expect(second).not.toBe(first);
    await expect(
      second.database.command({ ping: 1 }),
    ).resolves.toMatchObject({ ok: 1 });
  });

  it("lets centralized shutdown join a direct shared close", async () => {
    const connection = await getSharedMongoConnection({
      uri: server.getUri(),
      databaseName: "shared_concurrent_close",
    });
    let releaseClose!: () => void;
    const closeGate = new Promise<void>((resolve) => {
      releaseClose = resolve;
    });
    const originalClose = connection.client.close.bind(
      connection.client,
    );
    vi.spyOn(connection.client, "close").mockImplementation(
      async () => {
        await closeGate;
        await originalClose();
      },
    );

    const direct = connection.close();
    let shutdownFinished = false;
    const shutdown = closeSharedMongoConnection().then(() => {
      shutdownFinished = true;
    });
    await Promise.resolve();
    expect(shutdownFinished).toBe(false);

    releaseClose();
    await Promise.all([direct, shutdown]);
  });

  it("never returns a shared connection that is already closing", async () => {
    const options = {
      uri: server.getUri(),
      databaseName: "shared_replacement_during_close",
    };
    const closing = await getSharedMongoConnection(options);
    let releaseClose!: () => void;
    const closeGate = new Promise<void>((resolve) => {
      releaseClose = resolve;
    });
    const originalClose = closing.client.close.bind(closing.client);
    vi.spyOn(closing.client, "close").mockImplementation(async () => {
      await closeGate;
      await originalClose();
    });

    const direct = closing.close();
    try {
      const replacement = await getSharedMongoConnection(options);

      expect(replacement).not.toBe(closing);
      await expect(
        replacement.database.command({ ping: 1 }),
      ).resolves.toMatchObject({ ok: 1 });
    } finally {
      releaseClose();
      await direct;
    }
  });

  it("fails fast without a URI unless embedded MongoDB is allowed", async () => {
    await expect(
      createMongoConnection({ databaseName: "missing" }),
    ).rejects.toThrow("MONGODB_URI is required");
  });

  it("starts and stops embedded MongoDB only when explicitly allowed", async () => {
    const connection = await createMongoConnection({
      databaseName: "embedded",
      allowEmbedded: true,
    });

    expect(connection.isEmbedded).toBe(true);
    await expect(
      connection.database.command({ ping: 1 }),
    ).resolves.toMatchObject({ ok: 1 });

    await connection.close();
  });

  it("never starts embedded MongoDB in production", async () => {
    process.env.NODE_ENV = "production";

    await expect(
      createMongoConnection({
        databaseName: "production",
        allowEmbedded: true,
      }),
    ).rejects.toThrow(/development-only/);
  });
});

function restoreEnvironment(): void {
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}
