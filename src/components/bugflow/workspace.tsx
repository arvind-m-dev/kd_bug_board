import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useLayoutEffect, useState } from "react";
import {
  Bug,
  ChartPie,
  LayoutDashboard,
  UsersRound,
  ListChecks,
  FolderKanban,
  Activity,
  Settings2,
  Search,
  Menu,
  X,
  ArrowUpRight,
  ShieldCheck,
  Database,
  CircleHelp,
  ClipboardCheck,
  Link2,
  Plus,
  Copy,
  FileDown,
  RefreshCw,
  Upload,
  LockKeyhole,
  Layers3,
  Archive,
  ArchiveRestore,
  Printer,
  Palette,
  ArrowLeft,
  FileSpreadsheet,
  Trash2,
  SlidersHorizontal,
  Bot,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { CollaboratorOnboarding } from "./collaborator-onboarding";
import { AdminAccess } from "./admin-access";
import { BugWorkspace } from "./bug-workspace";
import { MemberPortals } from "./member-portals";
import { DashboardSummary } from "./dashboard-summary";
import { NotificationMenu, NotificationsPage } from "./notifications";
import { DropdownOptionsEditor } from "./dropdown-options";
import { ThemeToggle, useTheme } from "./theme-toggle";
import { paletteById, styleById } from "@/lib/appearance";
import { BrandMark } from "./decorations";
import { ThemedSelect } from "./themed-select";
import { ErrorNotice, ConfirmAction, actionError } from "./action-feedback";
import { ActivityView, prefetchActivityPage } from "./activity-view";
import { TeamReports } from "./team-reports";
import { AppearanceSettings } from "./appearance-settings";
import { MediaStorageCard } from "./media-storage-settings";
import { SignOutButton } from "./sign-out";
import { SkeletonRows } from "./loading";
import { getBugWorkspace } from "@/lib/bug-workflow.functions";
import {
  getMembers,
  getProjectSummary,
  addProject,
  archiveProject,
} from "@/lib/portal-access.functions";
import { getActivity } from "@/lib/activity.functions";
import {
  ACTIVITY_CATEGORIES,
  ACTIVITY_PERIODS,
  changeText,
  viaLabel,
  type ActivityRow,
} from "@/lib/activity";
import { viewerTimeZone } from "@/lib/period";
import { toCsv, downloadText, exportName } from "@/lib/export";
import { HelpContent } from "./help-content";
import { SheetExportLoader } from "./bug-sheet-export";
import { TrashView } from "./trash-view";
import { AiTokens } from "./ai-tokens";
import { getTrash } from "@/lib/trash.functions";
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

type View =
  | "overview"
  | "bugs"
  | "users"
  | "assignments"
  | "projects"
  | "activity"
  | "reports"
  | "settings"
  | "appearance"
  | "settings-options"
  | "settings-storage"
  | "settings-ai"
  | "trash"
  | "notifications";
const navigation: {
  to:
    | "/admin"
    | "/admin/bugs"
    | "/admin/users"
    | "/admin/assignments"
    | "/admin/projects"
    | "/admin/activity"
    | "/admin/reports"
    | "/admin/settings";
  label: string;
  icon: LucideIcon;
  count?: boolean;
}[] = [
  { to: "/admin", label: "Overview", icon: LayoutDashboard },
  { to: "/admin/bugs", label: "All bugs", icon: Bug, count: true },
  { to: "/admin/assignments", label: "Assignments", icon: ListChecks, count: true },
  { to: "/admin/projects", label: "Projects & modules", icon: FolderKanban },
  { to: "/admin/users", label: "Team & access", icon: UsersRound, count: true },
  { to: "/admin/activity", label: "Activity & reports", icon: Activity },
  { to: "/admin/reports", label: "Team reports", icon: ChartPie },
  { to: "/admin/settings", label: "Settings", icon: Settings2 },
];
// Sidebar is grouped; each group's title carries a chevron to fold its links away.
const navGroups: { id: string; label: string; icon: LucideIcon; items: typeof navigation }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard, items: navigation.slice(0, 1) },
  { id: "bugs", label: "Bugs", icon: Bug, items: navigation.slice(1, 3) },
  { id: "management", label: "Management", icon: FolderKanban, items: navigation.slice(3, 5) },
  { id: "reports", label: "Reports", icon: ChartPie, items: navigation.slice(5, 7) },
];
const titles: Record<View, string> = {
  overview: "Overview",
  bugs: "All bugs",
  users: "Team & access",
  assignments: "Assignments",
  projects: "Projects & modules",
  activity: "Activity & reports",
  reports: "Team reports",
  settings: "Settings",
  appearance: "Theme Lab",
  ["settings-options"]: "Options & fields",
  ["settings-storage"]: "Storage & services",
  ["settings-ai"]: "AI access (MCP)",
  trash: "Trash",
  notifications: "Notifications",
};
const subtitles: Record<View, string> = {
  trash: "Deleted bugs and members, restorable for 30 days.",
  appearance:
    "Colours, style, fonts, motion, seasonal scenes and what is on screen — for the workspace and every portal.",
  ["settings-options"]:
    "Severities, modules, environments, devices, and who bugs can be assigned to.",
  ["settings-storage"]: "Where data and private media live, and the connection status.",
  ["settings-ai"]:
    "Let AI clients (Claude, Cursor, ChatGPT) read and report bugs, and manage their tokens.",
  overview: "A clear view of your bugs, team, and everything in between.",
  bugs: "Track, prioritize, and manage every reported issue.",
  users:
    "Your team, their roles and their private portal links — open, copy or replace a link here.",
  assignments: "Keep the right bugs with the right people.",
  projects: "Organize testing across your applications and modules.",
  reports: "How each person is doing — what they raised, fixed, rejected and how fast.",
  activity: "Every change, with the complete story behind it.",
  settings: "Workspace preferences, security, and connected services.",
  notifications: "Every bug update from the last 10 days.",
};
function useNavCounts(): Record<string, number | undefined> {
  const bugs = useServerFn(getBugWorkspace);
  const members = useServerFn(getMembers);
  const admin = { kind: "admin" } as const;
  const b = useQuery({
    queryKey: ["bug-workspace", admin, undefined],
    queryFn: () => bugs({ data: { access: admin } }),
    retry: false,
    staleTime: 10000,
    refetchInterval: 20000,
  });
  const m = useQuery({
    queryKey: ["members"],
    queryFn: () => members(),
    retry: false,
    staleTime: 10000,
    refetchInterval: 20000,
  });
  const trash = useServerFn(getTrash);
  const t = useQuery({
    queryKey: ["trash"],
    queryFn: () => trash(),
    retry: false,
    staleTime: 30000,
    refetchInterval: 60000,
  });
  return {
    "/admin/trash": t.data ? t.data.bugs.length + t.data.members.length : undefined,
    "/admin/bugs": b.data?.total,
    "/admin/assignments": b.data
      ? b.data.statusCounts.filter((c) => c.assigned).reduce((n, c) => n + c.count, 0)
      : undefined,
    "/admin/users": m.data ? m.data.filter((x) => x.type !== "admin").length : undefined,
  };
}
export function Workspace({ view = "overview" }: { view?: View }) {
  const queryClient = useQueryClient();
  const [menu, setMenu] = useState(false);
  const [dialog, setDialog] = useState<string | null>(null);
  // Collapsed rail (desktop/tablet) and per-group fold state are remembered per browser. Both start at their
  // defaults so the server and client render the same HTML; the saved choice is applied before first paint.
  const [collapsed, setCollapsed] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  useLayoutEffect(() => {
    try {
      setCollapsed(localStorage.getItem("bf-sidebar-collapsed") === "1");
      setOpenGroups(
        JSON.parse(localStorage.getItem("bf-nav-groups") || "{}") as Record<string, boolean>,
      );
    } catch {
      /* private mode: keep defaults */
    }
  }, []);
  const toggleCollapsed = () =>
    setCollapsed((c) => {
      const n = !c;
      try {
        localStorage.setItem("bf-sidebar-collapsed", n ? "1" : "0");
      } catch {
        /* private mode */
      }
      return n;
    });
  const toggleGroup = (id: string) =>
    setOpenGroups((o) => {
      const n = { ...o, [id]: o[id] !== true };
      try {
        localStorage.setItem("bf-nav-groups", JSON.stringify(n));
      } catch {
        /* private mode */
      }
      return n;
    });
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navCounts = useNavCounts();
  // The group holding the current page is highlighted and forced open.
  const activeGroup = navGroups.find((g) =>
    g.items.some(
      (n) =>
        n.to === pathname || (n.to === "/admin" && (pathname === "/" || pathname === "/admin")),
    ),
  )?.id;
  const { setPersonal } = useTheme();
  useEffect(() => {
    setPersonal(null);
  }, [setPersonal]);
  // ⌘K / Ctrl+K opens search from anywhere in the workspace.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setDialog("search");
      }
      if (e.key === "Escape") setMenu(false); // closes the mobile drawer; dialogs handle Escape themselves
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const print = (
    <Button size="sm" variant="outline" title="Print or save as PDF" onClick={() => window.print()}>
      <Printer />
      Print
    </Button>
  );
  return (
    <div className="bf-shell" data-collapsed={collapsed || undefined}>
      {menu && (
        <div className="bf-sidebar-scrim" aria-hidden="true" onClick={() => setMenu(false)} />
      )}
      <a href="#bf-main" className="bf-skip">
        Skip to content
      </a>
      <aside className="bf-sidebar" data-open={menu} aria-label="Main navigation">
        <button
          type="button"
          className="bf-sidebar-toggle"
          onClick={toggleCollapsed}
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <ChevronRight /> : <ChevronLeft />}
        </button>
        <Link to="/" className="bf-brand" title="Futurist Global Bug Board">
          <span className="bf-logo">
            <BrandMark />
          </span>
          <span className="bf-brand-name">
            Futurist Global Bug Board<span className="text-primary">.</span>
          </span>
        </Link>

        {navGroups.map((g) => {
          const active = g.id === activeGroup;
          const n = g.items[0];
          if (g.items.length === 1 && n) {
            return (
              <nav key={g.id} className="bf-nav bf-nav-solo">
                <Link
                  to={n.to}
                  activeOptions={{ exact: true }}
                  className="bf-nav-link"
                  title={n.label}
                  data-status={
                    n.to === "/admin" && (pathname === "/" || pathname === "/admin")
                      ? "active"
                      : undefined
                  }
                  onClick={() => setMenu(false)}
                >
                  <n.icon />
                  {n.label}
                  {n.count && <span className="bf-nav-count">{navCounts[n.to] ?? "—"}</span>}
                </Link>
              </nav>
            );
          }
          const open = collapsed || openGroups[g.id] === true;
          return (
            <div
              key={g.id}
              className="bf-nav-group"
              data-open={open || undefined}
              data-active={active || undefined}
            >
              <button
                type="button"
                className="bf-nav-group-head"
                data-active={active || undefined}
                onClick={() => toggleGroup(g.id)}
                aria-expanded={open}
                title={`${open ? "Collapse" : "Expand"} ${g.label}`}
              >
                <g.icon className="bf-nav-group-icon" />
                <span>{g.label}</span>
                <ChevronDown className="bf-nav-group-chevron" />
              </button>
              <div className="bf-nav-group-items">
                <nav className="bf-nav" aria-label={g.label}>
                  {g.items.map((n) => (
                    <Link
                      key={n.to}
                      to={n.to}
                      activeOptions={{ exact: true }}
                      className="bf-nav-link"
                      title={n.label}
                      data-status={n.to === "/admin" && pathname === "/" ? "active" : undefined}
                      onClick={() => setMenu(false)}
                      onMouseEnter={
                        n.to === "/admin/activity"
                          ? () => prefetchActivityPage(queryClient)
                          : undefined
                      }
                      onFocus={
                        n.to === "/admin/activity"
                          ? () => prefetchActivityPage(queryClient)
                          : undefined
                      }
                    >
                      <n.icon />
                      {n.label}
                      {n.count && <span className="bf-nav-count">{navCounts[n.to] ?? "—"}</span>}
                    </Link>
                  ))}
                </nav>
              </div>
            </div>
          );
        })}
        <div className="bf-sidebar-bottom">
          <Link
            to="/admin/settings"
            className="bf-nav-link mb-2"
            title="Settings"
            onClick={() => setMenu(false)}
          >
            <Settings2 />
            Settings
          </Link>
          <Button
            variant="ghost"
            className="mb-3 w-full justify-start text-xs text-muted-foreground"
            data-ui="help"
            title="Help & support"
            onClick={() => setDialog("help")}
          >
            <CircleHelp size={16} />
            Help & support
          </Button>
          <div className="flex items-center gap-3 border-t pt-4">
            <span className="bf-avatar">BF</span>
            <div className="min-w-0">
              <strong className="block truncate text-xs">Team administration</strong>
              <span className="text-[11.5px] text-muted-foreground">Private access</span>
            </div>
            <ShieldCheck size={15} className="ml-auto shrink-0 text-muted-foreground" />
          </div>
        </div>
      </aside>
      <div className="bf-body">
        <header className="bf-topbar">
          <div className="bf-topbar-left">
            <Button
              variant="ghost"
              size="icon"
              className="bf-mobile-menu"
              aria-label={menu ? "Close navigation" : "Open navigation"}
              onClick={() => setMenu(!menu)}
            >
              {menu ? <X /> : <Menu />}
            </Button>
            <Breadcrumb data-ui="breadcrumb">
              <BreadcrumbList className="text-xs">
                <BreadcrumbItem>
                  <BreadcrumbLink asChild>
                    <Link to="/admin">Workspace</Link>
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbPage>{titles[view]}</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>
          <div className="bf-topbar-right">
            <ThemeToggle />
            <Button
              size="icon"
              variant="ghost"
              aria-label="Search workspace"
              title="Search workspace (⌘K)"
              onClick={() => setDialog("search")}
            >
              <Search size={17} />
            </Button>
            <NotificationMenu />
            <span className="h-5 border-l" />
            <SignOutButton />
          </div>
        </header>
        <main id="bf-main" className="bf-main">
          <div className="bf-page-heading">
            <div>
              <h1>{titles[view]}</h1>
              <p>{subtitles[view]}</p>
            </div>
            <div className="bf-page-actions">
              {view === "bugs" ? (
                <Button size="sm" variant="outline" onClick={() => setDialog("sheet")}>
                  <FileSpreadsheet />
                  Export sheet
                </Button>
              ) : view === "users" ? (
                <Button size="sm" onClick={() => setDialog("user")}>
                  <Plus />
                  Add member
                </Button>
              ) : view === "projects" ? (
                <Button size="sm" onClick={() => setDialog("project")}>
                  <Plus />
                  New project
                </Button>
              ) : view === "activity" ? (
                <>
                  {print}
                  <Button size="sm" variant="outline" onClick={() => setDialog("export")}>
                    <FileDown />
                    Export report
                  </Button>
                </>
              ) : view === "reports" || view === "overview" ? (
                print
              ) : null}
            </div>
          </div>
          <AdminAccess showAccount={false}>
            {view === "overview" ? (
              <DashboardSummary />
            ) : view === "bugs" ? (
              <AdminBugs />
            ) : view === "users" ? (
              <UsersView />
            ) : view === "assignments" ? (
              <AdminBugs assignmentsOnly />
            ) : view === "projects" ? (
              <ProjectsView onDialog={setDialog} />
            ) : view === "activity" ? (
              <ActivityView />
            ) : view === "reports" ? (
              <TeamReports />
            ) : view === "settings" ? (
              <SettingsOverview />
            ) : view === "appearance" ? (
              <SettingsPage tab="appearance">
                <AppearanceSettings />
              </SettingsPage>
            ) : view === "settings-options" ? (
              <SettingsPage tab="settings-options">
                <DropdownOptionsEditor onAddMember={() => setDialog("user")} />
              </SettingsPage>
            ) : view === "settings-storage" ? (
              <SettingsPage tab="settings-storage">
                <StorageSettings />
              </SettingsPage>
            ) : view === "settings-ai" ? (
              <SettingsPage tab="settings-ai">
                <AiTokensCard />
              </SettingsPage>
            ) : view === "trash" ? (
              <TrashView />
            ) : (
              <NotificationsPage />
            )}
          </AdminAccess>
          <footer className="bf-footer">
            <span>
              Futurist Global Bug Board <span className="mx-1">·</span> Every bug. One place.
            </span>
            <span className="flex items-center gap-2">
              <ShieldCheck size={12} />
              Private portals · Shared records
            </span>
          </footer>
        </main>
      </div>
      <Link
        to="/admin/trash"
        activeOptions={{ exact: true }}
        className="bf-trash-fab"
        data-status={pathname === "/admin/trash" ? "active" : undefined}
        title="Trash — restore deleted items for 30 days"
        aria-label={`Trash${navCounts["/admin/trash"] ? ` (${navCounts["/admin/trash"]} items)` : ""}`}
        onClick={() => setMenu(false)}
      >
        <Trash2 />
        {navCounts["/admin/trash"] ? (
          <span className="bf-trash-fab-count">{navCounts["/admin/trash"]}</span>
        ) : null}
      </Link>
      <WorkspaceDialog kind={dialog} close={() => setDialog(null)} />
    </div>
  );
}
function AdminBugs({ assignmentsOnly = false }: { assignmentsOnly?: boolean }) {
  const search = useRouterState({
    select: (s) => s.location.search as Record<string, string | undefined>,
  });
  return (
    <BugWorkspace
      key={`${search["filter"] ?? "all"}|${search["q"] ?? ""}`}
      access={{ kind: "admin" }}
      assignmentsOnly={assignmentsOnly}
      initialFilter={search["filter"] ?? "all"}
      initialQuery={search["q"] ?? ""}
    />
  );
}
function UsersView() {
  const search = useRouterState({
    select: (s) => s.location.search as Record<string, string | undefined>,
  });
  return <MemberPortals key={search["q"] ?? ""} initialSearch={search["q"] ?? ""} />;
}
function Empty({
  icon: Icon = Bug,
  title,
  text,
  children,
}: {
  icon?: LucideIcon;
  title: string;
  text: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="bf-empty">
      <span className="bf-empty-icon">
        <Icon size={21} strokeWidth={1.5} />
      </span>
      <h3>{title}</h3>
      <p>{text}</p>
      {children}
    </div>
  );
}
function ProjectsView({ onDialog }: { onDialog: (s: string) => void }) {
  const fetch = useServerFn(getProjectSummary);
  const archive = useServerFn(archiveProject);
  const client = useQueryClient();
  const projects = useQuery({
    queryKey: ["project-summary"],
    queryFn: () => fetch(),
    retry: false,
    staleTime: 10000,
    refetchInterval: 30000,
  });
  const [query, setQuery] = useState("");
  const [state, setState] = useState("active");
  const [pending, setPending] = useState<{ id: string; name: string; archived: boolean } | null>(
    null,
  );
  const when = (v: string | null) =>
    v
      ? new Date(v).toLocaleString("en-GB", {
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "—";
  if (projects.isPending)
    return (
      <div className="bf-panel">
        <SkeletonRows rows={5} label="Loading projects" />
      </div>
    );
  if (projects.isError)
    return (
      <ErrorNotice
        message={actionError(projects.error, "Projects could not be loaded. Please try again.")}
        onRetry={() => {
          void projects.refetch();
        }}
        retrying={projects.isFetching}
      />
    );
  const archivedCount = projects.data.filter((p) => p.archived).length;
  const rows = projects.data.filter(
    (p) =>
      (state === "archived" ? p.archived : !p.archived) &&
      p.name.toLowerCase().includes(query.trim().toLowerCase()),
  );
  async function confirmArchive() {
    if (!pending) return;
    await archive({ data: { id: pending.id, archived: !pending.archived } });
    await Promise.all([
      client.invalidateQueries({ queryKey: ["project-summary"] }),
      client.invalidateQueries({ queryKey: ["projects"] }),
    ]);
    toast.success(pending.archived ? `${pending.name} restored` : `${pending.name} archived`);
  }
  return (
    <>
      <div className="bf-toolbar">
        <div className="bf-search">
          <Search />
          <Input
            aria-label="Search projects"
            placeholder="Search projects…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <ThemedSelect
          label="Project state"
          value={state}
          onChange={setState}
          options={[
            { value: "active", label: "Active projects" },
            { value: "archived", label: `Archived (${archivedCount})` },
          ]}
        />
        <Button
          variant="outline"
          size="icon"
          title="Refresh projects"
          aria-label="Refresh projects"
          onClick={() => {
            void projects.refetch();
          }}
        >
          <RefreshCw className={projects.isFetching ? "animate-spin" : ""} />
        </Button>
      </div>
      <div className="bf-panel">
        <div className="bf-table-wrap">
          <table className="bf-table">
            <thead>
              <tr>
                {[
                  "Project",
                  "Modules",
                  "Members",
                  "Open bugs",
                  "Total bugs",
                  "Environment",
                  "Last updated",
                ].map((h) => (
                  <th key={h}>{h}</th>
                ))}
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td>
                    <span className="flex items-center gap-3">
                      <span className="bf-stat-icon bf-tone-teal">
                        <Layers3 size={15} />
                      </span>
                      <strong>{p.name}</strong>
                    </span>
                  </td>
                  <td>{p.modules || "—"}</td>
                  <td>{p.members || "—"}</td>
                  <td>
                    {p.open ? (
                      <Link
                        to="/admin/bugs"
                        search={{ filter: "open", q: p.name }}
                        className="bf-person-link"
                        title={`Open bugs in ${p.name}`}
                      >
                        {p.open}
                      </Link>
                    ) : (
                      "0"
                    )}
                  </td>
                  <td>
                    {p.total ? (
                      <Link
                        to="/admin/bugs"
                        search={{ q: p.name }}
                        className="bf-person-link"
                        title={`All bugs in ${p.name}`}
                      >
                        {p.total}
                      </Link>
                    ) : (
                      "0"
                    )}
                  </td>
                  <td>{p.environment}</td>
                  <td>
                    <time
                      className="text-xs text-muted-foreground"
                      title={p.lastUpdate ?? undefined}
                    >
                      {when(p.lastUpdate)}
                    </time>
                  </td>
                  <td>
                    {p.archived ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        title={`Restore ${p.name}`}
                        onClick={() => setPending({ id: p.id, name: p.name, archived: true })}
                      >
                        <ArchiveRestore size={14} />
                        Restore
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        title={`Archive ${p.name}`}
                        aria-label={`Archive ${p.name}`}
                        onClick={() => setPending({ id: p.id, name: p.name, archived: false })}
                      >
                        <Archive size={14} className="text-muted-foreground" />
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 &&
            (state === "archived" ? (
              <Empty
                icon={Archive}
                title="No archived projects"
                text="Archive a project to hide it from report forms and project choices without losing its bugs."
              />
            ) : projects.data.length === archivedCount ? (
              <Empty
                icon={FolderKanban}
                title="No projects yet"
                text="Create your first project, then report bugs and give members access to it."
              >
                <Button size="sm" onClick={() => onDialog("project")}>
                  <Plus />
                  New project
                </Button>
              </Empty>
            ) : (
              <Empty
                icon={Search}
                title="No projects match your search"
                text="Try a different name, or clear the search to see every project."
              />
            ))}
        </div>
        {rows.length > 0 && (
          <div className="bf-table-footer">
            <span>
              {rows.length} {rows.length === 1 ? "project" : "projects"}
              {state === "active" && archivedCount ? ` · ${archivedCount} archived` : ""}
            </span>
            <span>Bug counts update live · open = not yet resolved or closed</span>
          </div>
        )}
      </div>
      <ConfirmAction
        open={pending !== null}
        onOpenChange={(o) => {
          if (!o) setPending(null);
        }}
        title={pending?.archived ? `Restore ${pending?.name}?` : `Archive ${pending?.name}?`}
        description={
          pending?.archived
            ? "The project appears again in report forms and project choices."
            : "Bugs, history and member access are kept, but the project no longer appears in report forms or project choices. You can restore it any time."
        }
        confirmLabel={pending?.archived ? "Restore project" : "Archive project"}
        onConfirm={confirmArchive}
      />
    </>
  );
}
const SETTINGS_TABS = [
  {
    to: "/admin/settings" as const,
    view: "settings",
    label: "Overview",
    icon: Settings2,
    desc: "Everything about how this workspace looks and connects, in one place.",
  },
  {
    to: "/admin/settings/appearance" as const,
    view: "appearance",
    label: "Theme Lab",
    icon: Palette,
    highlight: true,
    desc: "Palette, style, fonts, motion, the seasonal scenes and what is shown.",
  },
  {
    to: "/admin/settings/options" as const,
    view: "settings-options",
    label: "Options & fields",
    icon: SlidersHorizontal,
    desc: "Severities, modules, environments, devices, and who bugs can be assigned to.",
  },
  {
    to: "/admin/settings/storage" as const,
    view: "settings-storage",
    label: "Storage & services",
    icon: Database,
    desc: "Database and private media storage, with connection status.",
  },
  {
    to: "/admin/settings/ai" as const,
    view: "settings-ai",
    label: "AI access (MCP)",
    icon: Bot,
    highlight: true,
    desc: "MCP endpoint, AI tokens and app connectors (OAuth) for Claude, Cursor, ChatGPT.",
  },
];
/** Sub-navigation shown on every settings page; the current page is highlighted. */
function SettingsNav({ current }: { current: string }) {
  return (
    <nav className="bf-settings-tabs" aria-label="Settings sections">
      {SETTINGS_TABS.map((t) => (
        <Link
          key={t.view}
          to={t.to}
          className="bf-settings-tab"
          data-active={t.view === current ? "" : undefined}
          data-highlight={"highlight" in t && t.highlight ? "" : undefined}
        >
          <t.icon size={15} />
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
/** Wraps one settings section with the sub-nav so you always see which page you are on. */
function SettingsPage({ tab, children }: { tab: string; children: React.ReactNode }) {
  return (
    <div className="bf-settings">
      <SettingsNav current={tab} />
      {children}
    </div>
  );
}
/** Settings landing: the sub-nav plus a card per page describing it. */
function SettingsOverview() {
  return (
    <div className="bf-settings">
      <SettingsNav current="settings" />
      <div className="bf-settings-cards">
        {SETTINGS_TABS.filter((t) => t.view !== "settings").map((t) => (
          <Link
            key={t.view}
            to={t.to}
            className="bf-settings-card"
            data-highlight={"highlight" in t && t.highlight ? "" : undefined}
          >
            <span className="bf-stat-icon bf-tone-info">
              <t.icon size={18} />
            </span>
            <div>
              <h3>{t.label}</h3>
              <p>{t.desc}</p>
            </div>
            <ArrowUpRight size={16} className="ml-auto text-muted-foreground" />
          </Link>
        ))}
      </div>
      <div className="bf-settings-info">
        <div className="bf-panel mb-6">
          <div className="bf-panel-heading">
            <h2>Access & security</h2>
            <LockKeyhole size={16} className="text-muted-foreground" />
          </div>
          <div className="bf-setting-row">
            <ShieldCheck size={21} className="text-primary" />
            <div>
              <h3>Private Admin access</h3>
              <p>Admin sign-in verified. Private sessions expire after eight hours.</p>
            </div>
            <span className="bf-tag">Active</span>
          </div>
          <div className="bf-setting-row">
            <Link2 size={21} className="text-primary" />
            <div>
              <h3>Restricted portal links</h3>
              <p>
                Random, role-scoped links with expiry, revocation, and regeneration. No login screen
                required.
              </p>
            </div>
          </div>
          <div className="bf-setting-row">
            <ShieldCheck size={21} className="text-warning" />
            <div>
              <h3>Anonymous operation protection</h3>
              <p>
                Every report and update verifies the active session or private portal, permissions
                and project scope.
              </p>
            </div>
            <span className="bf-tag">Active</span>
          </div>
        </div>
        <div className="bf-panel">
          <div className="bf-panel-heading">
            <h2>Workflow defaults</h2>
            <span className="bf-tag">READ ONLY</span>
          </div>
          <div className="bf-setting-row">
            <Bug size={21} className="text-primary" />
            <div>
              <h3>Permanent bug IDs</h3>
              <p>BF-000001 · generated safely on submission and never reused.</p>
            </div>
          </div>
          <div className="bf-setting-row">
            <ClipboardCheck size={21} className="text-info" />
            <div>
              <h3>QA-controlled resolution</h3>
              <p>
                New → validation → assignment → in progress → recheck → resolved. Only successful QA
                verification resolves a fix.
              </p>
            </div>
          </div>
          <div className="bf-setting-row">
            <Upload size={21} className="text-primary" />
            <div>
              <h3>Private evidence retention</h3>
              <p>
                Evidence is retained after resolution. Deletion is manual, confirmed, and audited.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
/** The Storage & services page: the database status and the media storage card. */
function StorageSettings() {
  return (
    <div className="bf-panel">
      <div className="bf-panel-heading">
        <h2>Connected services</h2>
      </div>
      <div className="bf-setting-row">
        <span className="bf-stat-icon bf-tone-teal">
          <Database size={19} />
        </span>
        <div>
          <h3>Neon PostgreSQL</h3>
          <p>
            Shared bug records, portal access, assignments, and history.
            <br />
            Development database connected. Member portals are available.
          </p>
        </div>
        <span className="bf-tag">Connected</span>
      </div>
      <MediaStorageCard />
    </div>
  );
}
function WorkspaceDialog({ kind, close }: { kind: string | null; close: () => void }) {
  const title =
    kind === "user"
      ? "Create a portal"
      : kind === "project"
        ? "New project"
        : kind === "export"
          ? "Export activity report"
          : kind === "sheet"
            ? "Export bugs as a sheet"
            : kind === "search"
              ? "Search workspace"
              : "Help & support";
  const description =
    kind === "user"
      ? "Set up a person and their restricted workspace."
      : kind === "project"
        ? "Organize bugs by application and module."
        : kind === "sheet"
          ? "An .xlsx in the team's bug sheet layout, with colours, dropdowns and links."
          : kind === "export"
            ? "Download or copy the change history for a period."
            : kind === "search"
              ? "Find a bug or a team member anywhere in the workspace."
              : "How the Futurist Global Bug Board works";
  return (
    <Dialog
      open={kind !== null}
      onOpenChange={(o) => {
        if (!o) close();
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {kind === "user" ? (
          <AdminAccess showAccount={false}>
            <CollaboratorOnboarding />
          </AdminAccess>
        ) : kind === "project" ? (
          <NewProjectForm close={close} />
        ) : kind === "export" ? (
          <ActivityExport close={close} />
        ) : kind === "sheet" ? (
          <SheetExportLoader access={{ kind: "admin" }} close={close} />
        ) : kind === "search" ? (
          <QuickSearch close={close} />
        ) : (
          <HelpContent audience="admin" onNavigate={close} />
        )}
      </DialogContent>
    </Dialog>
  );
}
function NewProjectForm({ close }: { close: () => void }) {
  const create = useServerFn(addProject);
  const client = useQueryClient();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const p = await create({ data: { name: name.trim() } });
      await Promise.all([
        client.invalidateQueries({ queryKey: ["projects"] }),
        client.invalidateQueries({ queryKey: ["project-summary"] }),
      ]);
      toast.success(`Project “${p.name}” created`);
      close();
    } catch (err) {
      toast.error(actionError(err, "The project could not be created."));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="bf-form" onSubmit={submit}>
      <label className="bf-field">
        Project name
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={100}
          placeholder="Application or website name"
          autoFocus
          required
        />
      </label>
      <p className="text-xs leading-6 text-muted-foreground">
        Bugs are reported against a project, and its modules build up from the reports. Give members
        access to the new project from Team & access.
      </p>
      <Button type="submit" disabled={!name.trim() || busy}>
        {busy ? <RefreshCw className="animate-spin" /> : <Plus />}Create project
      </Button>
    </form>
  );
}
/** Quick search over the loaded bug workspace and the member list, with deep links into the filtered pages. */
function QuickSearch({ close }: { close: () => void }) {
  const navigate = useNavigate();
  const fetchBugs = useServerFn(getBugWorkspace);
  const fetchMembers = useServerFn(getMembers);
  const admin = { kind: "admin" } as const;
  const bugs = useQuery({
    queryKey: ["bug-workspace", admin, undefined],
    queryFn: () => fetchBugs({ data: { access: admin } }),
    retry: false,
    staleTime: 10000,
  });
  const members = useQuery({
    queryKey: ["members"],
    queryFn: () => fetchMembers(),
    retry: false,
    staleTime: 10000,
  });
  const [q, setQ] = useState("");
  const text = q.trim().toLowerCase();
  const bugHits = text
    ? (bugs.data?.bugs ?? [])
        .filter((b) =>
          `${b.code} ${b.title} ${b.project} ${b.module} ${b.reporter} ${b.assignee}`
            .toLowerCase()
            .includes(text),
        )
        .slice(0, 6)
    : [];
  const memberHits = text
    ? (members.data ?? [])
        .filter((m) => m.type !== "admin" && `${m.name} ${m.email}`.toLowerCase().includes(text))
        .slice(0, 4)
    : [];
  const goBugs = () => {
    if (!q.trim()) return;
    void navigate({ to: "/admin/bugs", search: { q: q.trim() } });
    close();
  };
  // ↑ ↓ move focus through the results (and back to the input); Enter activates the focused one.
  const onKeys = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("[data-result]"));
    if (!items.length) return;
    e.preventDefault();
    const i = items.indexOf(document.activeElement as HTMLElement);
    const next =
      e.key === "ArrowDown" ? (i < 0 ? 0 : Math.min(items.length - 1, i + 1)) : i <= 0 ? -1 : i - 1;
    if (next < 0) e.currentTarget.querySelector("input")?.focus();
    else items[next]?.focus();
  };
  return (
    <div className="grid gap-3" onKeyDown={onKeys}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          goBugs();
        }}
        className="bf-search"
      >
        <Search />
        <Input
          aria-label="Search bugs and people"
          placeholder="Search bug ID, title or person…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoFocus
        />
      </form>
      <p className="-mt-2 px-1 text-[11px] text-muted-foreground">
        <kbd>↑</kbd> <kbd>↓</kbd> move · <kbd>Enter</kbd> open · <kbd>Esc</kbd> close
      </p>
      {text ? (
        <div className="grid gap-1">
          {bugHits.map((b) => (
            <Button
              key={b.id}
              data-result
              variant="ghost"
              className="h-auto w-full min-w-0 justify-start py-2"
              onClick={() => {
                void navigate({ to: "/admin/bugs", search: { q: b.code } });
                close();
              }}
            >
              <span className="shrink-0 font-mono text-[11.5px] text-muted-foreground">
                {b.code}
              </span>
              <span className="min-w-0 flex-1 truncate text-left">{b.title}</span>
              <span className="bf-status-pill shrink-0">
                {b.status.toLowerCase().replaceAll("_", " ")}
              </span>
            </Button>
          ))}
          {memberHits.map((m) => (
            <Button
              key={m.id}
              data-result
              variant="ghost"
              className="justify-start"
              onClick={() => {
                void navigate({ to: "/admin/users", search: { q: m.name } });
                close();
              }}
            >
              <span className="bf-avatar !size-6 !text-[10px]">
                {m.name.slice(0, 2).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1 truncate text-left">{m.name}</span>
              <span className="text-xs capitalize text-muted-foreground">
                {m.role === "qa" ? "QA" : m.role}
              </span>
            </Button>
          ))}
          {bugHits.length === 0 && memberHits.length === 0 && (
            <p className="px-1 py-6 text-center text-sm text-muted-foreground">
              Nothing matches “{q.trim()}”. Press Enter to search every bug.
            </p>
          )}
          <Button data-result variant="outline" size="sm" className="mt-1" onClick={goBugs}>
            <Search />
            Search all bugs for “{q.trim()}”
          </Button>
        </div>
      ) : (
        <div className="grid gap-1">
          {navigation.slice(0, 6).map((n) => (
            <Button key={n.to} asChild variant="ghost" className="justify-start" onClick={close}>
              <Link to={n.to} data-result>
                <n.icon />
                {n.label}
                <ArrowUpRight className="ml-auto" />
              </Link>
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
const eventLabel = (action: string) =>
  action === "bug.created" || action === "bug.sample_created"
    ? "New bug"
    : action === "bug.severity"
      ? "Priority & severity"
      : (ACTIVITY_CATEGORIES.find((c) => c.key === action.replace(/^bug\./, ""))?.label ??
        "Team & portals");
/** Exports the most recent matching activity (up to 500 entries) as a CSV download or Markdown on the clipboard. */
function ActivityExport({ close }: { close: () => void }) {
  const fetch = useServerFn(getActivity);
  const [type, setType] = useState("all");
  const [days, setDays] = useState("30");
  const [busy, setBusy] = useState<"csv" | "copy" | null>(null);
  const when = (at: string) =>
    new Date(at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
  async function collect() {
    const rows: ActivityRow[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 10 && rows.length < 500; i++) {
      const page = await fetch({
        data: {
          type,
          days: Number(days),
          tz: viewerTimeZone(),
          query: "",
          ...(cursor ? { cursor } : {}),
        },
      });
      rows.push(...page.rows);
      if (!page.nextCursor || page.rows.length === 0) break;
      cursor = page.nextCursor;
    }
    if (rows.length === 0) throw new Error("No activity was recorded for this type and period.");
    return rows.slice(0, 500);
  }
  async function run(kindOf: "csv" | "copy") {
    if (busy) return;
    setBusy(kindOf);
    try {
      const rows = await collect();
      if (kindOf === "csv") {
        downloadText(
          exportName(`bug-activity-${days === "0" ? "all-time" : `last-${days}-days`}`),
          toCsv(
            ["When", "Who", "Source", "Event", "Bug", "Title", "Details"],
            rows.map((r) => [
              when(r.at),
              r.actor,
              viaLabel(r.via),
              eventLabel(r.action),
              r.bugCode,
              r.bugTitle,
              changeText(r),
            ]),
          ),
        );
        toast.success(
          `${rows.length} ${rows.length === 1 ? "entry" : "entries"} downloaded as CSV`,
        );
      } else {
        const md = [
          `# Activity report · ${(ACTIVITY_PERIODS.find((p) => p.value === days)?.label ?? "").toLowerCase()}`,
          "",
          ...rows.map(
            (r) =>
              `- **${when(r.at)}** — ${r.actor} · ${eventLabel(r.action)}${r.bugCode ? ` · ${r.bugCode} ${r.bugTitle}` : ""}${changeText(r) ? ` — ${changeText(r)}` : ""}`,
          ),
        ].join("\n");
        await navigator.clipboard.writeText(md);
        toast.success(
          `${rows.length} ${rows.length === 1 ? "entry" : "entries"} copied as Markdown`,
        );
      }
      close();
    } catch (err) {
      toast.error(actionError(err, "The report could not be exported."));
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="bf-form">
      <div className="bf-form-grid">
        <div className="bf-field">
          Activity type
          <ThemedSelect
            label="Export activity type"
            className="w-full"
            value={type}
            onChange={setType}
            options={ACTIVITY_CATEGORIES.map((c) => ({ value: c.key, label: c.label }))}
          />
        </div>
        <div className="bf-field">
          Period
          <ThemedSelect
            label="Export period"
            className="w-full"
            value={days}
            onChange={setDays}
            options={ACTIVITY_PERIODS}
          />
        </div>
      </div>
      <p className="text-xs leading-6 text-muted-foreground">
        Exports the most recent 500 matching changes — who changed what, when, and from which
        portal.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Button
          variant="outline"
          disabled={busy !== null}
          onClick={() => {
            void run("copy");
          }}
        >
          {busy === "copy" ? <RefreshCw className="animate-spin" /> : <Copy />}Copy Markdown
        </Button>
        <Button
          disabled={busy !== null}
          onClick={() => {
            void run("csv");
          }}
        >
          {busy === "csv" ? <RefreshCw className="animate-spin" /> : <FileDown />}Download CSV
        </Button>
      </div>
    </div>
  );
}

/** Settings panel for AI (MCP) tokens; Admin can issue one for any panel, so it loads the member list. */
function AiTokensCard() {
  const fetch = useServerFn(getMembers);
  const members = useQuery({
    queryKey: ["members"],
    queryFn: () => fetch(),
    retry: false,
    staleTime: 10000,
  });
  const list = (members.data ?? [])
    .filter((m) => m.type !== "admin" && m.active)
    .map((m) => ({ id: m.id, name: m.name, type: m.type }));
  return (
    <div className="bf-panel mb-6">
      <div className="bf-panel-heading">
        <h2>AI access</h2>
      </div>
      <div className="p-4">
        <AiTokens scope={{ kind: "admin" }} members={list} />
      </div>
    </div>
  );
}
