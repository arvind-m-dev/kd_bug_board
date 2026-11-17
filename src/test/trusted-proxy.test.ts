import { describe, expect, it } from "vitest";
import { trustedProxyRequest } from "@/lib/trusted-proxy";

const behindTunnel = (headers: Record<string, string> = {}, init: RequestInit = {}) =>
  new Request("http://trial.example.dev/api/presence?x=1", {
    ...init,
    headers: { "x-forwarded-proto": "https", ...headers },
  });

describe("trusted proxy switch", () => {
  it("is off unless enabled: the request is passed through untouched", () => {
    const request = behindTunnel();
    expect(trustedProxyRequest(request, false)).toBe(request);
  });

  it("re-addresses a request the proxy received over https", () => {
    const out = trustedProxyRequest(behindTunnel({ cookie: "a=b" }), true);
    expect(out.url).toBe("https://trial.example.dev/api/presence?x=1");
    expect(new URL(out.url).origin).toBe("https://trial.example.dev");
    expect(out.headers.get("cookie")).toBe("a=b");
    expect(out.method).toBe("GET");
  });

  it("keeps the method and body of a save", async () => {
    const out = trustedProxyRequest(
      behindTunnel(
        { "content-type": "application/json" },
        { method: "POST", body: JSON.stringify({ hello: "world" }) },
      ),
      true,
    );
    expect(out.method).toBe("POST");
    expect(out.headers.get("content-type")).toBe("application/json");
    expect(await out.json()).toEqual({ hello: "world" });
  });

  it("uses the first hop when several proxies are listed", () => {
    const out = trustedProxyRequest(behindTunnel({ "x-forwarded-proto": "https, http" }), true);
    expect(new URL(out.url).protocol).toBe("https:");
  });

  it("leaves requests alone when the proxy did not see https", () => {
    const plain = new Request("http://localhost:8080/admin");
    expect(trustedProxyRequest(plain, true)).toBe(plain);
    const http = behindTunnel({ "x-forwarded-proto": "http" });
    expect(trustedProxyRequest(http, true)).toBe(http);
  });

  it("never changes the host, so another site's Origin still fails the same-origin check", () => {
    const out = trustedProxyRequest(behindTunnel({ origin: "https://evil.example" }), true);
    expect(new URL(out.url).origin).not.toBe(out.headers.get("origin"));
  });
});
