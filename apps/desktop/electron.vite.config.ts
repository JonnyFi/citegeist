import { cpSync } from "node:fs";
import { join } from "node:path";
import { defineConfig } from "electron-vite";

// Workspace packages export TypeScript source, so they are bundled (the CLI too: out/main/cg.js). Native modules (better-sqlite3,
// @parcel/watcher) and the other declared dependencies stay external and resolve from node_modules.
const bundled = ["@citegeist/core", "@citegeist/ops", "@citegeist/schema", "@citegeist/server"];

/**
 * @citegeist/cite reads its CSL styles and locales from `vendor/` next to its own module. Bundled
 * into core.js, that directory has to sit next to the bundle.
 */
const copyCslVendor = {
  name: "copy-csl-vendor",
  closeBundle() {
    cpSync(
      join(import.meta.dirname, "../../packages/cite/src/vendor"),
      join(import.meta.dirname, "out/main/vendor"),
      { recursive: true },
    );
  },
};

export default defineConfig({
  main: {
    plugins: [copyCslVendor],
    build: {
      outDir: "out/main",
      externalizeDeps: { exclude: bundled },
      rollupOptions: {
        input: {
          index: "src/main/index.ts",
          core: "../../packages/server/src/core/entry.ts",
          // the `cg` command line; the launcher in Resources/bin runs it with the app binary
          cg: "../cli/src/bin.ts",
        },
      },
    },
  },
  preload: {
    build: {
      outDir: "out/preload",
      // The sandboxed preload must be CommonJS.
      rollupOptions: {
        input: { index: "src/preload/index.ts", "quick-insert": "src/quick-insert/preload.ts" },
        output: { format: "cjs", entryFileNames: "[name].cjs" },
      },
    },
  },
});
