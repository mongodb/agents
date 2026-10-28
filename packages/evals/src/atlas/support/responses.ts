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

import type { MockCluster, MockProject } from "../fixtures.js";

/** Atlas wraps every list in a page. The mock never has a second page. */
export function atlasPage<T>(items: readonly T[]) {
  return { results: items, totalCount: items.length, links: [] };
}

/** `host:port` of each node. The slow query endpoint is keyed by these. */
export function nodeHosts(cluster: MockCluster): string[] {
  return (
    cluster.hosts ??
    [0, 1, 2].map(
      (n) => `${cluster.name}-shard-00-0${n}.mock.mongodb.net:27017`,
    )
  );
}

export function projectSummary(project: MockProject) {
  return {
    id: project.id,
    name: project.name,
    orgId: project.orgId,
    clusterCount: project.clusters.length,
  };
}

export function clusterJson(project: MockProject, cluster: MockCluster) {
  return {
    id: cluster.id,
    groupId: project.id,
    name: cluster.name,
    clusterType: "REPLICASET",
    stateName: cluster.state,
    paused: cluster.paused,
    mongoDBVersion: cluster.mongoDBVersion,
    connectionStrings: {
      standard: `mongodb://${nodeHosts(cluster).join(",")}/?ssl=true`,
      standardSrv: `mongodb+srv://${cluster.name}.mock.mongodb.net`,
    },
    replicationSpecs: [
      {
        regionConfigs: [
          {
            providerName: cluster.provider,
            regionName: cluster.region,
            priority: 7,
            electableSpecs: {
              instanceSize: cluster.instanceSize,
              nodeCount: 3,
            },
          },
        ],
      },
    ],
  };
}
