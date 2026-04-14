/// <reference types="vitest/config" />
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import preact from "@preact/preset-vite";
import { defineConfig } from "vite";

// Display the @onevcat/argue library version in the viewer footer.
// The viewer package itself is `private: true` and its own version is
// a placeholder — what users care about is "which Argue build is this
// rendering", which is the library that owns the result schema.
const arguePkg = JSON.parse(readFileSync(resolve(__dirname, "../argue/package.json"), "utf8")) as {
  version: string;
};

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
  define: {
    __ARGUE_VERSION__: JSON.stringify(arguePkg.version)
  },
  resolve: {
    alias: {
      "@onevcat/argue": resolve(__dirname, "../argue/src/contracts/result.ts")
    }
  },
  optimizeDeps: {
    exclude: ["@onevcat/argue"]
  },
  test: {
    environment: "happy-dom",
    setupFiles: ["./test/setup.ts"]
  }
});
