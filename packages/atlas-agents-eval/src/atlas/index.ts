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

export { API_PREFIX, createAtlasApp } from "./app.js";
export {
  AtlasFixtureSchema,
  newMockCluster,
  type AtlasFixture,
  type AtlasFixtureInput,
  type MockAccessListEntry,
  type MockCluster,
  type MockFlexCluster,
  type MockProject,
  type MockStreamWorkspace,
} from "./fixtures.js";
export {
  startMockAtlasApi,
  type MockAtlasAccount,
  type MockAtlasApi,
  type RecordedRequest,
} from "./mockAtlasApi.js";
