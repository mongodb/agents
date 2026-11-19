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

import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  buildSlackHomeView,
  RESPONSE_METADATA_EVENT,
} from "./slack.js";

describe("Atlas Explorer Slack configuration", () => {
  it("keeps the response metadata event type aligned with manifest.json", async () => {
    const manifest = JSON.parse(
      await readFile(
        new URL("../../manifest.json", import.meta.url),
        "utf8",
      ),
    ) as {
      metadata?: {
        event_subscriptions?: Array<{ event_type?: string }>;
      };
    };

    expect(
      manifest.metadata?.event_subscriptions?.map(
        (event) => event.event_type,
      ),
    ).toContain(RESPONSE_METADATA_EVENT);
  });

  it("includes the bot display name in the App Home header", () => {
    const view = buildSlackHomeView("AtlasExplorer");

    expect(view).toMatchObject({
      type: "home",
      blocks: expect.arrayContaining([
        {
          type: "header",
          text: {
            type: "plain_text",
            text: "Welcome to AtlasExplorer",
          },
        },
      ]),
    });
  });
});
