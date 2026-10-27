import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/neon.server", () => ({ neonQuery: vi.fn(), neonExecute: vi.fn() }));
import { corsBlockedOrigins } from "@/lib/bug-media.server";

const cfg = {
  endpoint: "https://acct.r2.cloudflarestorage.com",
  bucket: "media",
  region: "auto",
  forcePathStyle: true,
  accessKeyId: "k",
  secretAccessKey: "s",
};
// A bucket whose CORS rule allows only the local dev server, as found on the connected R2 bucket.
const bucket = vi.fn(async (_url: string, init: RequestInit) => {
  const origin = new Headers(init.headers).get("Origin");
  return origin === "http://localhost:8080"
    ? new Response(null, { status: 204, headers: { "access-control-allow-origin": origin } })
    : new Response(null, { status: 403 });
});

describe("Bucket CORS check", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("names the app addresses the bucket refuses, asking the browser's own preflight question", async () => {
    vi.stubGlobal("fetch", bucket);
    expect(
      await corsBlockedOrigins(cfg, ["http://localhost:8080", "https://bugs.example.com"]),
    ).toEqual(["https://bugs.example.com"]);
    const [url, init] = bucket.mock.calls[0]!;
    expect(url).toBe("https://acct.r2.cloudflarestorage.com/media/bugs/cors-check.jpg");
    expect(init.method).toBe("OPTIONS");
    expect(new Headers(init.headers).get("Access-Control-Request-Headers")).toBe(
      "content-type,if-none-match",
    );
  });
  it("never blocks a setup it cannot ask", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("network");
      }),
    );
    expect(await corsBlockedOrigins(cfg, ["https://bugs.example.com"])).toEqual([]);
  });
});
