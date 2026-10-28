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

import type { AccountRegistry } from "../support/accounts.js";
import { clientIdFromBasicAuth, tokenFor } from "../support/auth.js";

/**
 * `POST /api/oauth/token`. The Atlas token library asks for a client
 * credentials grant. Only a registered client id gets a token.
 */
export function oauthTokenRoute(registry: AccountRegistry) {
  return new Hono().post("/api/oauth/token", async (c) => {
    const form = await c.req.parseBody();
    const formClientId =
      typeof form["client_id"] === "string" ? form["client_id"] : undefined;
    const clientId =
      clientIdFromBasicAuth(c.req.header("authorization")) ?? formClientId;
    if (!clientId || !registry.find(clientId)) {
      return c.json({ error: "invalid_client" }, 401);
    }
    return c.json({
      access_token: tokenFor(clientId),
      token_type: "Bearer",
      expires_in: 3600,
    });
  });
}
