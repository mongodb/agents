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

import { Hono } from "hono";

import type { AccountRegistry } from "./accounts.js";
import { requireAccount } from "./auth.js";
import type { AtlasEnv } from "./env.js";
import { AtlasError } from "./errors.js";
import { atlasRoutes } from "./routes/index.js";
import { oauthTokenRoute } from "./routes/oauthToken.js";

export const API_PREFIX = "/api/atlas/v2";
const ATLAS_CONTENT_TYPE = "application/vnd.atlas.2025-03-12+json";

/**
 * The mock Atlas Admin API as a Hono app. It has no server of its own, so
 * tests can call it with `app.request()`. `startMockAtlasApi` serves it.
 *
 * Only the routes the agents' tools use exist. Any other request gets a 404
 * that names the method and path, so a missing route is obvious.
 */
export function createAtlasApp(registry: AccountRegistry) {
  const app = new Hono<AtlasEnv>();

  // Record every request an account makes, whatever the outcome.
  app.use("*", async (c, next) => {
    await next();
    c.header("Content-Type", ATLAS_CONTENT_TYPE);
    const url = new URL(c.req.url);
    c.get("account")?.requests.push({
      method: c.req.method,
      url: `${url.pathname}${url.search}`,
      status: c.res.status,
    });
  });

  app.route("/", oauthTokenRoute(registry));

  const api = new Hono<AtlasEnv>();
  api.use("*", requireAccount(registry));
  api.route("/", atlasRoutes);
  app.route(API_PREFIX, api);

  app.onError((err, c) => {
    if (err instanceof AtlasError) return c.json(err.toBody(), err.status);
    return c.json(
      { error: 500, errorCode: "MOCK_INTERNAL_ERROR", detail: String(err) },
      500,
    );
  });

  app.notFound((c) =>
    c.json(
      {
        error: 404,
        errorCode: "NOT_IMPLEMENTED_IN_MOCK",
        detail: `${c.req.method} ${new URL(c.req.url).pathname} is not implemented by the eval mock Atlas API`,
      },
      404,
    ),
  );

  return app;
}
