import { describe, expect, it } from "vitest";
import { MemorySessionStore } from "../src/store/memory-store.js";

describe("MemorySessionStore", () => {
  it("saves and loads by sessionId", async () => {
    const store = new MemorySessionStore();

    await store.save({ sessionId: "s1", state: "created" });

    await expect(store.load("s1")).resolves.toEqual({ sessionId: "s1", state: "created" });
    await expect(store.load("missing")).resolves.toBeNull();
  });

  it("merges object patch and wraps non-object patch", async () => {
    const store = new MemorySessionStore();
    await store.save({ sessionId: "s2", state: "created", retries: 0 });

    await store.update("s2", { state: "running", retries: 1 });
    await expect(store.load("s2")).resolves.toEqual({ sessionId: "s2", state: "running", retries: 1 });

    await store.update("s2", "raw-patch");
    await expect(store.load("s2")).resolves.toEqual({
      sessionId: "s2",
      state: "running",
      retries: 1,
      patch: "raw-patch"
    });
  });

  it("rejects save without non-empty sessionId", async () => {
    const store = new MemorySessionStore();
    await expect(store.save({})).rejects.toThrow(/session object must contain a non-empty sessionId/);
    await expect(store.save({ sessionId: "" })).rejects.toThrow(/session object must contain a non-empty sessionId/);
  });
});
