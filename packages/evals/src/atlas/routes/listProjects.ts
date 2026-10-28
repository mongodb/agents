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
import { atlasPage, projectSummary } from "../support/responses.js";

/** `GET /groups` */
export const listProjectsRoute = new Hono<AtlasEnv>().get("/groups", (c) =>
  c.json(
    atlasPage(
      c.var.account.fixture.projects.map((project) => ({
        ...projectSummary(project),
        created: "2026-01-01T00:00:00Z",
      })),
    ),
  ),
);
