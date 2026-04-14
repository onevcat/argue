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

  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = base64UrlToBytes(data);
  } catch {
    throw new Error("Invalid base64url encoding in report hash.");
  }

  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    return await new Response(stream).text();
  } catch {
    throw new Error("Failed to decompress report data. The hash payload may be corrupt.");
  }
}

function base64UrlToBytes(encoded: string): Uint8Array<ArrayBuffer> {
  const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const padLength = (4 - (normalized.length % 4)) % 4;
  const padded = normalized + "=".repeat(padLength);
  const binary = atob(padded);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
