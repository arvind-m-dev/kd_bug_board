import { useState, useEffect } from "react";
import { useScrollLock } from "@/hooks/use-scroll-lock";
import { useRestoredQueries } from "@/lib/query-cache";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import {
  Bug,
  ShieldCheck,
  LockKeyhole,
  Menu,
  X,
  CircleHelp,
  FolderKanban,
  CalendarDays,
  Hash,
  CircleCheck,
  CircleMinus,
  Palette,
  Images,
  FileSpreadsheet,
  type LucideIcon,
  Bot,
} from "lucide-react";
import { MediaLibrary } from "./media-library";
import { AiTokens } from "./ai-tokens";
import { SheetExportLoader } from "./bug-sheet-export";
import { rememberPortal } from "./media-link";
import { ThemeToggle, useTheme } from "./theme-toggle";
import { ThemeStudio } from "./appearance-settings";
import { BrandMark } from "./decorations";
import type { PortalAppearance } from "@/lib/appearance";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { dismissWelcome } from "@/lib/member-management.functions";
import { getMemberPortal } from "@/lib/portal-access.functions";
import { permissionLabels, rolePermissions, type Permission } from "@/lib/onboarding";
import { Button } from "@/components/ui/button";
import { ErrorNotice } from "./action-feedback";
import { BugWorkspace } from "./bug-workspace";
import { HelpContent, roleGuide } from "./help-content";
import { getBugWorkspace } from "@/lib/bug-workflow.functions";
import { focusCounts, portalFocus, type BugAccess } from "@/lib/bug-workflow";
import { initials, roleText } from "@/lib/format";
import { useMemberFavicon } from "@/hooks/use-member-favicon";
import { usePresence } from "@/hooks/use-presence";
import { useUrlParam } from "@/hooks/use-url-param";

type Tab = "bugs" | "media" | "access" | "ai" | "theme" | "help";
type Focus = { filter: string; label: string };
const TABS: { id: Tab; label: string; icon: LucideIcon }[] = [
  { id: "bugs", label: "My bugs", icon: Bug },
  { id: "media", label: "My media", icon: Images },
  { id: "ai", label: "AI access", icon: Bot },
  { id: "theme", label: "My theme", icon: Palette },
  { id: "help", label: "How it works", icon: CircleHelp },
];

const TAB_IDS: Tab[] = ["bugs", "media", "access", "ai", "theme", "help"];
const ACCESS_VIEW: { id: Tab; label: string; icon: LucideIcon } = {
  id: "access",
  label: "My projects & access",
  icon: ShieldCheck,
};

