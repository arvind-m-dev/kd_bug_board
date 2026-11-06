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
  getJiraPeopleFn: vi.fn(),
  findJiraAccountsFn: vi.fn(),
  linkJiraPersonFn: vi.fn(),
  unlinkJiraPersonFn: vi.fn(),
}));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@/lib/jira/jira.functions", () => api);
import { JiraHealth, JiraPeople, JiraProjects } from "@/components/bugflow/jira-sync";
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
    expect(await screen.findByText("Jira account: Ravi K")).toBeInTheDocument();
    expect(api.findJiraAccountsFn).toHaveBeenCalledWith({ data: { query: "Ravi" } });
    expect(api.linkJiraPersonFn).toHaveBeenCalledWith({
      data: { userId: "u1", accountId: "acc-ravi", name: "Ravi K" },
    });
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
