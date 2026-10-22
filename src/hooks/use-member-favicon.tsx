import { useEffect } from "react";

/** Stable hue per member so each portal tab is recognisable. */
export function memberHue(code: string) {
  let h = 0;
  for (const c of code) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

export function memberInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0]![0]! + parts[parts.length - 1]![0]! : (parts[0] ?? "?").slice(0, 2);
  return letters.toUpperCase();
}

/** Each panel type has its own badge colour and letter, so one person's Reporter, QA and Developer tabs still look different. */
export const PANEL_BADGES: Record<string, { letter: string; color: string; label: string }> = {
  reporter: { letter: "R", color: "#e2742a", label: "Reporter portal" },
  qa: { letter: "Q", color: "#2a9d5c", label: "QA portal" },
  developer: { letter: "D", color: "#4f6bed", label: "Developer portal" },
  member: { letter: "M", color: "#7c5cd6", label: "Member portal" },
};
export const panelLabel = (panel: string | undefined) => (panel && PANEL_BADGES[panel]?.label) || "Portal";

const safe = (s: string) => s.replace(/[<>&"]/g, "");

/** Initials on the member's colour; with a panel, a badge in the corner names the panel. */
export function memberFaviconSvg(name: string, code: string, panel?: string) {
  const hue = memberHue(code);
  const badge = panel ? PANEL_BADGES[panel] : undefined;
  const corner = badge
    ? `<circle cx="49" cy="49" r="14" fill="${badge.color}" stroke="#fff" stroke-width="3"/><text x="49" y="55" font-family="Arial,Helvetica,sans-serif" font-size="17" font-weight="700" fill="#fff" text-anchor="middle">${badge.letter}</text>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="hsl(${hue} 65% 42%)"/><text x="${badge ? 27 : 32}" y="${badge ? 38 : 42}" font-family="Arial,Helvetica,sans-serif" font-size="${badge ? 24 : 26}" font-weight="700" fill="#fff" text-anchor="middle">${safe(memberInitials(name))}</text>${corner}</svg>`;
}

/**
 * Swap the tab icon and title for the signed-in member and panel; restores the defaults on leave.
 * The head is owned by the router, which can re-render its <link> tags, so new icon links are patched as they appear.
 */
export function useMemberFavicon(member: { name: string; code: string; panel?: string } | null) {
  const name = member?.name;
  const code = member?.code;
  const panel = member?.panel;
  useEffect(() => {
    if (!name || !code) return;
    const href = `data:image/svg+xml,${encodeURIComponent(memberFaviconSvg(name, code, panel))}`;
    const previous = new Map<HTMLLinkElement, readonly [string, string]>();
    const apply = () => {
      for (const l of document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]')) {
        if (l.href === href) continue;
        if (!previous.has(l)) previous.set(l, [l.getAttribute("href") ?? "", l.type] as const);
        l.href = href; l.type = "image/svg+xml";
      }
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.head, { childList: true, subtree: true, attributes: true, attributeFilter: ["href"] });
    const title = document.title;
    document.title = `${name} · ${panelLabel(panel)} · Futurist Global Bug Board`;
    return () => {
      observer.disconnect();
      for (const [l, [h, t]] of previous) { if (l.isConnected) { l.setAttribute("href", h); l.type = t; } }
      document.title = title;
    };
  }, [name, code, panel]);
}
