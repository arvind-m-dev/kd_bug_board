import { describe, expect, it } from "vitest";
import { parsePortalUrl } from "@/lib/oauth-consent";

describe("oauth helpers", () => {
  it("parses a portal url into token and type, and rejects anything else", () => {
    const t = "a".repeat(64);
    expect(parsePortalUrl(`https://bugs.example.com/member/${t}`)).toEqual({
      type: "member",
      token: t,
    });
    expect(parsePortalUrl(`https://bugs.example.com/qa/${t}/`)).toEqual({ type: "qa", token: t });
    expect(parsePortalUrl(`https://bugs.example.com/admin/${t}`)).toBeNull();
    expect(parsePortalUrl(`https://bugs.example.com/member/short`)).toBeNull();
    expect(parsePortalUrl("not a url")).toBeNull();
    expect(parsePortalUrl(`https://x/member/${t}?q=1`)).toEqual({ type: "member", token: t }); // a query string is ignored
  });
});
