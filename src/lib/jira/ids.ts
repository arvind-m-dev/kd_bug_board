/**
 * A UUID derived from the given parts: the same parts always give the same id. Used as the request id of a
 * change the integration makes, so a repeat of the very same change is recognised and written once.
 */
export async function derivedUuid(...parts: string[]): Promise<string> {
  const hash = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(parts.join("\u0000"))),
  );
  const b = [...hash.slice(0, 16)];
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x50; // version 5 (name-based)
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80; // RFC 4122 variant
  const hex = b.map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
