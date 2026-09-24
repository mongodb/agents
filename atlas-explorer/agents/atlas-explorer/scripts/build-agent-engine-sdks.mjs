import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// The pinned SDK packages export ./dist, but that directory is not committed
// and the packages no longer have a prepare script. pnpm therefore installs
// them without an entry point. Build the JavaScript workspace at the same
// commit and copy dist into the installed packages.
const COMMIT = "32656f78169d9ffebcde33b2762a35c64f28fdaa";
const REPO = "https://github.com/10gen/magenta-client-libraries.git";
const packageRoot = fileURLToPath(new URL("..", import.meta.url));

const packages = [
  ["agent-engine-sdk", "@mongodb-js/agent-engine-sdk"],
  ["agent-engine-memory", "@mongodb-js/agent-engine-sdk-memory"],
  ["agent-engine-runner-shared", "@mongodb-js/agent-engine-runner-shared"],
  ["agent-engine-sdk-langgraph", "@mongodb-js/agent-engine-sdk-langgraph"],
];

function locateInstalled(packageName) {
  const direct = join(packageRoot, "node_modules", packageName);
  if (existsSync(direct)) return realpathSync(direct);
  const store = join(packageRoot, "node_modules", ".pnpm");
  if (!existsSync(store)) return null;
  for (const entry of readdirSync(store)) {
    const candidate = join(store, entry, "node_modules", packageName);
    if (existsSync(candidate)) return realpathSync(candidate);
  }
  return null;
}

const installed = packages.map(([directory, packageName]) => {
  const destination = locateInstalled(packageName);
  if (!destination) {
    throw new Error(`Could not find installed ${packageName}. Run pnpm install before building the SDK.`);
  }
  return { directory, packageName, destination };
});

if (installed.every(({ destination }) => existsSync(join(destination, "dist", "index.js")))) {
  process.exit(0);
}

const checkout = join(tmpdir(), `agent-engine-sdk-${COMMIT.slice(0, 12)}`);
rmSync(checkout, { recursive: true, force: true });
mkdirSync(checkout, { recursive: true });

function git(args) {
  execFileSync("git", args, { cwd: checkout, stdio: "inherit" });
}

git(["init"]);
git(["remote", "add", "origin", REPO]);
git(["sparse-checkout", "set", "--cone", "packages/javascript"]);
git(["fetch", "--depth", "1", "origin", COMMIT]);
git(["checkout", "FETCH_HEAD"]);

const workspace = join(checkout, "packages", "javascript");
execFileSync(
  "npm",
  ["ci", "--ignore-scripts", "--engine-strict=false", "--min-release-age=0"],
  {
    cwd: workspace,
    stdio: "inherit",
    env: { ...process.env, npm_config_engine_strict: "false" },
  },
);
execFileSync("npm", ["run", "build", "--workspaces", "--if-present"], {
  cwd: workspace,
  stdio: "inherit",
  env: { ...process.env, npm_config_engine_strict: "false" },
});

for (const { directory, packageName, destination } of installed) {
  const built = join(workspace, "packages", directory, "dist");
  if (!existsSync(join(built, "index.js"))) {
    throw new Error(`Build did not produce ${packageName} dist/index.js`);
  }
  const target = join(destination, "dist");
  rmSync(target, { recursive: true, force: true });
  cpSync(built, target, { recursive: true });
}
