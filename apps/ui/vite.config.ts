import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { cspPlugin } from "./csp.js";

// base "./" keeps asset URLs relative, so the build also loads from file:// inside Electron.
export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss(), cspPlugin()],
  server: { port: 5173, strictPort: true },
  build: { outDir: "dist", sourcemap: true },
  test: {
    testTimeout: 60_000,
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    css: false,
  },
});
