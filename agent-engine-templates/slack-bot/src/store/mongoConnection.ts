import {
  type Db,
  MongoClient,
} from "mongodb";
import type { MongoMemoryServer } from "mongodb-memory-server-core";

const EMBEDDED_MONGO_PACKAGE = "mongodb-memory-server-core";

export interface MongoConnectionOptions {
  allowEmbedded?: boolean;
  databaseName: string;
  uri?: string;
}

export interface MongoConnection {
  client: MongoClient;
  close(): Promise<void>;
  database: Db;
  isEmbedded: boolean;
}

let sharedConnection:
  | {
      key: string;
      promise: Promise<MongoConnection>;
    }
  | undefined;
const sharedCloseOperations = new Set<Promise<void>>();

export async function createMongoConnection(
  options: MongoConnectionOptions,
): Promise<MongoConnection> {
  const uri = options.uri ?? process.env.MONGODB_URI;
  let embedded: MongoMemoryServer | undefined;
  let effectiveUri = uri;

  if (!effectiveUri) {
    if (!options.allowEmbedded) {
      throw new Error(
        "MONGODB_URI is required unless embedded MongoDB is explicitly enabled.",
      );
    }
    if (process.env.NODE_ENV === "production" || process.env.VERCEL) {
      throw new Error(
        "MONGODB_URI is required in production; embedded MongoDB is development-only.",
      );
    }
    const module = (await import(EMBEDDED_MONGO_PACKAGE)) as {
      MongoMemoryServer: {
        create(): Promise<MongoMemoryServer>;
      };
    };
    embedded = await module.MongoMemoryServer.create();
    effectiveUri = embedded.getUri();
  }

  const client = new MongoClient(effectiveUri);
  try {
    await client.connect();
  } catch (error) {
    await embedded?.stop();
    throw error;
  }

  let closePromise: Promise<void> | undefined;
  return {
    client,
    database: client.db(options.databaseName),
    isEmbedded: embedded !== undefined,
    close(): Promise<void> {
      closePromise ??= (async () => {
        try {
          await client.close();
        } finally {
          await embedded?.stop();
        }
      })();
      return closePromise;
    },
  };
}

export function getSharedMongoConnection(
  options: MongoConnectionOptions,
): Promise<MongoConnection> {
  const key = connectionKey(options);
  if (sharedConnection && sharedConnection.key !== key) {
    throw new Error(
      "The shared MongoDB connection is already configured differently.",
    );
  }
  if (!sharedConnection) {
    let promise: Promise<MongoConnection>;
    promise = createMongoConnection(options)
      .then((connection) => {
        let closePromise: Promise<void> | undefined;
        return {
          ...connection,
          close(): Promise<void> {
            if (!closePromise) {
              if (sharedConnection?.promise === promise) {
                sharedConnection = undefined;
              }
              closePromise = connection.close();
              sharedCloseOperations.add(closePromise);
              void closePromise.then(
                () => sharedCloseOperations.delete(closePromise!),
                () => sharedCloseOperations.delete(closePromise!),
              );
            }
            return closePromise;
          },
        };
      })
      .catch((error) => {
        if (sharedConnection?.promise === promise) {
          sharedConnection = undefined;
        }
        throw error;
      });
    sharedConnection = { key, promise };
  }
  return sharedConnection.promise;
}

export async function closeSharedMongoConnection(): Promise<void> {
  const active = sharedConnection;
  sharedConnection = undefined;
  const closing = [...sharedCloseOperations];
  if (active) {
    closing.push(
      active.promise.then((connection) => connection.close()),
    );
  }
  await Promise.all(closing);
}

function connectionKey(options: MongoConnectionOptions): string {
  return JSON.stringify({
    uri: options.uri ?? process.env.MONGODB_URI ?? null,
    databaseName: options.databaseName,
    allowEmbedded: options.allowEmbedded ?? false,
  });
}
