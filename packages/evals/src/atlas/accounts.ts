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

import { AtlasFixtureSchema, type AtlasFixture, type AtlasFixtureInput } from "./fixtures.js";

export interface RecordedRequest {
  readonly method: string;
  /** Path and query, as received. */
  readonly url: string;
  readonly status: number;
}

/** One case's view of the mock: its seeded data, and what was asked of it. */
export interface MockAtlasAccount {
  readonly clientId: string;
  /** Current data, including changes made through write routes. */
  state(): AtlasFixture;
  requests(): readonly RecordedRequest[];
  /** Forget the account. Later requests with its token get a 401. */
  release(): void;
}

/** The mutable record behind a {@link MockAtlasAccount}. */
export interface Account {
  fixture: AtlasFixture;
  requests: RecordedRequest[];
}

/** Accounts by OAuth client id. One per case, so cases cannot see each other. */
export class AccountRegistry {
  private readonly accounts = new Map<string, Account>();

  find(clientId: string): Account | undefined {
    return this.accounts.get(clientId);
  }

  register(clientId: string, fixtureInput: AtlasFixtureInput): MockAtlasAccount {
    if (this.accounts.has(clientId)) {
      throw new Error(`Mock Atlas account ${clientId} already exists`);
    }
    const account: Account = {
      fixture: AtlasFixtureSchema.parse(fixtureInput),
      requests: [],
    };
    this.accounts.set(clientId, account);
    return {
      clientId,
      state: () => structuredClone(account.fixture),
      requests: () => [...account.requests],
      release: () => void this.accounts.delete(clientId),
    };
  }
}