export function PersonalPortal({
  token,
  type,
}: {
  token: string;
  type: "reporter" | "qa" | "developer" | "member";
}) {
  useRestoredQueries();
  const client = useQueryClient();
  const acknowledge = useServerFn(dismissWelcome);
  const welcome = useMutation({
    mutationFn: acknowledge,
    onSuccess: () => client.invalidateQueries({ queryKey: ["personal-portal"] }),
  });
  const read = useServerFn(getMemberPortal);
  // The open tab lives in the URL (?tab=…), so a refresh or "Try again" reopens it.
  const [tabParam, setTabParam] = useUrlParam("tab");
  const tab: Tab = TAB_IDS.includes(tabParam as Tab) ? (tabParam as Tab) : "bugs";
  const setTab = (t: Tab) => setTabParam(t === "bugs" ? null : t);
  const [sheet, setSheet] = useState(false);
  const [menu, setMenu] = useState(false);
  useScrollLock(menu);
  // Escape closes the mobile drawer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const [focus, setFocus] = useState<Focus>({ filter: "all", label: "All bugs" });
  const navigate = useNavigate();
  // Retry transient failures; a missing portal (null) is final and is not retried.
  const portal = useQuery({
    queryKey: ["personal-portal", type, token],
    queryFn: () => read({ data: { token, type } }),
    retry: 2,
    retryDelay: (n) => 1000 * 2 ** n,
    refetchOnWindowFocus: true,
    refetchInterval: 45000,
    refetchIntervalInBackground: true,
    staleTime: 0,
    gcTime: 0,
  });
  // Links keep working after an Admin changes the member's role: follow the portal's current type.
  useEffect(() => {
    const t = portal.data?.type;
    if (t && t !== type)
      void navigate({ to: `/${t}/$portalToken`, params: { portalToken: token }, replace: true });
  }, [portal.data?.type, type, token, navigate]);
  useMemberFavicon(
    portal.data ? { name: portal.data.name, code: portal.data.memberCode, panel: type } : null,
  );
  // Online while this portal is open; offline as soon as it's closed.
  usePresence(token, portal.data?.type ?? type, !!portal.data);
  // The member's own theme (saved on their portal) applies here and only here; leaving the portal drops it again.
  const { setPersonal } = useTheme();
  const hasPortal = !!portal.data;
  const personalKey = JSON.stringify(portal.data?.appearance ?? null);
  useEffect(() => {
    if (hasPortal) setPersonal(JSON.parse(personalKey) as PortalAppearance | null);
  }, [hasPortal, personalKey, setPersonal]);
  useEffect(() => () => setPersonal(null), [setPersonal]);
  // Remembered so in-app media links (/media/…) open from this browser without pasting the portal link again.
  useEffect(() => {
    if (hasPortal) rememberPortal(type, token);
  }, [hasPortal, type, token]);
  if (portal.isPending)
    return (
      <main className="bf-main">
        <div className="bf-access" role="status">
          <Bug className="mx-auto mb-4 animate-pulse text-primary" size={30} />
          <h1>Opening your portal…</h1>
          <p>
            <LiveClock />
          </p>
        </div>
      </main>
    );
  if (!portal.data)
    return (
      <div className="min-h-screen bg-background">
        <header className="bf-topbar">
          <strong>Bug Board</strong>
        </header>
        <main className="bf-main">
          <div className="bf-access">
            <LockKeyhole className="mx-auto mb-5 text-primary" size={32} />
            <h1>Portal unavailable</h1>
            <p>
              This link may be invalid, expired, or revoked. Ask your Admin for a new link if the
              problem continues.
            </p>
            {portal.isError && (
              <ErrorNotice
                message="This portal could not be verified. Please try again."
                onRetry={() => {
                  void portal.refetch();
                }}
                retrying={portal.isFetching}
              />
            )}
          </div>
        </main>
      </div>
    );
  const p = portal.data;
  const access: BugAccess = { kind: "portal", token, type };
  const role = roleText(p.role);
  const first = p.name.trim().split(/\s+/)[0] || p.name;
  // "access" is opened from the My projects card rather than the tab list, so it has its own title.
  const current = TABS.find((t) => t.id === tab) ?? ACCESS_VIEW;
  return (
    <div className="bf-shell">
      {menu && (
        <div className="bf-sidebar-scrim" aria-hidden="true" onClick={() => setMenu(false)} />
      )}
      <a href="#bf-main" className="bf-skip">
        Skip to content
      </a>
      <aside className="bf-sidebar" data-open={menu} aria-label="Portal navigation">
        <div className="bf-brand">
          <span className="bf-logo">
            <BrandMark />
          </span>
          <span className="bf-brand-name">
            Bug Board<span className="text-primary">.</span>
          </span>
        </div>
        <div className="bf-workspace">
          <span className="bf-avatar">{initials(p.name)}</span>
          <div className="min-w-0">
            <strong className="block truncate text-xs">{p.name}</strong>
            <span className="text-[11.5px] text-muted-foreground">
              {role} · <span className="font-mono">{p.memberCode}</span>
            </span>
          </div>
        </div>
        <div className="bf-nav-label">My portal</div>
        <nav className="bf-nav">
          {TABS.map((t) => (
            <button
              type="button"
              key={t.id}
              className="bf-nav-link"
              data-ui={t.id === "help" ? "help" : undefined}
              data-status={tab === t.id ? "active" : undefined}
              aria-current={tab === t.id ? "page" : undefined}
              onClick={() => {
                setTab(t.id);
                setMenu(false);
              }}
            >
              <t.icon />
              {t.label}
            </button>
          ))}
        </nav>
        <div className="bf-sidebar-bottom">
          {/* My projects opens the access view: assigned projects, role and permissions in one place. */}
          <button
            type="button"
            className="bf-connection bf-connection-link"
            data-status={tab === "access" ? "active" : undefined}
            aria-current={tab === "access" ? "page" : undefined}
            title="See your projects, role and permissions"
            onClick={() => {
              setTab("access");
              setMenu(false);
            }}
          >
            <span className="flex items-center gap-2 text-xs font-semibold">
              <FolderKanban size={15} />
              My projects
              <ShieldCheck size={13} className="ml-auto text-muted-foreground" />
            </span>
            <p className="mt-2 text-xs text-muted-foreground">
              {p.scope || "No projects assigned yet"}
            </p>
            <small className="mt-1 block text-[11px] text-primary">Projects &amp; access →</small>
          </button>
          <div className="flex items-center justify-between rounded-md border px-3 py-1 text-xs">
            <span>Theme</span>
            <ThemeToggle />
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
            <Button variant="link" className="p-0 text-xs" onClick={() => setTab("bugs")}>
              My portal
            </Button>
            <span className="text-xs text-muted-foreground">/ {current.label}</span>
          </div>
          <div className="bf-topbar-right">
            <span className="hidden text-xs text-muted-foreground md:inline" data-ui="clock">
              <LiveClock />
            </span>
            <ThemeToggle />
          </div>
        </header>
        <main id="bf-main" className="bf-main">
          <section className="bf-portal-hero" aria-label="About you">
            <div>
              <span className="bf-portal-role">
                {role}
                {p.scope ? ` · ${p.scope}` : ""}
              </span>
              <h1>Hi {first}</h1>
              <p>{roleGuide(p.role)}</p>
            </div>
            <dl className="bf-portal-meta">
              <div>
                <dt>
                  <Hash size={12} />
                  Member ID
                </dt>
                <dd className="font-mono">{p.memberCode}</dd>
              </div>
              <div>
                <dt>
                  <CalendarDays size={12} />
                  Member since
                </dt>
                <dd>{new Date(p.since).toLocaleDateString("en-GB", { dateStyle: "medium" })}</dd>
              </div>
              <div>
                <dt>
                  <ShieldCheck size={12} />
                  Permissions
                </dt>
                <dd>{p.permissions.length}</dd>
              </div>
            </dl>
          </section>
          {tab === "bugs" && (
            <>
              <div className="mb-3 flex justify-end">
                <Button size="sm" variant="outline" onClick={() => setSheet(true)}>
                  <FileSpreadsheet />
                  Export sheet
                </Button>
              </div>
              <Dialog open={sheet} onOpenChange={setSheet}>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Export my bugs as a sheet</DialogTitle>
                    <DialogDescription>
                      An .xlsx in the team's bug sheet layout, with colours, dropdowns and links.
                      Only bugs you can see are included.
                    </DialogDescription>
                  </DialogHeader>
                  <SheetExportLoader access={access} close={() => setSheet(false)} />
                </DialogContent>
              </Dialog>
              <PortalFocus
                access={access}
                role={p.role}
                permissions={p.permissions}
                focus={focus.filter}
                onFocus={setFocus}
              />
              <BugWorkspace
                key={focus.filter}
                access={access}
                initialFilter={focus.filter}
                initialFilterLabel={focus.label}
              />
            </>
          )}
          {tab === "media" && <MediaLibrary access={access} />}
          {tab === "access" && (
            <AccessPanel role={p.role} granted={p.permissions} scope={p.scope} />
          )}
          {tab === "ai" && (
            <div className="bf-panel p-5">
              <AiTokens scope={{ kind: "portal", token, type }} />
            </div>
          )}
          {tab === "theme" && (
            <div className="bf-panel p-5">
              <ThemeStudio scope="portal" token={token} type={type} />
            </div>
          )}
          {tab === "help" && (
            <div className="bf-panel p-5">
              <HelpContent audience="portal" role={p.role} />
            </div>
          )}
          <footer className="bf-footer">
            <span>Bug Board · {p.name}</span>
            <span>Private access · Shared records</span>
          </footer>
        </main>
      </div>
      <Dialog open={p.firstVisit && Boolean(p.welcome)}>
        <DialogContent className="max-h-[80vh] overflow-y-auto [&_.bf-dialog-close]:hidden">
          <DialogHeader>
            <DialogTitle>Welcome, {p.name}</DialogTitle>
            <DialogDescription>
              {p.scope} · {role}
            </DialogDescription>
          </DialogHeader>
          <p className="whitespace-pre-wrap text-sm leading-7">{p.welcome}</p>
          {welcome.isError && (
            <ErrorNotice message="Your welcome could not be dismissed. Please try again." />
          )}
          <Button
            disabled={welcome.isPending}
            onClick={() => welcome.mutate({ data: { token, type } })}
          >
            {welcome.isPending ? "Opening…" : "Continue to my bugs"}
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function LiveClock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);
  return (
    <time suppressHydrationWarning>
      {now
        ? now.toLocaleString("en-GB", {
            weekday: "short",
            day: "numeric",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })
        : ""}
    </time>
  );
}

