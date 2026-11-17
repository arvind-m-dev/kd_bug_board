/**
 * Behind an HTTPS tunnel or a reverse proxy that ends TLS, this server receives plain http, so the same-origin
 * checks compare the browser's `https://…` Origin with an `http://…` request address and refuse every sign-in and
 * save. With BUGFLOW_TRUST_PROXY=1 the proxy's `X-Forwarded-Proto: https` is believed and the request is
 * re-addressed as https; nothing else about it changes.
 *
 * Off by default and meant for a local trial behind a tunnel: turn it on only where every request really arrives
 * through that proxy. Hosts that already present https (Vercel) need nothing and are unaffected.
 */
export function trustedProxyRequest(
  request: Request,
  enabled = process.env["BUGFLOW_TRUST_PROXY"] === "1",
): Request {
  if (!enabled) return request;
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  if (proto !== "https") return request;
  const url = new URL(request.url);
  if (url.protocol !== "http:") return request;
  url.protocol = "https:";
  const init: RequestInit & { duplex?: "half" } = {
    method: request.method,
    headers: request.headers,
    signal: request.signal,
    redirect: request.redirect,
  };
  if (request.body) {
    init.body = request.body;
    init.duplex = "half";
  }
  return new Request(url, init);
}
