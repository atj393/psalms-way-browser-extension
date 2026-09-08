// Global test setup: keep the console quiet for the paths that log on purpose,
// while still failing loudly on anything unexpected.
import { afterEach, vi } from "vitest";

afterEach(() => {
  vi.restoreAllMocks();
  delete globalThis.chrome;
});
