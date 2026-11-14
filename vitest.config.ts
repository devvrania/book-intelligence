import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    // PGlite boots a WASM Postgres per test file; give integration tests room.
    testTimeout: 60_000,
    hookTimeout: 120_000,
    pool: "forks",
  },
});
