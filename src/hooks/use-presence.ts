import { useEffect } from "react";

const HEARTBEAT_MS = 30_000;

/**
 * Live presence for a member portal: says "here" on open and every 30 s, again as soon as the tab is
 * shown, and "leaving" when the page is closed or left (sent with keepalive so it survives the unload).
 */
export function usePresence(token: string, type: string, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const send = (state: "here" | "leaving") => {
      try {
        void fetch("/api/presence", {
          method: "POST",
          keepalive: true,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token, type, state }),
        }).catch(() => undefined);
      } catch {
        /* offline: the server-side expiry takes over */
      }
    };
    send("here");
    // Keep beating in background tabs too (browsers slow these to ~1/min, still inside the online window).
    const timer = window.setInterval(() => send("here"), HEARTBEAT_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") send("here");
    };
    const onLeave = () => send("leaving");
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pagehide", onLeave);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pagehide", onLeave);
      send("leaving");
    };
  }, [token, type, enabled]);
}
