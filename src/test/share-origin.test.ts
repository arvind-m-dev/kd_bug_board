import { afterEach, describe, expect, it, vi } from "vitest";
import { shareOrigin } from "@/lib/share-origin";

const at = (url: string) =>
  vi.stubGlobal("location", new URL(url) as unknown as Location) as unknown;

describe("Links copied for other people", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
  it("use the live site when copied on a local dev server", () => {
    vi.stubEnv("VITE_SITE_URL", "https://bugs.example.com/");
    at("http://localhost:8080/admin/users");
    expect(shareOrigin()).toBe("https://bugs.example.com");
  });
  it("keep the current address on the live site", () => {
    vi.stubEnv("VITE_SITE_URL", "https://bugs.example.com");
    at("https://preview.example.app/admin");
    expect(shareOrigin()).toBe("https://preview.example.app");
  });
  it("fall back to the current address when no live site is configured", () => {
    vi.stubEnv("VITE_SITE_URL", "");
    at("http://localhost:8080/admin");
    expect(shareOrigin()).toBe("http://localhost:8080");
  });
});
