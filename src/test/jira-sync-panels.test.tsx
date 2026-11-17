import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  getJiraOverviewFn: vi.fn(),
  resolveJiraConflictFn: vi.fn(),
  retryJiraParkedFn: vi.fn(),
  syncJiraNowFn: vi.fn(),
  getJiraResourcesFn: vi.fn(),
  getJiraProjectShapeFn: vi.fn(),
  saveJiraMappingFn: vi.fn(),
  previewJiraMappingFn: vi.fn(),
  activateJiraMappingFn: vi.fn(),
  pauseJiraMappingFn: vi.fn(),
  previewJiraInitialSyncFn: vi.fn(),
  startJiraInitialSyncFn: vi.fn(),
  getJiraPeopleFn: vi.fn(),
  findJiraAccountsFn: vi.fn(),
  linkJiraPersonFn: vi.fn(),
  unlinkJiraPersonFn: vi.fn(),
  matchJiraPeopleFn: vi.fn(),
  syncJiraMembersFn: vi.fn(),
  getJiraOnlyPeopleFn: vi.fn(),
  linkJiraPersonByEmailFn: vi.fn(),
  getJiraSyncLogFn: vi.fn(),
  applyJiraNameFn: vi.fn(),
  getJiraDuplicatesFn: vi.fn(),
  ignoreJiraDuplicateFn: vi.fn(),
  linkJiraDuplicateFn: vi.fn(),
}));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@/lib/jira/jira.functions", () => api);
vi.mock("@/components/bugflow/collaborator-onboarding", () => ({
  CollaboratorOnboarding: ({
    initial,
    onSaved,
  }: {
    initial?: { name: string; email: string };
    onSaved?: (saved: { email: string }) => void;
  }) => (
    <button type="button" onClick={() => onSaved?.({ email: initial?.email ?? "" })}>
      Save member {initial?.name} {initial?.email}
    </button>
  ),
}));
import {
  JiraDuplicates,
  JiraHealth,
  JiraPeople,
  JiraProjects,
  JiraSyncLog,
} from "@/components/bugflow/jira-sync";
import type { JiraOverview } from "@/lib/jira/admin.server";
import {
  bugType,
  createFields,
  createMetaSchema,
  issueTypes,
  projectStatusesSchema,
  suggestConfig,
} from "@/lib/jira/discovery";
import { CREATE_META_REPLY, PRIORITIES_REPLY, STATUSES_REPLY } from "./jira-shapes";

const PROJECT = "bbbbbbbb-0000-4000-8000-000000000001";
const types = issueTypes(projectStatusesSchema.parse(STATUSES_REPLY));
const fields = createFields(createMetaSchema.parse(CREATE_META_REPLY).fields);
const suggestion = suggestConfig(bugType(types)!.statuses, PRIORITIES_REPLY, fields)!;
const shape = {
  project: { id: "10000", key: "BFT", name: "BugFlow Trial" },
  issueTypes: types,
  issueTypeId: "10004",
  fields,
  suggestion,
};
const resources = (mappings: unknown[] = []) => ({
  jiraProjects: [{ id: "10000", key: "BFT", name: "BugFlow Trial" }],
  projects: [{ id: PROJECT, name: "Checkout" }],
  mappings,
});
const mapping = (state: string) => ({
  projectId: PROJECT,
  projectName: "Checkout",
  jiraProjectId: "10000",
  jiraProjectKey: "BFT",
  issueTypeId: "10004",
  state,
  config: suggestion,
  queue: { waiting: 2, parked: 0, conflicts: 1 },
});
const overview = (over: Partial<JiraOverview> = {}): JiraOverview => ({
  queue: { toJira: 1, fromJira: 0, parked: 0 },
  conflicts: [],
  parked: [],
  lastEventAt: null,
  lastReconciledAt: null,
  notificationsUntil: null,
  linked: 4,
  ...over,
});
const conflict = (over = {}) => ({
  id: "c1",
  bugId: "41",
  bugCode: "BF-41",
  bugTitle: "Checkout button does nothing",
  issueKey: "BFT-1",
  field: "title",
  reason: "both_changed",
  local: "Bug Board title",
  remote: "Jira title",
  createdAt: "2026-11-06T10:00:00.000Z",
  ...over,
});

