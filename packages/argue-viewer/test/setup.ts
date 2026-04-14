// happy-dom does not implement DecompressionStream.
// Node 18+ exposes it as a global; assign it into the test window so that
// modules that call `new DecompressionStream(...)` work under vitest.
if (typeof DecompressionStream !== "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).DecompressionStream = DecompressionStream;
}
