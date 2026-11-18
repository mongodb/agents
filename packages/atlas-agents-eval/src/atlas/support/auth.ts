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

import { randomBytes } from "node:crypto";

import type { MiddlewareHandler } from "hono";

import type { AccountRegistry } from "./accounts.js";
import type { AtlasEnv } from "./env.js";
import { AtlasError } from "./errors.js";

export function clientIdFromBasicAuth(
  header: string | undefined,
): string | undefined {
  if (!header?.startsWith("Basic ")) return undefined;
  const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  return decoded.split(":")[0] || undefined;
}

/** The token carries its client id, so the mock keeps no token table. */
export function tokenFor(clientId: string): string {
  const id = Buffer.from(clientId).toString("base64url");
  return `mock.${id}.${randomBytes(6).toString("hex")}`;
}

export function clientIdFromToken(header: string | undefined): string | undefined {
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  const id = token?.split(".")[1];
  return id ? Buffer.from(id, "base64url").toString("utf8") : undefined;
}

/** Looks up the caller's account, or answers 401 when it is unknown or released. */
export function requireAccount(
  registry: AccountRegistry,
): MiddlewareHandler<AtlasEnv> {
  return async (c, next) => {
    const clientId = clientIdFromToken(c.req.header("authorization"));
    const account = clientId ? registry.find(clientId) : undefined;
    if (!account) throw new AtlasError(401, "UNAUTHORIZED");
    c.set("account", account);
    await next();
  };
}
