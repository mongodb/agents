import { createMiddleware } from "langchain";
import { z } from "zod";
import { getCurrentPayload } from "@magenta/runner-shared-ts";

import {
  persistUserRunsFromPayload,
  userRunSchema,
} from "./userRun.js";

export function readCurrentPayload(): unknown {
  try {
    return getCurrentPayload();
  } catch {
    return undefined;
  }
}

export const persistUserRunsMiddleware = createMiddleware({
  name: "persistUserRuns",
  stateSchema: z.object({
    user_runs: z.array(userRunSchema).default([]),
  }),
  beforeAgent: (state) =>
    persistUserRunsFromPayload(
      state,
      readCurrentPayload(),
      new Date().toISOString(),
    ),
});
