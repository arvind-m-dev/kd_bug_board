import { useEffect, useState } from "react";
import { ArrowUp } from "lucide-react";

const still = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
  document.documentElement.getAttribute("data-motion") === "off";

/** Appears after about two screens of scrolling; the stylesheet places it above the floating bin. */
export function BackToTop() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > window.innerHeight * 1.5);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  if (!show) return null;
  return (
    <button
      type="button"
      className="bf-back-top"
      aria-label="Back to top"
      title="Back to top"
      onClick={() => window.scrollTo({ top: 0, behavior: still() ? "auto" : "smooth" })}
    >
      <ArrowUp />
    </button>
  );
}
