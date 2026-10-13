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

import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { z } from "zod";

export const CONFIG_FILE_NAME = "skills.config.json";

const skillName = z
  .string()
  .regex(
    /^[a-z0-9][a-z0-9-]*$/,
    "skill names use lowercase letters, digits and hyphens",
  );

export const skillsConfigSchema = z
  .strictObject({
    source: z.string().min(1),
    ref: z.string().min(1).optional(),
    skills: z
      .array(skillName)
      .min(1)
      .refine((names) => new Set(names).size === names.length, {
        message: "skill names must be unique",
      }),
  })
  .superRefine((config, ctx) => {
    if (config.ref !== undefined && isLocalSource(config.source)) {
      ctx.addIssue({
        code: "custom",
        message: "ref only applies to remote sources, not local paths",
        path: ["ref"],
      });
    }
    if (config.ref !== undefined && config.source.includes("#")) {
      ctx.addIssue({
        code: "custom",
        message: "use either ref or a #ref suffix on source, not both",
        path: ["source"],
      });
    }
  });

export type SkillsConfig = z.infer<typeof skillsConfigSchema>;

export function isLocalSource(source: string): boolean {
  return (
    source.startsWith("/") || source.startsWith("./") || source.startsWith("../")
  );
}

export function resolveSourceArg(config: SkillsConfig, agentDir: string) {
  if (isLocalSource(config.source)) {
    return resolve(agentDir, config.source);
  }
  return config.ref ? `${config.source}#${config.ref}` : config.source;
}

export async function loadSkillsConfig(agentDir: string): Promise<SkillsConfig> {
  const configPath = join(agentDir, CONFIG_FILE_NAME);

  let text: string;
  try {
    text = await readFile(configPath, "utf8");
  } catch {
    throw new Error(`No ${CONFIG_FILE_NAME} found at ${configPath}`);
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `${configPath} is not valid JSON: ${(error as Error).message}`,
    );
  }

  const parsed = skillsConfigSchema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => {
        const where = issue.path.length ? issue.path.join(".") : "(root)";
        return `  - ${where}: ${issue.message}`;
      })
      .join("\n");
    throw new Error(`${configPath} is invalid:\n${issues}`);
  }

  return parsed.data;
}
