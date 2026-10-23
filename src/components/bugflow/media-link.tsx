import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BugDetails } from "./bug-workspace";
import { BrandMark } from "./decorations";
import { ThemeToggle } from "./theme-toggle";
import { getBugWorkspace } from "@/lib/bug-workflow.functions";
import type { BugAccess, BugWorkspaceData } from "@/lib/bug-workflow";

export const PORTAL_MEMORY_KEY = "bugflow-portal";
/** The portal last opened in this browser, so in-app media links can open without pasting the portal link again. */
export function rememberPortal(type: string, token: string) {
  try {
    localStorage.setItem(PORTAL_MEMORY_KEY, JSON.stringify({ type, token }));
  } catch {
    /* storage unavailable */
  }
}
function rememberedPortal(): BugAccess | null {
  try {
    const v = JSON.parse(localStorage.getItem(PORTAL_MEMORY_KEY) ?? "null") as {
      type?: string;
      token?: string;
    } | null;
    if (
      v &&
      typeof v.token === "string" &&
      /^[a-f0-9]{64}$/.test(v.token) &&
      ["reporter", "qa", "developer", "member"].includes(v.type ?? "")
    )
      return {
        kind: "portal",
        token: v.token,
        type: v.type as "reporter" | "qa" | "developer" | "member",
      };
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * /media/:bugId?m=:mediaId — an in-app link to a bug's files. It works for an Admin who is signed in and for a member whose
 * portal was opened in this browser; everyone else is asked to open their own link first. Authorization stays on the server:
 * the bug is loaded through the same scoped functions as everywhere else.
 */
export function MediaLinkPage({ bugId, mediaId }: { bugId: string; mediaId?: string | undefined }) {
  const fetch = useServerFn(getBugWorkspace);
  const [state, setState] = useState<
    { access: BugAccess; workspace: BugWorkspaceData } | "loading" | "denied"
  >("loading");
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const candidates: BugAccess[] = [{ kind: "admin" }];
      const portal = rememberedPortal();
      if (portal) candidates.unshift(portal);
      for (const access of candidates) {
        try {
          const workspace = await fetch({ data: { access } });
          if (!cancelled) setState({ access, workspace });
          return;
        } catch {
          /* try the next one */
        }
      }
      if (!cancelled) setState("denied");
    })();
    return () => {
      cancelled = true;
    };
  }, [fetch]);
  const back =
    state !== "loading" && state !== "denied"
      ? state.access.kind === "portal"
        ? `/${state.access.type}/${state.access.token}`
        : "/admin/bugs"
      : "/";
  return (
    <div className="min-h-screen">
      <header className="bf-topbar">
        <div className="bf-topbar-left">
          <span className="bf-logo">
            <BrandMark />
          </span>
          <strong>Attachment</strong>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link to={back}>
              <ArrowLeft />
              {state !== "loading" && state !== "denied" && state.access.kind === "admin"
                ? "All bugs"
                : "My portal"}
            </Link>
          </Button>
          <ThemeToggle />
        </div>
      </header>
      <main className="bf-main">
        {state === "loading" && (
          <p role="status" className="py-8 text-center text-sm text-muted-foreground">
            Opening…
          </p>
        )}
        {state === "denied" && (
          <div className="bf-access">
            <LockKeyhole className="mx-auto mb-5 text-primary" size={30} />
            <h1>Open your portal first</h1>
            <p>
              This link opens a bug's files for people who have access to that bug. Sign in as
              Admin, or open your personal portal link once in this browser, then open this link
              again.
            </p>
            <Button asChild className="mt-4">
              <Link to="/login">Admin sign-in</Link>
            </Button>
          </div>
        )}
        {state !== "loading" && state !== "denied" && (
          <div className="bf-panel p-5">
            <BugDetails
              id={bugId}
              access={state.access}
              workspace={state.workspace}
              openMediaId={mediaId}
            />
          </div>
        )}
      </main>
    </div>
  );
}
