import { useEffect } from "react";

const VERTICAL =
  ".bf-ov-scroll, .bf-recent-scroll, .bf-urgent-scroll, .bf-barlist[data-scroll], .bf-ov-panel > .bf-ov-team";
const HORIZONTAL = ".bf-table-wrap, .bf-people ul";

/**
 * Marks scroll boxes that really overflow — `data-can-scroll` (down) and `data-can-scroll-x` (sideways) —
 * so the stylesheet shows its "more to see" fades only where they are true. Re-checks on resize and DOM changes.
 */
export function ScrollHints() {
  useEffect(() => {
    const flag = (el: HTMLElement, name: string, on: boolean) => {
      if (on) el.setAttribute(name, "");
      else el.removeAttribute(name);
    };
    const mark = (el: HTMLElement) => {
      flag(el, "data-can-scroll", el.matches(VERTICAL) && el.scrollHeight > el.clientHeight + 2);
      flag(el, "data-can-scroll-x", el.matches(HORIZONTAL) && el.scrollWidth > el.clientWidth + 2);
    };
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) mark(e.target as HTMLElement);
    });
    const watched = new WeakSet<Element>();
    const scan = () => {
      for (const el of document.querySelectorAll<HTMLElement>(`${VERTICAL}, ${HORIZONTAL}`)) {
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
