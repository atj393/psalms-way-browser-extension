import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Pure-logic suites run in plain Node; DOM suites opt in with a
    // `@vitest-environment jsdom` docblock. Starting jsdom for every file cost
    // about thirty seconds per run for no benefit.
    environment: "node",
    globals: false,
    include: ["test/**/*.test.js"],
    setupFiles: ["test/setup.js"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      // Thresholds apply to the service and logic layer, which is what these
      // suites exist to protect. The view modules below render into a live
      // popup and are covered by scripts/smoke-test.js, which drives the real
      // extension in Chrome; counting them here would mean either a
      // meaningless number or jsdom tests that re-assert what the browser
      // already proves.
      include: [
        "src/backup.js",
        "src/data.js",
        "src/dates.js",
        "src/dom.js",
        "src/icons.js",
        "src/search.js",
        "src/storage.js",
      ],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 85,
        statements: 90,
      },
    },
  },
});
