import { describe, expect, it } from "vitest";
import { brandTokens, cssOklchToHex, hexToOklch, oklchToHex, parseHex } from "@/lib/color";

describe("colour maths", () => {
  it("parses short and long hex", () => {
    expect(parseHex("#fff")).toEqual([255, 255, 255]);
    expect(parseHex("0E4F63")).toEqual([14, 79, 99]);
    expect(parseHex("#12")).toBeNull();
  });
  it("converts sRGB to OKLCH with the expected lightness and hue", () => {
    expect(hexToOklch("#ffffff")!.l).toBeCloseTo(1, 2);
    expect(hexToOklch("#000000")!.l).toBeCloseTo(0, 2);
    const red = hexToOklch("#ff0000")!;
    expect(red.h).toBeGreaterThan(25);
    expect(red.h).toBeLessThan(33);
    expect(red.c).toBeGreaterThan(0.2);
    const teal = hexToOklch("#0e4f63")!;
    expect(teal.h).toBeGreaterThan(200);
    expect(teal.h).toBeLessThan(235);
    expect(teal.l).toBeLessThan(0.45);
  });
  it("round-trips through hex within one step per channel", () => {
    for (const hex of ["#0e4f63", "#e9c868", "#52606d", "#ff6600", "#3366cc"]) {
      const back = oklchToHex(hexToOklch(hex)!);
      const a = parseHex(hex)!,
        b = parseHex(back)!;
      for (let i = 0; i < 3; i++) expect(Math.abs(a[i]! - b[i]!)).toBeLessThanOrEqual(1);
    }
  });
  it("pins lightness per mode and caps chroma so any accent keeps readable text", () => {
    const light = brandTokens("#ff0000", null, false);
    const dark = brandTokens("#ff0000", null, true);
    expect(light.primary).toMatch(/^oklch\(0\.5 0\.19 /);
    expect(light.primaryForeground).toBe("oklch(1 0 0)");
    expect(dark.primary).toMatch(/^oklch\(0\.78 0\.15 /);
    expect(dark.primaryForeground).toMatch(/^oklch\(0\.19 /);
    expect(brandTokens("#777777", null, false).primary).toMatch(/^oklch\(0\.5 0\.02 /);
    expect(brandTokens("#0e4f63", "#e9c868", false).brand2).toMatch(/ (8\d|9\d)(\.\d)?\)$/);
  });
  it("turns a preset token into a hex a colour input can show", () => {
    expect(cssOklchToHex("oklch(0.5 0.1 192)")).toMatch(/^#[0-9a-f]{6}$/);
    expect(cssOklchToHex("red")).toBeNull();
  });
});
