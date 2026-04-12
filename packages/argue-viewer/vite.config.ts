/// <reference types="vitest/config" />
import { resolve } from "node:path";
import preact from "@preact/preset-vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [preact()],
  resolve: {
    alias: {
      "@onevcat/argue": resolve(__dirname, "../argue/src/contracts/result.ts")
    }
  },
  test: {
    environment: "happy-dom"
  }
});
