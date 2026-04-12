/// <reference types="vitest/config" />
import { resolve } from "node:path";
import preact from "@preact/preset-vite";
import { defineConfig } from "vite";

// The viewer only needs schemas and types from `@onevcat/argue`, not the
// engine. The engine imports `node:crypto` which Vite externalises in the
// browser bundle, and accessing `randomUUID` on the external proxy throws
// `Module "node:crypto" has been externalized for browser compatibility`.
//
// To keep the browser bundle safe we alias the whole package to the single
// schema source file (src/contracts/result.ts) — this bypasses index.ts and
// never pulls engine.ts into the graph.
//
// `optimizeDeps.exclude` is load-bearing: without it Vite's dep scanner may
// decide to pre-bundle `@onevcat/argue` from its compiled dist/ entrypoint
// (which re-exports the engine) and the pre-bundled cache then wins against
// the alias on subsequent requests. Excluding it guarantees the alias is the
// one and only resolution path.
export default defineConfig({
  plugins: [preact()],
  resolve: {
    alias: {
      "@onevcat/argue": resolve(__dirname, "../argue/src/contracts/result.ts")
    }
  },
  optimizeDeps: {
    exclude: ["@onevcat/argue"]
  },
  test: {
    environment: "happy-dom"
  }
});
