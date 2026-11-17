// A bearer token shaped like the one Atlassian sends with a webhook: a JWT signed with the app's client secret.

export const SECRET = "client-secret-of-the-app";
export const b64 = (bytes: Uint8Array | string) =>
  btoa(typeof bytes === "string" ? bytes : String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
export async function signed(
  claims: object,
  secret = SECRET,
  header: object = { alg: "HS256", typ: "JWT" },
) {
  const data = `${b64(JSON.stringify(header))}.${b64(JSON.stringify(claims))}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)),
  );
  return `${data}.${b64(signature)}`;
}
