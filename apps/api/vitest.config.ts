import { defineConfig } from "vitest/config";

export default defineConfig({
  // Database tests talk to a remote Neon database, so setup/teardown hooks need more than the 10 s default.
  test: { exclude: ["dist/**", "node_modules/**"], testTimeout: 30000, hookTimeout: 90000 },
});
