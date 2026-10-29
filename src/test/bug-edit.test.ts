import { beforeEach, describe, expect, it, vi } from "vitest";

// The database is replaced by a recorder: bugDetail reads one bug row, editBugReport's batch is captured.
const db = vi.hoisted(() => ({
  bug: {} as Record<string, unknown>,
  batches: [] as { query: string; params?: unknown[] }[][],
}));
vi.mock("@/lib/neon.server", () => ({
  neonQuery: vi.fn(async (query: string) => {
    if (query.includes("from bugflow.portals p join bugflow.users u"))
      return {
        rows: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            user_id: "22222222-2222-4222-8222-222222222222",
            type: "reporter",
            name: "Rae",
            permissions: ["view", "report", "comment"],
          },
        ],
      };
    if (query.includes("from bugflow.bugs b")) return { rows: [db.bug] };
    if (query.includes("dropdown_options")) return { rows: [] };
    return { rows: [] };
  }),
  neonExecute: vi.fn(async (batch: { query: string; params?: unknown[] }[]) => {
    db.batches.push(batch);
    return { results: batch.map((_, i) => ({ rows: i === 0 ? [{ bug_id: "7" }] : [] })) };
  }),
}));
vi.mock("@/lib/bug-media.server", () => ({ listMedia: vi.fn(async () => []) }));
vi.mock("@/lib/trash.server", () => ({ maybeExpireTrash: vi.fn(async () => undefined) }));
vi.mock("@tanstack/react-start/server", () => ({
  getRequest: () => {
    throw new Error("no request");
  },
  getCookie: () => undefined,
  setCookie: () => undefined,
  deleteCookie: () => undefined,
  setResponseHeader: () => undefined,
}));
import { editBugReport } from "@/lib/bug-workflow.server";

const access = { kind: "portal" as const, type: "reporter" as const, token: "a".repeat(64) };
const edit = (over: Record<string, unknown> = {}) => ({
  id: "7",
  version: "2026-10-27 09:00:00+00",
  title: "Save button",
  module: "",
  priority: "P3" as const,
  severity: "Medium",
  description: "Save does nothing",
  steps: ["Open", "Save"],
  expected: "",
  actual: "Nothing",
  browserDevice: "",
  environment: "",
  evidenceUrls: [],
  dueOn: null,
  codePrefix: null,
  ...over,
});

describe("Editing a bug report", () => {
  beforeEach(() => {
    db.batches = [];
    db.bug = {
      id: "7",
      title: "Save button",
      project_id: "p",
      project_name: "App",
      reporter_id: "22222222-2222-4222-8222-222222222222",
      reporter_name: "Rae",
      assignee_id: null,
      assignee_name: "Unassigned",
      status: "NEW",
      priority: "P3",
      severity: "Medium",
      description: "Save does nothing",
      expected: "",
      actual: "Nothing",
      browser_device: "",
      environment: "",
      fix_notes: "",
      version: "2026-10-27 09:00:00+00",
    };
  });
  it("refuses a reporter's priority or severity change (Admin decides those after reporting)", async () => {
    await expect(editBugReport(access, edit({ priority: "P0" }))).rejects.toThrow(
      /Only Admin can change priority or severity/,
    );
    await expect(editBugReport(access, edit({ severity: "Critical" }))).rejects.toThrow(
      /Only Admin can change priority or severity/,
    );
    expect(db.batches).toHaveLength(0);
  });
  it("applies details and steps only when its own version-checked update won", async () => {
    await expect(editBugReport(access, edit({ title: "Save button broken" }))).resolves.toEqual({
      saved: true,
    });
    const [batch] = db.batches;
    expect(batch).toHaveLength(4);
    const [first, ...rest] = batch!;
    // The audit row is inserted by the same statement as the guarded update…
    expect(first!.query).toMatch(/updated_at=\$2::timestamptz/);
    expect(first!.query).toMatch(/insert into bugflow\.activity[\s\S]*from u/);
    const marker = first!.params![10];
    // …and every later write is conditioned on that exact audit row, never on "updated since".
    for (const s of rest) {
      expect(s.query).not.toMatch(/updated_at>/);
      expect(s.query).toMatch(/exists\(select 1 from bugflow\.activity where id=\$\d::uuid\)/);
      expect(s.params).toContain(marker);
    }
  });
});
