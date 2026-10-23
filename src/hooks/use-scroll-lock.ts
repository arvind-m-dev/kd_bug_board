import { useEffect } from "react";

/** Stops the page behind an open drawer from scrolling (the drawer's own content still scrolls). */
export function useScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const { body, documentElement: html } = document;
    const prev = { body: body.style.overflow, html: html.style.overscrollBehavior };
    body.style.overflow = "hidden";
    html.style.overscrollBehavior = "none";
    return () => {
      body.style.overflow = prev.body;
      html.style.overscrollBehavior = prev.html;
    };
  }, [active]);
}
