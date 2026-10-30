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
import { accessListRoute } from "./accessList.js";
import { createClusterRoute } from "./createCluster.js";
import { getClusterRoute } from "./getCluster.js";
import { getDropIndexSuggestionsRoute } from "./getDropIndexSuggestions.js";
import { getEncryptionAtRestRoute } from "./getEncryptionAtRest.js";
import { getFlexClusterRoute } from "./getFlexCluster.js";
import { getProjectRoute } from "./getProject.js";
import { getSchemaAdviceRoute } from "./getSchemaAdvice.js";
import { getSlowQueryLogsRoute } from "./getSlowQueryLogs.js";
import { getSuggestedIndexesRoute } from "./getSuggestedIndexes.js";
import { listAlertsRoute } from "./listAlerts.js";
import { listClustersRoute } from "./listClusters.js";
import { listFlexClustersRoute } from "./listFlexClusters.js";
import { listOrgsRoute } from "./listOrgs.js";
import { listProjectsRoute } from "./listProjects.js";
import { sampleDatasetLoadRoute } from "./sampleDatasetLoad.js";
import { streamsDiscoverRoutes } from "./streamsDiscover.js";
import { updateClusterRoute } from "./updateCluster.js";
import { upgradeFlexClusterRoute } from "./upgradeFlexCluster.js";
import { upgradeFreeClusterRoute } from "./upgradeFreeCluster.js";

/**
 * The Atlas Admin API routes the agents' tools use, relative to
 * `/api/atlas/v2`. To add one, create a file here named after the operation,
 * register it below, and add a test next to it.
 */
export const atlasRoutes = new Hono<AtlasEnv>()
  .route("/", listOrgsRoute)
  .route("/", listProjectsRoute)
  .route("/", getProjectRoute)
  .route("/", listClustersRoute)
  .route("/", listFlexClustersRoute)
  .route("/", createClusterRoute)
  .route("/", getClusterRoute)
  .route("/", getFlexClusterRoute)
  .route("/", updateClusterRoute)
  .route("/", upgradeFreeClusterRoute)
  .route("/", upgradeFlexClusterRoute)
  .route("/", listAlertsRoute)
  .route("/", accessListRoute)
  .route("/", sampleDatasetLoadRoute)
  .route("/", streamsDiscoverRoutes)
  .route("/", getEncryptionAtRestRoute)
  .route("/", getSuggestedIndexesRoute)
  .route("/", getDropIndexSuggestionsRoute)
  .route("/", getSchemaAdviceRoute)
  .route("/", getSlowQueryLogsRoute);
