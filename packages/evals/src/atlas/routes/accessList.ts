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
import { z } from "zod";

import type { AtlasEnv } from "../support/env.js";
import { AtlasError } from "../support/errors.js";
import { readJsonBody, requireProject } from "../support/lookups.js";
import { atlasPage } from "../support/responses.js";

const Entries = z
  .array(
    z.looseObject({
      ipAddress: z.string().min(1),
      comment: z.string().optional(),
    }),
  )
  .min(1);

/**
 * `GET /groups/:groupId/accessList` and `POST /groups/:groupId/accessList`.
 * The POST adds the entries to the project and answers 409 when an address is
 * already there, which the tools read as "already allowed".
 */
export const accessListRoute = new Hono<AtlasEnv>()
  .get("/groups/:groupId/accessList", (c) => {
    const project = requireProject(c, c.req.param("groupId"));
    return c.json(
      atlasPage(
        project.accessList.map((entry) => ({ ...entry, groupId: project.id })),
      ),
    );
  })
  .post("/groups/:groupId/accessList", async (c) => {
    const project = requireProject(c, c.req.param("groupId"));
    const parsed = Entries.safeParse(await readJsonBody(c));
    if (!parsed.success) {
      throw new AtlasError(
        400,
        "INVALID_ATTRIBUTE",
        parsed.error.issues.map((issue) => issue.message).join("; "),
      );
    }
    const known = new Set(project.accessList.map((entry) => entry.ipAddress));
    const duplicate = parsed.data.find((entry) => known.has(entry.ipAddress));
    if (duplicate) {
      throw new AtlasError(
        409,
        "DUPLICATE_ACCESS_LIST_ENTRY",
        `${duplicate.ipAddress} is already in the access list`,
      );
    }
    for (const entry of parsed.data) {
      project.accessList.push({
        ipAddress: entry.ipAddress,
        comment: entry.comment ?? "",
      });
    }
    return c.json(
      atlasPage(
        parsed.data.map((entry) => ({
          ipAddress: entry.ipAddress,
          comment: entry.comment ?? "",
          groupId: project.id,
        })),
      ),
      201,
    );
  });
