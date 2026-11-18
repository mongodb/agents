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

import { z } from "zod";

import { CustomExpectedSchema, makeAgentEvalCaseSchema } from "./schemas.js";

/** Query Insights' slot in `expected.custom`. */
export const QueryInsightsExpectedShape = {
  /** What a Query Insights report should hold. Read by the report scorers. */
  queryInsights: z
    .object({
      /**
       * The indexes the case's Performance Advisor suggests, in the order it
       * lists them. Empty when it suggests none, so the report must not
       * invent one.
       */
      suggestedIndexes: z.array(
        z.object({
          namespace: z.string(),
          /** One `{ field: direction }` entry per key, in key order. */
          index: z.array(z.record(z.string(), z.union([z.number(), z.string()]))),
        }),
      ),
      /** What a good report says. Graded by the reference judge. */
      reference: z.string().optional(),
      /**
       * How many shape sections the report must have. Unset means any number.
       * Set when the cluster has more shapes than the report covers, so the
       * report must pick the top ones.
       */
      expectedShapes: z.number().int().positive().optional(),
    })
    .optional(),
};

export const QueryInsightsCustomExpectedSchema = CustomExpectedSchema.extend(
  QueryInsightsExpectedShape,
);

export type QueryInsightsCustomExpected = z.infer<
  typeof QueryInsightsCustomExpectedSchema
>;

/** The case schema for this package's datasets. */
export const RepoEvalCaseSchema = makeAgentEvalCaseSchema({
  customExpected: QueryInsightsExpectedShape,
});
