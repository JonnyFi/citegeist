import { defineConfig } from "vitest/config";

// The S3 bench runs thousands of fuzzy matches; CI runners are slower than a laptop.
export default defineConfig({ test: { testTimeout: 60_000 } });
