import { defineConfig } from "electron-vite";

// Workspace packages export TypeScript source, so they are bundled. Native modules (better-sqlite3,
// @parcel/watcher) and the other declared dependencies stay external and resolve from node_modules.
const bundled = ["@citegeist/core", "@citegeist/ops", "@citegeist/schema"];

export default defineConfig({
  main: {
    build: {
      outDir: "out/main",
      externalizeDeps: { exclude: bundled },
      rollupOptions: {
        input: { index: "src/main/index.ts", core: "src/core/entry.ts" },
      },
    },
  },
  preload: {
    build: {
      outDir: "out/preload",
      // The sandboxed preload must be CommonJS.
      rollupOptions: {
        input: { index: "src/preload/index.ts" },
        output: { format: "cjs", entryFileNames: "[name].cjs" },
      },
    },
  },
});
