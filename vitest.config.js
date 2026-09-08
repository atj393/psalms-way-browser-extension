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
      include: ["src/**/*.js"],
      // app.js is the wiring layer: it is exercised through the DOM tests
      // rather than measured directly.
      exclude: ["src/app.js"],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
    },
  },
});
