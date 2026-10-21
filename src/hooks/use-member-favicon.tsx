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

export function memberFaviconSvg(name: string, code: string) {
  const hue = memberHue(code);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="hsl(${hue} 65% 42%)"/><text x="32" y="42" font-family="Arial,Helvetica,sans-serif" font-size="26" font-weight="700" fill="#fff" text-anchor="middle">${memberInitials(name).replace(/[<>&"]/g, "")}</text></svg>`;
}

/** Swap the tab icon and title for the signed-in member; restores the defaults on leave. */
export function useMemberFavicon(member: { name: string; code: string } | null) {
  const name = member?.name;
  const code = member?.code;
  useEffect(() => {
    if (!name || !code) return;
    const icons = [...document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]')];
    const previous = icons.map((l) => [l, l.href, l.type] as const);
    const href = `data:image/svg+xml,${encodeURIComponent(memberFaviconSvg(name, code))}`;
    for (const l of icons) { l.href = href; l.type = "image/svg+xml"; }
    const title = document.title;
    document.title = `${name} · Futurist Global Bug Board`;
    return () => {
      for (const [l, h, t] of previous) { l.href = h; l.type = t; }
      document.title = title;
    };
  }, [name, code]);
}
