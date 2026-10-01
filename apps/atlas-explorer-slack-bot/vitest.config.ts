import { defineConfig } from "vitest/config";
import { definePackageVitestConfig } from "../../vitest.shared.mts";

export default defineConfig(
  definePackageVitestConfig({
    include: ["api/**/*.test.ts", "src/**/*.test.ts"],
  }),
);
