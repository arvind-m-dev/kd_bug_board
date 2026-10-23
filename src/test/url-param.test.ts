import { describe, expect, it } from "vitest";
import { readParam } from "@/hooks/use-url-param";

describe("URL state parameters", () => {
  it("reads plain values and the router's JSON-quoted form alike", () => {
    expect(readParam("123")).toBe("123");
    expect(readParam('"123"')).toBe("123");
    expect(readParam(decodeURIComponent("%22123%22"))).toBe("123");
    expect(readParam("media")).toBe("media");
    expect(readParam("")).toBeNull();
    expect(readParam(null)).toBeNull();
  });
});
