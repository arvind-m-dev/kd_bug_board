import { describe, expect, it } from "vitest";
import { jobAuthorized } from "@/lib/jira/routes.server";

const SECRET = "s".repeat(40);
const request = (headers: Record<string, string>) =>
  new Request("http://localhost/api/internal/jira/process", { method: "POST", headers });

describe("Jira job endpoint authorization", () => {
  it("accepts only the configured bearer secret", async () => {
    expect(await jobAuthorized(request({ authorization: `Bearer ${SECRET}` }), SECRET)).toBe("ok");
    expect(await jobAuthorized(request({ authorization: `Bearer ${SECRET}x` }), SECRET)).toBe(
      "denied",
    );
    expect(await jobAuthorized(request({ authorization: SECRET }), SECRET)).toBe("denied");
    expect(await jobAuthorized(request({}), SECRET)).toBe("denied");
  });

  it("gives a signed-in browser no authority", async () => {
    const cookies = { cookie: "bugflow_admin=anything", origin: "http://localhost" };
    expect(await jobAuthorized(request(cookies), SECRET)).toBe("denied");
  });

  it("stays closed without a secret, or with one too short to be a secret", async () => {
    expect(await jobAuthorized(request({ authorization: "Bearer " }), "")).toBe("not_configured");
    expect(await jobAuthorized(request({ authorization: "Bearer short" }), "short")).toBe(
      "not_configured",
    );
    expect(await jobAuthorized(request({ authorization: `Bearer ${SECRET}` }), undefined)).toBe(
      process.env["JIRA_JOB_SECRET"] ? "denied" : "not_configured",
    );
  });
});