/** "What needs me" cards: the whole view first, then four role-specific slices; each one filters the table below. */
function PortalFocus({
  access,
  role,
  permissions,
  focus,
  onFocus,
}: {
  access: BugAccess;
  role: string;
  permissions: string[];
  focus: string;
  onFocus: (f: Focus) => void;
}) {
  const fetch = useServerFn(getBugWorkspace);
  const q = useQuery({
    queryKey: ["bug-workspace", access, undefined],
    queryFn: () => fetch({ data: { access } }),
    retry: false,
    staleTime: 10000,
    refetchInterval: 20000,
  });
  const d = q.data;
  if (!d) return null;
  const cards = [
    {
      key: "all",
      label: "All in my view",
      hint: `${d.open} open · ${d.resolved} resolved`,
      filter: "all",
      tone: "neutral",
      count: d.total,
    },
    ...focusCounts(portalFocus(role, permissions), d.bugs, d.actor.userId),
  ];
  return (
    <>
      <div className="bf-status-cards bf-focus-cards" role="tablist" aria-label="Bugs that need me">
        {cards.map((c) => (
          <button
            type="button"
            role="tab"
            key={c.key}
            className="bf-status-card"
            data-selected={focus === c.filter}
            aria-selected={focus === c.filter}
            data-tone={c.tone}
            onClick={() => onFocus({ filter: c.filter, label: c.label })}
          >
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="bf-dot" />
              {c.label}
            </span>
            <strong>{c.count}</strong>
            <small>{c.hint}</small>
          </button>
        ))}
      </div>
      {d.nextCursor && (
        <p className="bf-focus-note">
          Counts cover the latest {d.bugs.length} bugs in your view; use Next in the table for older
          ones.
        </p>
      )}
    </>
  );
}

