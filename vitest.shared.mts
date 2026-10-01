// Shared Vitest settings for workspace packages. Each package keeps a
// vitest.config.ts that imports definePackageVitestConfig and passes
// only the settings that differ. Array fields such as include and
// exclude replace the shared values.
//
// This file is .mts so Vite loads it as ESM. The root package.json is
// not "type": "module" because scripts/ still contains CommonJS.

export type PackageVitestOverrides = {
  environment?: "node";
  include?: string[];
  exclude?: string[];
  testTimeout?: number;
};

const sharedTest = {
  environment: "node" as const,
  include: ["src/**/*.test.ts"],
};

export function definePackageVitestConfig(
  overrides: PackageVitestOverrides = {},
) {
  return {
    test: {
      ...sharedTest,
      ...overrides,
    },
  };
}
