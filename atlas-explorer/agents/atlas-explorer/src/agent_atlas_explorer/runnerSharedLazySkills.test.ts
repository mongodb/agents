import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("runner-shared bundled skill roots", () => {
  it("resolves the skill root lazily after module import", () => {
    const agentRoot = mkdtempSync(path.join(tmpdir(), "magenta-agent-root-"));
    const skillFile = path.join(agentRoot, "skills", "example.md");
    mkdirSync(path.dirname(skillFile), { recursive: true });
    writeFileSync(skillFile, "lazy skill root\n");

    try {
      const script = `
        const { filesystemRead } = await import("@magenta/runner-shared-ts");
        process.env.AGENTIC_AGENT_WORKDIR = ${JSON.stringify(agentRoot)};
        const result = filesystemRead({ file_path: ${JSON.stringify(skillFile)} });
        process.stdout.write(JSON.stringify(result));
      `;
      const output = execFileSync(
        process.execPath,
        ["--input-type=module", "--eval", script],
        {
          cwd: process.cwd(),
          encoding: "utf8",
          env: {
            ...process.env,
            AGENTIC_AGENT_CONFIG_PATH: "",
            AGENTIC_AGENT_WORKDIR: "",
          },
        },
      );

      expect(JSON.parse(output)).toEqual({
        content: "lazy skill root\n",
        encoding: "utf-8",
      });
    } finally {
      rmSync(agentRoot, { recursive: true, force: true });
    }
  });
});
