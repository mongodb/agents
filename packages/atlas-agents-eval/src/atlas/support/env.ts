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

import type { Hono } from "hono";

import type { Account } from "./accounts.js";

/** What every route can read from the Hono context. */
export type AtlasEnv = {
  Variables: {
    /** The account the request's bearer token belongs to. */
    account: Account;
  };
};

export type AtlasApp = Hono<AtlasEnv>;
