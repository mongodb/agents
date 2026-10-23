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

/**
 * Databases an agent may use, across every allowed cluster. Omit to allow
 * every database. `[]` allows none.
 *
 * A string must equal the database name. A `RegExp` is tested against the
 * name as written, so anchor it (`/^orders$/`) to match the whole name. Only
 * the `i` and `u` flags are accepted.
 */
export type DatabaseNamesConfig = readonly (string | RegExp)[];

export type DatabaseMatcher = (databaseName: string) => boolean;

// Matches any character MongoDB rejects in a database name: slash, backslash,
// dot, space, double quote, dollar sign, `*`, `<`, `>`, `:`, `|`, `?`, or the
// null character.
const FORBIDDEN_NAME_CHARACTERS = /[/\\. "$*<>:|?\0]/;
// MongoDB rejects database names longer than this.
const MAX_NAME_LENGTH = 64;
// Matches a flags string made only of `i` (case-insensitive) and `u`
// (Unicode). Other flags change how matching works: `g` and `y` make
// `.test()` remember its position between calls, and `m` and `s` change how
// `^`, `$`, and `.` treat newlines.
const ALLOWED_REGEXP_FLAGS = /^[iu]*$/;

/** Throws when an entry is not a valid database name or a safe regex. */
export function validateDatabaseNames(
  databaseNames?: DatabaseNamesConfig,
): void {
  if (databaseNames === undefined) return;
  for (const entry of databaseNames) {
    if (entry instanceof RegExp) {
      if (!ALLOWED_REGEXP_FLAGS.test(entry.flags)) {
        throw new Error(
          `databaseNames regular expressions accept only the i and u flags, received ${entry}`,
        );
      }
      continue;
    }
    if (
      typeof entry !== "string" ||
      entry.length === 0 ||
      entry.length > MAX_NAME_LENGTH ||
      FORBIDDEN_NAME_CHARACTERS.test(entry)
    ) {
      throw new Error(
        `databaseNames entries must be a RegExp or a database name of 1-64 characters without / \\ . " $ * < > : | ? or spaces, received ${JSON.stringify(entry)}`,
      );
    }
  }
}

/**
 * Compiles `databaseNames` into one matcher, or `undefined` when unrestricted.
 *
 * Regular expressions run as written and can backtrack, so the matcher
 * rejects a name MongoDB would reject before testing a pattern. That
 * includes a name longer than 64 characters and a name containing `$` or
 * another forbidden character, so a loose pattern cannot match `$tenant`.
 * That keeps the input short but does not make every pattern fast.
 */
export function createDatabaseMatcher(
  databaseNames?: DatabaseNamesConfig,
): DatabaseMatcher | undefined {
  if (databaseNames === undefined) return undefined;
  validateDatabaseNames(databaseNames);

  const exact = new Set<string>();
  const patterns: RegExp[] = [];
  for (const entry of databaseNames) {
    if (typeof entry === "string") {
      exact.add(entry);
    } else {
      patterns.push(entry);
    }
  }
  return (databaseName) => {
    const withinMaxLength = databaseName.length <= MAX_NAME_LENGTH;
    const charactersAreAllowed =
      !FORBIDDEN_NAME_CHARACTERS.test(databaseName);
    if (!withinMaxLength || !charactersAreAllowed) return false;

    const matchesExactName = exact.has(databaseName);
    if (matchesExactName) return true;

    const matchesPattern = patterns.some((pattern) =>
      pattern.test(databaseName),
    );
    return matchesPattern;
  };
}

function describeEntry(entry: string | RegExp): string {
  return entry instanceof RegExp
    ? `names matching the regular expression ${entry}`
    : entry;
}

/** Lists the allowed databases in the form used in prompts and errors. */
export function describeAllowedDatabases(
  databaseNames: DatabaseNamesConfig,
): string {
  return databaseNames.map(describeEntry).join(", ");
}

export const DATABASE_LIST_NOTE =
  "Database lists in tool results can include databases not listed above. Using one returns an error.";

/** Describes the allowed databases for a system prompt. */
export function describeDatabaseNames(
  databaseNames?: DatabaseNamesConfig,
): string {
  if (databaseNames === undefined) return "You can use all databases.";
  if (databaseNames.length === 0) {
    return [
      "No databases are allowed. Do not run database tools.",
      "",
      DATABASE_LIST_NOTE,
    ].join("\n");
  }
  return [
    "Access is limited to these databases. Do not use any other database:",
    ...databaseNames.map((entry) => `- ${describeEntry(entry)}`),
    "",
    DATABASE_LIST_NOTE,
  ].join("\n");
}
