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

import { rm } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  diffTrees,
  digestTree,
  hashTree,
  type FileHashes,
} from "./files.js";
import { makeTempDir, writeTree } from "./testUtils.js";

describe("hashTree", () => {
  let root: string;

  beforeEach(async () => {
    root = await makeTempDir("update-skills-hash");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("returns an empty map for a missing directory", async () => {
    const hashes = await hashTree(join(root, "missing"));
    expect(hashes.size).toBe(0);
  });

  it("keys files by posix path relative to the root", async () => {
    await writeTree(root, {
      "SKILL.md": "a",
      "references/doc.md": "b",
    });
    const hashes = await hashTree(root);
    expect([...hashes.keys()].sort()).toEqual(["SKILL.md", "references/doc.md"]);
  });
});

describe("diffTrees", () => {
  it("classifies added, changed and removed files", () => {
    const upstream: FileHashes = new Map([
      ["SKILL.md", "new"],
      ["references/new.md", "x"],
      ["references/same.md", "same"],
    ]);
    const local: FileHashes = new Map([
      ["SKILL.md", "old"],
      ["references/same.md", "same"],
      ["references/gone.md", "y"],
    ]);

    expect(diffTrees(upstream, local)).toEqual({
      added: ["references/new.md"],
      changed: ["SKILL.md"],
      removed: ["references/gone.md"],
    });
  });

  it("reports nothing when the trees match", () => {
    const tree: FileHashes = new Map([["SKILL.md", "same"]]);
    expect(diffTrees(tree, new Map(tree))).toEqual({
      added: [],
      changed: [],
      removed: [],
    });
  });
});

describe("digestTree", () => {
  it("is stable across insertion order and changes with content", () => {
    const first: FileHashes = new Map([
      ["a.md", "1"],
      ["b.md", "2"],
    ]);
    const reordered: FileHashes = new Map([
      ["b.md", "2"],
      ["a.md", "1"],
    ]);
    const edited: FileHashes = new Map([
      ["a.md", "1"],
      ["b.md", "3"],
    ]);

    expect(digestTree(first)).toBe(digestTree(reordered));
    expect(digestTree(first)).not.toBe(digestTree(edited));
  });
});
