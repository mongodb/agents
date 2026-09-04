import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const runnerSharedEntry = import.meta.resolve("@magenta/runner-shared-ts");
const handlersPath = fileURLToPath(
  new URL("./toolpod_handlers.js", runnerSharedEntry),
);
const source = readFileSync(handlersPath, "utf8");

const eagerRoots = `const READONLY_RESOURCE_ROOTS = [
    readonlySkillsRootFromEnv(),
].filter((r) => r !== null);`;
const lazyRoots = `let readonlyResourceRoots;
function getReadonlyResourceRoots() {
    return (readonlyResourceRoots ??= [
        readonlySkillsRootFromEnv(),
    ].filter((r) => r !== null));
}`;
const eagerCheck =
  "return READONLY_RESOURCE_ROOTS.some((root) => isWithinRoot(resolved, root));";
const lazyCheck =
  "return getReadonlyResourceRoots().some((root) => isWithinRoot(resolved, root));";

if (source.includes(lazyRoots) && source.includes(lazyCheck)) {
  process.exit(0);
}

if (!source.includes(eagerRoots) || !source.includes(eagerCheck)) {
  throw new Error(
    "Unsupported @magenta/runner-shared-ts toolpod_handlers.js; " +
      "remove or update scripts/patch-runner-shared.mjs for the new SDK.",
  );
}

writeFileSync(
  handlersPath,
  source.replace(eagerRoots, lazyRoots).replace(eagerCheck, lazyCheck),
);
console.log(
  "[patch-runner-shared] Enabled lazy bundled skill-root resolution.",
);
