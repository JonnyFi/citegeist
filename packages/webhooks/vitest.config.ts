import { defineConfig } from "vitest/config";

// CI runners are much slower than a laptop; keep generous limits everywhere.
export default defineConfig({ test: { testTimeout: 60_000, hookTimeout: 60_000 } });
