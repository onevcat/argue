import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@onevcat/argue": resolve(__dirname, "../argue/src/index.ts")
    }
  }
});