function show(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}
beforeEach(() => vi.resetAllMocks());
afterEach(cleanup);

describe("Sync panel", () => {
  it("shows what is waiting and each conflict in plain words with both values", async () => {
    api.getJiraOverviewFn.mockResolvedValue(overview({ conflicts: [conflict()] }));
    show(<JiraHealth />);
    expect(await screen.findByText("4 bugs linked to Jira issues")).toBeInTheDocument();
    expect(screen.getByText(/Waiting to go to Jira: 1/)).toBeInTheDocument();
    expect(screen.getByText("Changed in both places, to different values.")).toBeInTheDocument();
    expect(screen.getByText("Bug Board title")).toBeInTheDocument();
    expect(screen.getByText("Jira title")).toBeInTheDocument();
    expect(screen.getByText(/picked up by the regular check/)).toBeInTheDocument();
  });

  it("records the Admin's decision and shows what the server returned, not a guess", async () => {
    api.getJiraOverviewFn.mockResolvedValue(overview({ conflicts: [conflict()] }));
    api.resolveJiraConflictFn.mockResolvedValue(overview({ conflicts: [] }));
    show(<JiraHealth />);
    fireEvent.click(await screen.findByRole("button", { name: "Use Jira's" }));
    await waitFor(() => expect(screen.queryByText("Jira title")).not.toBeInTheDocument());
    expect(api.resolveJiraConflictFn).toHaveBeenCalledWith({
      data: { conflictId: "c1", resolution: "use_jira" },
    });
  });

  it("keeps the conflict on screen and says why when the decision fails", async () => {
    api.getJiraOverviewFn.mockResolvedValue(overview({ conflicts: [conflict()] }));
    api.resolveJiraConflictFn.mockRejectedValue(
      new Error("This conflict was already settled. Refresh the list."),
    );
    show(<JiraHealth />);
    fireEvent.click(await screen.findByRole("button", { name: "Use Bug Board's" }));
    expect(
      await screen.findByText("This conflict was already settled. Refresh the list."),
    ).toBeInTheDocument();
    expect(screen.getByText("Jira title")).toBeInTheDocument();
  });

  it("offers only unlinking for an issue that left the project, and only what can work for too-long text", async () => {
    api.getJiraOverviewFn.mockResolvedValue(
      overview({
        conflicts: [
          conflict({ id: "c2", field: "link", reason: "moved_out_of_project" }),
          conflict({ id: "c3", reason: "too_long_for_bugflow" }),
        ],
      }),
    );
    show(<JiraHealth />);
    await screen.findByText(/moved to another Jira project/);
    expect(screen.getAllByRole("button", { name: "Unlink" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Use Jira's" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Use Bug Board's" })).not.toBeInTheDocument();
  });

  it("lists stopped work with its reason and offers to try it again", async () => {
    api.getJiraOverviewFn.mockResolvedValue(
      overview({
        queue: { toJira: 0, fromJira: 0, parked: 1 },
        parked: [
          {
            id: "p1",
            direction: "to_jira",
            subject: "BF-41",
            error: "Jira rejected the request. The mapping needs checking.",
            at: "",
          },
        ],
      }),
    );
    api.retryJiraParkedFn.mockResolvedValue({ retried: 1, overview: overview() });
    show(<JiraHealth />);
    expect(await screen.findByText(/Could not send to Jira · BF-41/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try stopped work again" }));
    await waitFor(() =>
      expect(screen.queryByText(/Could not send to Jira/)).not.toBeInTheDocument(),
    );
  });

  it("says so and offers a retry when the status cannot be read", async () => {
    api.getJiraOverviewFn.mockRejectedValueOnce(
      new Error("The database is temporarily unavailable. Try again in a moment."),
    );
    api.getJiraOverviewFn.mockResolvedValue(overview());
    show(<JiraHealth />);
    expect(await screen.findByText(/temporarily unavailable/)).toBeInTheDocument();
    expect(screen.queryByText(/bugs linked/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("4 bugs linked to Jira issues")).toBeInTheDocument();
  });
});

describe("Projects panel", () => {
  it("lists nothing made up: an unreadable Jira shows the error and a retry", async () => {
    api.getJiraResourcesFn.mockRejectedValue(
      new Error("Jira could not be reached. It will be tried again."),
    );
    show(<JiraProjects canEdit />);
    expect(
      await screen.findByText("Jira could not be reached. It will be tried again."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/No project is synchronized yet/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Map a project" })).not.toBeInTheDocument();
  });

  it("fills the mapping from Jira's real statuses and saves exactly what is shown", async () => {
    api.getJiraResourcesFn.mockResolvedValue(resources());
    api.getJiraProjectShapeFn.mockResolvedValue(shape);
    api.saveJiraMappingFn.mockResolvedValue(mapping("draft"));
    show(<JiraProjects canEdit />);
    fireEvent.click(await screen.findByRole("button", { name: "Map a project" }));
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Jira project"), { target: { value: "10000" } });
    const retest = (await screen.findByLabelText(
      "Jira status for Ready for QA retest",
    )) as HTMLSelectElement;
    expect(retest.value).toBe("10002"); // In Review
    expect(
      within(retest)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["To Do", "In Progress", "In Review", "Done"]);
    expect(save).toBeDisabled(); // no Bug Board project chosen yet
    fireEvent.change(screen.getByLabelText("Bug Board project"), { target: { value: PROJECT } });
    fireEvent.change(screen.getByLabelText("Jira status for Assigned"), {
      target: { value: "10001" },
    });
    fireEvent.click(save);
    await waitFor(() => expect(api.saveJiraMappingFn).toHaveBeenCalledTimes(1));
    const sent = api.saveJiraMappingFn.mock.calls[0]![0].data;
    expect(sent).toMatchObject({
      projectId: PROJECT,
      jiraProjectId: "10000",
      issueTypeId: "10004",
    });
    expect(sent.config.statusOut).toMatchObject({
      ASSIGNED: "10001",
      RECHECK: "10002",
      RESOLVED: "10003",
    });
    expect(sent.config.statusIn).toEqual(suggestion.statusIn);
    expect(sent.config.inbound.resolveFromRecheck).toBe(false);
  });

  it("checks a saved mapping against Jira and lists what is missing before it can be switched on", async () => {
    api.getJiraResourcesFn.mockResolvedValue(resources([mapping("draft")]));
    api.activateJiraMappingFn.mockResolvedValue({
      mapping: mapping("draft"),
      problems: [
        "Jira's Bug create screen has no Labels field; BugFlow needs it to never create the same issue twice.",
      ],
      bugs: 3,
    });
    show(<JiraProjects canEdit />);
    expect(await screen.findByText("Checkout ↔ Jira BFT")).toBeInTheDocument();
    expect(screen.getByText("Draft")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Switch on" }));
    expect(await screen.findByText(/has no Labels field/)).toBeInTheDocument();
    expect(screen.queryByText(/ready\./)).not.toBeInTheDocument();
  });

  it("shows what a first sync moves each way, and queues it only after confirming", async () => {
    api.getJiraResourcesFn.mockResolvedValue(resources([mapping("active")]));
    const count = {
      toJiraOpen: 3,
      toJiraFinished: 2,
      fromJira: 4,
      fromJiraDoneSkipped: 1,
      more: false,
    };
    api.previewJiraInitialSyncFn.mockResolvedValue(count);
    api.startJiraInitialSyncFn.mockResolvedValue(count);
    show(<JiraProjects canEdit />);
    fireEvent.click(await screen.findByRole("button", { name: "Sync existing bugs" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(
      "5 Bug Board bugs will be created in Jira (3 open, 2 finished",
    );
    expect(dialog).toHaveTextContent("4 Jira issues will be created in Bug Board.");
    expect(dialog).toHaveTextContent("1 Jira issue already Done in Jira stay out");
    expect(api.startJiraInitialSyncFn).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Sync existing bugs" }));
    expect(await screen.findByText(/Queued: 5 to Jira · 4 from Jira/)).toBeInTheDocument();
    expect(api.startJiraInitialSyncFn).toHaveBeenCalledWith({ data: { projectId: PROJECT } });
  });

  it("does not offer changes while the connection is paused", async () => {
    api.getJiraResourcesFn.mockResolvedValue(resources([mapping("active")]));
    show(<JiraProjects canEdit={false} />);
    expect(await screen.findByText("On")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pause" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Map a project" })).not.toBeInTheDocument();
  });
});

describe("People panel", () => {
  const people = (accountId: string | null) => [
    {
      userId: "u1",
      name: "Ravi",
      role: "developer",
      accountId,
      jiraName: accountId ? "Ravi K" : null,
      links: 1,
    },
  ];

  it("links a member only to the account the Admin picks from Jira's own list", async () => {
    api.getJiraPeopleFn.mockResolvedValue(people(null));
    api.findJiraAccountsFn.mockResolvedValue([{ accountId: "acc-ravi", name: "Ravi K" }]);
    api.linkJiraPersonFn.mockResolvedValue(people("acc-ravi"));
    show(<JiraPeople canSearch />);
    expect(await screen.findByText(/Not linked: shown in Jira by name only/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Link to Jira" }));
    fireEvent.click(screen.getByRole("button", { name: "Search Jira" }));
    fireEvent.click(await screen.findByRole("button", { name: "This is Ravi K" }));
    expect(await screen.findByText(/Jira account: Ravi K/)).toBeInTheDocument();
    expect(api.findJiraAccountsFn).toHaveBeenCalledWith({ data: { query: "Ravi" } });
    expect(api.linkJiraPersonFn).toHaveBeenCalledWith({
      data: { userId: "u1", accountId: "acc-ravi", name: "Ravi K" },
    });
  });

  it("syncs members, says how many were linked by email, and reports likely duplicates", async () => {
    api.getJiraPeopleFn.mockResolvedValue(people(null));
    api.getJiraOnlyPeopleFn.mockResolvedValue([]);
    api.syncJiraMembersFn.mockResolvedValue({
      linked: 1,
      people: [
        ...people("acc-ravi"),
        { userId: "u2", name: "Meera", role: "qa", accountId: null, jiraName: null, links: 2 },
        { userId: "u3", name: "meera ", role: "qa", accountId: null, jiraName: null, links: 1 },
      ],
      jira: [
        { accountId: "acc-ravi", name: "Ravi K", email: null, member: "Ravi" },
        { accountId: "acc-sam", name: "Sam", email: null, member: null },
      ],
      report: {},
    });
    show(<JiraPeople canSearch />);
    fireEvent.click(await screen.findByRole("button", { name: "Sync members" }));
    expect(await screen.findByText(/linked 1 member by email/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1 linked" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "2 only in Bug Board" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1 only in Jira" })).toBeInTheDocument();
    // A count filters the list: only the two unlinked members remain.
    fireEvent.click(screen.getByRole("button", { name: "2 only in Bug Board" }));
    expect(screen.getByText("Showing 2 of 3")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search people" }), {
      target: { value: "zzz" },
    });
    expect(screen.getByText("Showing 0 of 3")).toBeInTheDocument();
    expect(screen.getByText(/Check these \(3\)/)).toBeInTheDocument();
    expect(screen.getByText(/has 2 working portal links/)).toBeInTheDocument();
    expect(screen.getByText(/2 Bug Board members are named/)).toBeInTheDocument();
    // Jira owns names: the Admin can take Jira's, one member at a time.
    api.applyJiraNameFn.mockResolvedValue({
      name: "Ravi K",
      people: [{ ...people("acc-ravi")[0]!, name: "Ravi K" }],
    });
    fireEvent.click(screen.getByRole("button", { name: "Use Jira name Ravi K for Ravi" }));
    await waitFor(() =>
      expect(api.applyJiraNameFn).toHaveBeenCalledWith({ data: { userId: "u1" } }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /Use Jira name/ })).not.toBeInTheDocument(),
    );
  });

  it("lists Jira people with their status and adds one only through the Admin's own form", async () => {
    api.getJiraPeopleFn.mockResolvedValue(people(null));
    api.getJiraOnlyPeopleFn.mockResolvedValue([
      { accountId: "acc-meera", name: "Meera S", email: "meera@example.com", member: null },
      { accountId: "acc-ravi", name: "Ravi K", email: null, member: "Ravi" },
    ]);
    api.linkJiraPersonByEmailFn.mockResolvedValue(people("acc-meera"));
    show(<JiraPeople canSearch />);
    fireEvent.click(await screen.findByRole("tab", { name: /People in Jira/ }));
    expect(await screen.findByText("Meera S")).toBeInTheDocument();
    expect(screen.getByText("✓ Added to Bug Board")).toBeInTheDocument();
    expect(screen.getByText("In Bug Board as Ravi")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Add to Bug Board" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Add to Bug Board" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Save member Meera S meera@example.com" }),
    );
    await waitFor(() =>
      expect(api.linkJiraPersonByEmailFn).toHaveBeenCalledWith({
        data: { email: "meera@example.com", accountId: "acc-meera", name: "Meera S" },
      }),
    );
  });

  it("says when Jira knows nobody by that name", async () => {
    api.getJiraPeopleFn.mockResolvedValue(people(null));
    api.findJiraAccountsFn.mockResolvedValue([]);
    show(<JiraPeople canSearch />);
    fireEvent.click(await screen.findByRole("button", { name: "Link to Jira" }));
    fireEvent.click(screen.getByRole("button", { name: "Search Jira" }));
    expect(await screen.findByText(/Jira found nobody by that name/)).toBeInTheDocument();
  });
});

describe("Sync log panel", () => {
  const entry = (over = {}) => ({
    id: "e1",
    at: "2026-11-13T08:00:00.000Z",
    kind: "to_jira",
    who: "Rohan Mehta",
    text: "Sent title to Jira",
    bugId: "59",
    bugCode: "BF-000059",
    issueKey: "SCRUM-36",
    ...over,
  });

  it("lists each change with its direction, who caused it and the bug and issue", async () => {
    api.getJiraSyncLogFn.mockResolvedValue([
      entry(),
      entry({ id: "e2", kind: "from_jira", who: "Jira", text: "Took priority from Jira" }),
    ]);
    show(<JiraSyncLog />);
    const log = await screen.findByRole("list", { name: "Sync log" });
    expect(within(log).getByText(/Sent title to Jira/)).toBeTruthy();
    expect(within(log).getByText("→ Jira")).toBeTruthy();
    expect(within(log).getByText("← Jira")).toBeTruthy();
    expect(within(log).getAllByRole("link", { name: "BF-000059" })[0]!.getAttribute("href")).toBe(
      "/admin/bugs?bug=59",
    );
    expect(screen.getByText(/Showing 2 of 2/)).toBeTruthy();
  });

  it("asks the server for the chosen filter and searches what came back", async () => {
    api.getJiraSyncLogFn.mockResolvedValue([
      entry(),
      entry({ id: "e2", bugCode: "BF-000060", text: "Sent due date to Jira" }),
    ]);
    show(<JiraSyncLog />);
    await screen.findByRole("list", { name: "Sync log" });
    fireEvent.click(screen.getByRole("button", { name: "Errors" }));
    await waitFor(() =>
      expect(api.getJiraSyncLogFn).toHaveBeenLastCalledWith({ data: { filter: "error" } }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Everything" }));
    fireEvent.change(screen.getByLabelText("Search the log"), { target: { value: "due date" } });
    await waitFor(() => expect(screen.getByText(/Showing 1 of 2/)).toBeTruthy());
  });

  it("offers Retry only for stopped work and says how much went back", async () => {
    api.getJiraSyncLogFn.mockResolvedValue([
      entry({
        kind: "error",
        who: "Bug Board → Jira",
        text: "Could not send to Jira: forbidden (stopped — use Retry)",
      }),
    ]);
    api.retryJiraParkedFn.mockResolvedValue({ retried: 1, overview: overview() });
    show(<JiraSyncLog />);
    fireEvent.click(await screen.findByRole("button", { name: "Retry stopped work" }));
    expect(await screen.findByText("1 item put back in the queue.")).toBeTruthy();
    expect(api.retryJiraParkedFn).toHaveBeenCalledTimes(1);
  });

  it("says so and offers a retry when the log cannot be read", async () => {
    api.getJiraSyncLogFn.mockRejectedValueOnce(
      new Error("The database is temporarily unavailable. Try again in a moment."),
    );
    api.getJiraSyncLogFn.mockResolvedValue([entry()]);
    show(<JiraSyncLog />);
    expect(await screen.findByText(/temporarily unavailable/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("list", { name: "Sync log" })).toBeTruthy();
  });
});

describe("Duplicates panel", () => {
  const project = (over = {}) => ({
    projectId: PROJECT,
    projectName: "Checkout",
    jiraProjectKey: "BFT",
    more: false,
    pairs: [],
    inBugBoard: [],
    inJira: [],
    ...over,
  });
  const pair = {
    key: "pair:41:10050",
    bugId: "41",
    code: "BF-41",
    issueId: "10050",
    issueKey: "BFT-7",
    title: "Login fails",
  };

  it("says plainly when no bug appears twice", async () => {
    api.getJiraDuplicatesFn.mockResolvedValue([project()]);
    show(<JiraDuplicates canSearch />);
    expect(await screen.findByText(/No bug appears twice/)).toBeInTheDocument();
  });

  it("links a same-title pair only after confirming, and shows what the server returns", async () => {
    api.getJiraDuplicatesFn.mockResolvedValue([project({ pairs: [pair] })]);
    api.linkJiraDuplicateFn.mockResolvedValue([project()]);
    show(<JiraDuplicates canSearch />);
    fireEvent.click(await screen.findByRole("button", { name: "Link these" }));
    expect(api.linkJiraDuplicateFn).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("alertdialog");
    expect(
      within(dialog).getByText(/Bug Board's details are sent to the Jira issue/),
    ).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Link these" }));
    await waitFor(() =>
      expect(api.linkJiraDuplicateFn).toHaveBeenCalledWith({
        data: { projectId: PROJECT, bugId: "41", issueId: "10050" },
      }),
    );
    expect(await screen.findByText(/No bug appears twice/)).toBeInTheDocument();
  });

  it("marks same titles as not duplicates and lists them per side", async () => {
    api.getJiraDuplicatesFn.mockResolvedValue([
      project({
        inBugBoard: [
          {
            key: "bb:1,2",
            title: "Crash",
            bugs: [
              { bugId: "1", code: "BF-1", issueKey: "BFT-1" },
              { bugId: "2", code: "BF-2", issueKey: null },
            ],
          },
        ],
        inJira: [
          {
            key: "jira:5,6",
            title: "Slow",
            issues: [
              { issueId: "5", key: "BFT-5" },
              { issueId: "6", key: "BFT-6" },
            ],
          },
        ],
      }),
    ]);
    api.ignoreJiraDuplicateFn.mockResolvedValue([project()]);
    show(<JiraDuplicates canSearch />);
    expect(await screen.findByText(/2 Bug Board bugs titled/)).toBeInTheDocument();
    expect(screen.getByText(/BFT-5, BFT-6/)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Not duplicates" })[0]!);
    await waitFor(() =>
      expect(api.ignoreJiraDuplicateFn).toHaveBeenCalledWith({ data: { key: "bb:1,2" } }),
    );
  });

  it("does not read Jira while disconnected", () => {
    show(<JiraDuplicates canSearch={false} />);
    expect(screen.getByText(/Connect Jira to check/)).toBeInTheDocument();
    expect(api.getJiraDuplicatesFn).not.toHaveBeenCalled();
  });
});
