import { defineConfig } from "vitest/config";
import { definePackageVitestConfig } from "../../vitest.shared.mts";

export default defineConfig(
  definePackageVitestConfig({
    include: ["src/**/*.integration.test.ts"],
    testTimeout: 120_000,
  }),
);
