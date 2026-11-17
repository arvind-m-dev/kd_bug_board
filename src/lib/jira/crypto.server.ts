// Encryption of Atlassian tokens at rest. A dedicated key (JIRA_TOKEN_ENCRYPTION_KEY, 32 random bytes as 64 hex
// characters) — never the portal key, the database URL or the Admin password. Each ciphertext is bound to its
// connection row and purpose, so a value copied to another row or column does not decrypt.

const KEY_RE = /^[a-f0-9]{64}$/i;
export const JIRA_KEY_VERSION = 1;
export type TokenPurpose = "access" | "refresh";

export const jiraKeyConfigured = () => KEY_RE.test(process.env["JIRA_TOKEN_ENCRYPTION_KEY"] ?? "");

async function key() {
  const hex = process.env["JIRA_TOKEN_ENCRYPTION_KEY"] ?? "";
  if (!KEY_RE.test(hex)) throw new Error("Jira token encryption is not configured.");
  const raw = Uint8Array.from(hex.match(/../g)!, (b) => parseInt(b, 16));
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}
const bound = (connectionId: string, purpose: TokenPurpose) =>
  new TextEncoder().encode(`bugflow.jira.v${JIRA_KEY_VERSION}:${connectionId}:${purpose}`);
function toBase64(bytes: Uint8Array) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export async function sealToken(token: string, connectionId: string, purpose: TokenPurpose) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: bound(connectionId, purpose) },
      await key(),
      new TextEncoder().encode(token),
    ),
  );
  const packed = new Uint8Array(iv.length + ct.length);
  packed.set(iv);
  packed.set(ct, iv.length);
  return `v${JIRA_KEY_VERSION}.${toBase64(packed)}`;
}

export async function openToken(sealed: string, connectionId: string, purpose: TokenPurpose) {
  const [version, body] = sealed.split(".");
  if (version !== `v${JIRA_KEY_VERSION}` || !body)
    throw new Error("Stored Jira token has an unknown format.");
  const bytes = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bytes.slice(0, 12), additionalData: bound(connectionId, purpose) },
      await key(),
      bytes.slice(12),
    ),
  );
}
