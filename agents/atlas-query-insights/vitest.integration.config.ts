import { defineConfig } from "vitest/config";
import { definePackageVitestConfig } from "../../vitest.shared.mts";

export default defineConfig(
  definePackageVitestConfig({
    include: ["src/**/*.integration.test.ts"],
    testTimeout: 300_000,
    hookTimeout: 120_000,
    fileParallelism: false,
    sequence: { concurrent: false },
  }),
);
