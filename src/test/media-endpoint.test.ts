import { describe, expect, it } from "vitest";
import { mediaStorageSchema, normalizeEndpoint } from "@/lib/bug-media";

describe("media storage endpoint input", () => {
  const id = "a1b2c3d4e5f67890a1b2c3d4e5f67890";
  it("accepts the S3 API URL as Cloudflare shows it, with or without scheme or bucket path", () => {
    for (const input of [
      `https://${id}.r2.cloudflarestorage.com`,
      `https://${id}.r2.cloudflarestorage.com/bugboard-media`,
      ` ${id}.r2.cloudflarestorage.com/ \n`,
    ])
      expect(normalizeEndpoint(input)).toBe(`https://${id}.r2.cloudflarestorage.com`);
  });
  it("explains a leftover placeholder and rejects plain http", () => {
    const base = {
      source: "custom",
      bucket: "bugboard-media",
      accessKeyId: "a",
      secretAccessKey: "b",
    };
    const placeholder = mediaStorageSchema.safeParse({
      ...base,
      endpoint: "https://<ACCOUNT_ID>.r2.cloudflarestorage.com",
    });
    expect(placeholder.success).toBe(false);
    expect(JSON.stringify(placeholder.error?.issues)).toContain("account ID");
    expect(mediaStorageSchema.safeParse({ ...base, endpoint: "http://example.com" }).success).toBe(
      false,
    );
    expect(
      mediaStorageSchema.safeParse({
        ...base,
        endpoint: `${id}.r2.cloudflarestorage.com/bugboard-media`,
      }).success,
    ).toBe(true);
  });
});
