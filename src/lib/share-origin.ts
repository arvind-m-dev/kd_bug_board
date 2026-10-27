import { toast } from "sonner";

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)$/;
/** VITE_SITE_URL as an origin, when it is a valid http(s) URL. */
function siteOrigin(): string | null {
  const raw = import.meta.env["VITE_SITE_URL"] as string | undefined;
  try {
    const u = raw ? new URL(raw) : null;
    return u && (u.protocol === "https:" || u.protocol === "http:") ? u.origin : null;
  } catch {
    return null;
  }
}
/**
 * The address to put in links other people open (portal links, file links, exports). On a local dev server that is
 * the live site (VITE_SITE_URL) when configured: a copied localhost link only works on the copier's own computer.
 */
export function shareOrigin(): string {
  if (typeof window === "undefined") return siteOrigin() ?? "";
  if (!LOCAL_HOST.test(window.location.hostname)) return window.location.origin;
  return siteOrigin() ?? window.location.origin;
}
/** Warns after copying when the link still points at this computer, so it is not sent to a colleague by mistake. */
export function warnIfLocalLink(url: string) {
  try {
    if (!LOCAL_HOST.test(new URL(url).hostname)) return;
  } catch {
    return;
  }
  toast.warning("This link points to your own computer", {
    description:
      "Colleagues cannot open localhost links. Copy it from the live site, or set VITE_SITE_URL so copies use the live address.",
  });
}
