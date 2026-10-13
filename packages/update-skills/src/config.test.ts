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

import { rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  loadSkillsConfig,
  resolveSourceArg,
  skillsConfigSchema,
} from "./config.js";
import { makeTempDir } from "./testUtils.js";

describe("skillsConfigSchema", () => {
  it("accepts a remote source with a ref and a list of skills", () => {
    const result = skillsConfigSchema.safeParse({
      source: "mongodb/agent-skills",
      ref: "main",
      skills: ["mongodb-connection"],
    });
    expect(result.success).toBe(true);
  });

  it("rejects unknown keys", () => {
    const result = skillsConfigSchema.safeParse({
      source: "mongodb/agent-skills",
      skills: ["mongodb-connection"],
      sourceUrl: "typo",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an empty skill list", () => {
    const result = skillsConfigSchema.safeParse({
      source: "mongodb/agent-skills",
      skills: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects duplicate skill names", () => {
    const result = skillsConfigSchema.safeParse({
      source: "mongodb/agent-skills",
      skills: ["mongodb-connection", "mongodb-connection"],
    });
    expect(result.success).toBe(false);
  });

  it("rejects names that could escape the skills directory", () => {
    for (const name of ["../secrets", "Mongo", "a/b", ".hidden"]) {
      const result = skillsConfigSchema.safeParse({
        source: "mongodb/agent-skills",
        skills: [name],
      });
      expect(result.success, name).toBe(false);
    }
  });

  it("rejects a ref on a local path", () => {
    const result = skillsConfigSchema.safeParse({
      source: "../some-checkout",
      ref: "main",
      skills: ["mongodb-connection"],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a ref combined with a #ref suffix on the source", () => {
    const result = skillsConfigSchema.safeParse({
      source: "mongodb/agent-skills#main",
      ref: "main",
      skills: ["mongodb-connection"],
    });
    expect(result.success).toBe(false);
  });
});

describe("resolveSourceArg", () => {
  const agentDir = "/repo/agents/example";

  it("appends the ref to a remote source", () => {
    expect(
      resolveSourceArg(
        { source: "mongodb/agent-skills", ref: "v1", skills: ["a"] },
        agentDir,
      ),
    ).toBe("mongodb/agent-skills#v1");
  });

  it("leaves a remote source alone when there is no ref", () => {
    expect(
      resolveSourceArg({ source: "mongodb/agent-skills", skills: ["a"] }, agentDir),
    ).toBe("mongodb/agent-skills");
  });

  it("resolves a local source against the agent directory", () => {
    expect(
      resolveSourceArg({ source: "../../upstream", skills: ["a"] }, agentDir),
    ).toBe(resolve("/repo/upstream"));
  });
});

describe("loadSkillsConfig", () => {
  let agentDir: string;

  beforeEach(async () => {
    agentDir = await makeTempDir("update-skills-config");
  });

  afterEach(async () => {
    await rm(agentDir, { recursive: true, force: true });
  });

  it("explains when the config file is missing", async () => {
    await expect(loadSkillsConfig(agentDir)).rejects.toThrow(
      /No skills\.config\.json found/,
    );
  });

  it("explains when the config file is not JSON", async () => {
    await writeFile(join(agentDir, "skills.config.json"), "{ nope");
    await expect(loadSkillsConfig(agentDir)).rejects.toThrow(/not valid JSON/);
  });

  it("names the invalid field", async () => {
    await writeFile(
      join(agentDir, "skills.config.json"),
      JSON.stringify({ source: "mongodb/agent-skills", skills: ["Bad Name"] }),
    );
    await expect(loadSkillsConfig(agentDir)).rejects.toThrow(/skills\.0/);
  });
});
