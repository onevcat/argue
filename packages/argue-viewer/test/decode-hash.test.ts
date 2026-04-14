import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { decodeHashPayload } from "../src/lib/decode-hash.js";

function encodeForHash(payload: string): string {
  const gz = gzipSync(Buffer.from(payload, "utf8"));
  return gz.toString("base64url");
}

describe("decodeHashPayload", () => {
  it("returns null for an empty hash", async () => {
    expect(await decodeHashPayload("")).toBeNull();
    expect(await decodeHashPayload("#")).toBeNull();
  });

  it("decodes a v=1 gzip+base64url payload back to the original JSON string", async () => {
    const json = JSON.stringify({ hello: "world", n: 42 });
    const hash = `#v=1&d=${encodeForHash(json)}`;
    const decoded = await decodeHashPayload(hash);
    expect(decoded).toBe(json);
  });

  it("rejects an unsupported version", async () => {
    const json = JSON.stringify({ hello: "world" });
    const hash = `#v=2&d=${encodeForHash(json)}`;
    await expect(decodeHashPayload(hash)).rejects.toThrow(/Unsupported/);
  });

  it("rejects a missing data segment", async () => {
    await expect(decodeHashPayload("#v=1")).rejects.toThrow(/Missing/);
  });

  it("rejects garbage base64url", async () => {
    await expect(decodeHashPayload("#v=1&d=@@@@not base64@@@@")).rejects.toThrow(/base64/i);
  });

  it("rejects valid base64url that is not a gzip stream", async () => {
    // "hello world" in base64url — valid base64, decodes to 11 bytes of ASCII that is NOT gzip-framed.
    await expect(decodeHashPayload("#v=1&d=aGVsbG8gd29ybGQ")).rejects.toThrow(/decompress|corrupt/i);
  });
});
