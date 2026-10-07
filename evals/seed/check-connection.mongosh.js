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

// Read-only connection preflight; never prints credentials or user names.
const status = db.getSiblingDB("admin").runCommand({ connectionStatus: 1 });
const databases = db.getSiblingDB("admin").runCommand({ listDatabases: 1, nameOnly: true, authorizedDatabases: true });
if (!status.ok || !databases.ok) throw new Error("Connection preflight failed.");
const roles = (status.authInfo?.authenticatedUserRoles ?? []).map(({ role, db: database }) => ({ role, database }));
print(JSON.stringify({ checkedAt: new Date().toISOString(), authenticated: (status.authInfo?.authenticatedUsers ?? []).length > 0, roles, databases: (databases.databases ?? []).map(({ name }) => name) }));
