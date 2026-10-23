import { useEffect } from "react";

const SELECTOR =
  ".bf-ov-scroll, .bf-recent-scroll, .bf-urgent-scroll, .bf-barlist[data-scroll], .bf-ov-panel > .bf-ov-team";

/**
 * Marks scroll boxes that really overflow with `data-can-scroll`, so the stylesheet shows its
 * "Scroll for more" fade only where there is more to see. Re-checks when boxes resize or the DOM changes.
 */
export function ScrollHints() {
  useEffect(() => {
    const mark = (el: HTMLElement) => {
      if (el.scrollHeight > el.clientHeight + 2) el.setAttribute("data-can-scroll", "");
      else el.removeAttribute("data-can-scroll");
    };
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) mark(e.target as HTMLElement);
    });
    const watched = new WeakSet<Element>();
    const scan = () => {
      for (const el of document.querySelectorAll<HTMLElement>(SELECTOR)) {
        if (!watched.has(el)) {
          watched.add(el);
          ro.observe(el);
        }
        mark(el);
      }
    };
    scan();
    const mo = new MutationObserver(scan);
    mo.observe(document.body, { childList: true, subtree: true });
    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, []);
  return null;
}
