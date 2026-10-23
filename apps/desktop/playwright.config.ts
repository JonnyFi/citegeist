import { defineConfig } from "@playwright/test";

// Electron smoke tests. Run with `pnpm --filter @citegeist/desktop test:e2e`; they need a display
// and the built app, so they are not part of `pnpm verify`.
export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.e2e.ts",
  timeout: 60_000,
  workers: 1,
  reporter: "list",
  use: { trace: "retain-on-failure" },
});
