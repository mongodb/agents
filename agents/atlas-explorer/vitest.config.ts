import { defineConfig } from "vitest/config";
import { definePackageVitestConfig } from "../../vitest.shared.mts";

export default defineConfig(
  definePackageVitestConfig({
    exclude: [
      "**/node_modules/**",
      "**/.git/**",
      "src/**/*.integration.test.ts",
    ],
  }),
);
