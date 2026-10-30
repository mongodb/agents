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

import type { AtlasEnv } from "../support/env.js";

/** The address the mock reports for every caller. A documentation address. */
export const MOCK_CALLER_IP = "203.0.113.7";

/**
 * `GET /api/private/ipinfo`. It is mounted under `/api/private`, not
 * `/api/atlas/v2`. The tools read it to add the caller's address to the
 * project access list.
 */
export const getIpInfoRoute = new Hono<AtlasEnv>().get(
  "/ipinfo",
  (c) => c.json({ currentIpv4Address: MOCK_CALLER_IP }),
);
