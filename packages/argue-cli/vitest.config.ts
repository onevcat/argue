import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      argue: resolve(__dirname, "../argue/src/index.ts")
    }
  }
});
