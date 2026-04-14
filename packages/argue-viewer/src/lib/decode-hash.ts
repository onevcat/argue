/**
 * Returns the original JSON string carried in the hash, or null if the hash
 * is empty. Throws with a descriptive message for unsupported versions,
 * missing fields, or decoding failures.
 *
 * Expected hash shape: `#v=1&d=<gzip-then-base64url encoded JSON>`.
 */
export async function decodeHashPayload(hash: string): Promise<string | null> {
  if (!hash || hash === "#") return null;
  const trimmed = hash.startsWith("#") ? hash.slice(1) : hash;
  const params = new URLSearchParams(trimmed);
  if (!params.has("v") && !params.has("d")) return null;

  const version = params.get("v");
  if (version !== "1") {
    throw new Error(`Unsupported report hash version: ${version ?? "<missing>"}`);
  }
  const data = params.get("d");
  if (!data) {
    throw new Error("Missing data (`d=`) in report hash.");
  }

  const bytes = base64UrlToBytes(data);
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return await new Response(stream).text();
}

function base64UrlToBytes(encoded: string): Uint8Array {
  const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const padLength = (4 - (normalized.length % 4)) % 4;
  const padded = normalized + "=".repeat(padLength);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
