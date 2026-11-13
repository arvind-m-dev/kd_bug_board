import { afterEach, describe, expect, it, vi } from "vitest";

const outbox = vi.hoisted(() => ({ processJiraOutbox: vi.fn() }));
vi.mock("@/lib/jira/outbox.server", () => outbox);
import { kickJiraOutbox } from "@/lib/jira/kick.server";

const settle = () => new Promise((r) => setTimeout(r, 20));
afterEach(() => {
  vi.resetAllMocks();
  delete process.env["JIRA_SEND_ON_SAVE"];
});

describe("send to Jira right after a save", () => {
  it("runs one pass at a time and goes round once more for saves made meanwhile", async () => {
    let release!: () => void;
    outbox.processJiraOutbox.mockImplementationOnce(() => new Promise<void>((r) => (release = r)));
    outbox.processJiraOutbox.mockResolvedValue(undefined);
    kickJiraOutbox();
    await settle();
    kickJiraOutbox();
    kickJiraOutbox();
    expect(outbox.processJiraOutbox).toHaveBeenCalledTimes(1);
    release();
    await settle();
    expect(outbox.processJiraOutbox).toHaveBeenCalledTimes(2); // the two kicks merge into one more pass
    expect(outbox.processJiraOutbox).toHaveBeenLastCalledWith({ budgetMs: 8000 });
  });

  it("never throws into the save, and the next kick starts fresh", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    outbox.processJiraOutbox.mockRejectedValueOnce(new Error("Jira down"));
    expect(() => kickJiraOutbox()).not.toThrow();
    await settle();
    expect(log).toHaveBeenCalledWith("[jira-kick] Error");
    outbox.processJiraOutbox.mockResolvedValue(undefined);
    kickJiraOutbox();
    await settle();
    expect(outbox.processJiraOutbox).toHaveBeenCalledTimes(2);
  });

  it("can be switched off, leaving the scheduler to send", async () => {
    process.env["JIRA_SEND_ON_SAVE"] = "0";
    kickJiraOutbox();
    await settle();
    expect(outbox.processJiraOutbox).not.toHaveBeenCalled();
  });
});