/** Every permission the role can have, marked granted or not, so people know what to ask for. */
function AccessPanel({ role, granted, scope }: { role: string; granted: string[]; scope: string }) {
  const all = rolePermissions[role] ?? (Object.keys(permissionLabels) as Permission[]);
  const extra = granted.filter((g) => !(all as string[]).includes(g)) as Permission[];
  return (
    <section className="grid gap-5" aria-label="My projects and access">
      <div className="bf-panel">
        <div className="bf-panel-heading">
          <h2>My projects</h2>
          <span className="bf-tag">{scope ? scope.split(",").length : 0} assigned</span>
        </div>
        <p className="px-5 py-4 text-sm leading-6 text-muted-foreground">
          {scope ? (
            <>
              You can see and report bugs in <strong className="text-foreground">{scope}</strong>.
              Bugs outside these projects never appear here.
            </>
          ) : (
            "No projects are assigned to you yet, so no bugs can be shown. Ask your Admin to add you to a project."
          )}
        </p>
      </div>
      <div className="bf-panel">
        <div className="bf-panel-heading">
          <h2>My access</h2>
          <span className="bf-tag">
            {granted.length} of {all.length + extra.length} enabled
          </span>
        </div>
        <div className="bf-perm-grid p-4">
          {[...all, ...extra].map((v) => {
            const on = granted.includes(v);
            return (
              <div key={v} className="bf-perm" data-on={on}>
                {on ? <CircleCheck size={16} /> : <CircleMinus size={16} />}
                <span>
                  <strong className="block text-[13px]">{permissionLabels[v] ?? v}</strong>
                  <small className="text-muted-foreground">
                    {on ? "Enabled" : "Not enabled — ask your Admin"}
                  </small>
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
