import { describe, it, expect } from "vitest";
import { formatBugCode, cleanOptions, CODE_PREFIX_RE, DEFAULT_OPTIONS } from "@/lib/bug-workflow";

describe("formatBugCode", () => {
  it("keeps the padded number and uses the stored prefix", () => {
    expect(formatBugCode("42")).toBe("BF-000042");
    expect(formatBugCode("42", "DEPLOY")).toBe("DEPLOY-000042");
    expect(formatBugCode("123456", "PROD2")).toBe("PROD2-123456");
  });
  it("falls back to BF when the prefix is missing", () => {
    expect(formatBugCode("7", "")).toBe("BF-000007");
  });
});

describe("prefix options", () => {
  it("accepts 1-10 capitals/digits starting with a letter", () => {
    for (const ok of ["BF", "DEPLOY", "PROD2", "A"]) expect(CODE_PREFIX_RE.test(ok)).toBe(true);
    for (const bad of ["", "1BF", "bf", "TOOLONGPREFIX", "DE PLOY", "DE-PLOY"])
      expect(CODE_PREFIX_RE.test(bad)).toBe(false);
  });
  it("cleanOptions uppercases, dedupes and never returns an empty list", () => {
    const cleaned = cleanOptions({
      ...DEFAULT_OPTIONS,
      prefixes: ["deploy", "DEPLOY", "prod"],
    });
    expect(cleaned.prefixes).toEqual(["DEPLOY", "PROD"]);
    expect(cleanOptions({ ...DEFAULT_OPTIONS, prefixes: ["bad prefix"] }).prefixes).toEqual(["BF"]);
    expect(cleanOptions(null).prefixes).toEqual(["BF"]);
  });
});
