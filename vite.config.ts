import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["sources/**/__tests__/**/*.ts?(x)", "sources/**/*.test.ts?(x)"],
    coverage: {
      include: ["sources/**/*.ts?(x)"],
      reportsDirectory: "docs/coverage",
      reporter: (process.env.POB_VITEST_COVERAGE || "json,text").split(","),
    },
  },
});
