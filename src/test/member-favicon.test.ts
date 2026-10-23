import { describe, expect, it } from "vitest";
import { memberFaviconSvg, memberHue, memberInitials } from "@/hooks/use-member-favicon";

describe("member favicon", () => {
  it("uses first and last initials", () => {
    expect(memberInitials("Priya Raman Iyer")).toBe("PI");
    expect(memberInitials("arvind")).toBe("AR");
    expect(memberInitials("  ")).toBe("?");
  });
  it("gives each member a stable colour", () => {
    expect(memberHue("1A2B3C4D")).toBe(memberHue("1A2B3C4D"));
    expect(memberHue("1A2B3C4D")).not.toBe(memberHue("9F8E7D6C"));
  });
  it("strips markup from names", () => {
    expect(memberFaviconSvg("<x> y", "AB")).not.toContain("<x>");
  });
});

describe("panel badge", () => {
  it("gives each panel type its own badge on top of the member colour, and a title that names the panel", async () => {
    const { PANEL_BADGES, panelLabel } = await import("@/hooks/use-member-favicon");
    const plain = memberFaviconSvg("Jenith Kumar", "1A2B3C4D");
    const reporter = memberFaviconSvg("Jenith Kumar", "1A2B3C4D", "reporter");
    const developer = memberFaviconSvg("Jenith Kumar", "1A2B3C4D", "developer");
    expect(plain).not.toContain("<circle");
    expect(reporter).toContain(">R<");
    expect(developer).toContain(">D<");
    expect(reporter).not.toBe(developer);
    expect(reporter).toContain(PANEL_BADGES["reporter"]!.color);
    expect(reporter).toContain(`hsl(${memberHue("1A2B3C4D")} 65% 42%)`); // the member colour stays the same across panels
    expect(panelLabel("qa")).toBe("QA portal");
    expect(panelLabel(undefined)).toBe("Portal");
    expect(panelLabel("nope")).toBe("Portal");
    expect(memberFaviconSvg("<b>x</b>", "Z", "qa")).not.toContain("<b>");
  });
});
