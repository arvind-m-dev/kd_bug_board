import { useEffect, useState, type RefObject } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const tips = [
  [
    "A gift for your next bug report",
    "Include the exact steps, what you expected, and what actually happened. A small reproducible example is a big gift to your teammate.",
  ],
  [
    "One variable at a time",
    "When investigating a bug, change one thing and repeat the same steps. It makes the cause easier to spot.",
  ],
  [
    "Make the fix last",
    "After fixing a bug, check the original reproduction and a nearby edge case. Add a regression test when it protects meaningful behavior.",
  ],
  [
    "A little debugging wisdom",
    "“Make it work, then make it clear.” Leave a short note explaining the cause and how you verified the fix.",
  ],
  [
    "Give your future self a gift",
    "Record the browser, app version, and relevant error message. Remove passwords and private information from screenshots and logs.",
  ],
];
type Gift = { id: number; x: number; y: number; tip: number };
export function SeasonalGifts({ host }: { host: RefObject<HTMLDivElement | null> }) {
  const [gifts, setGifts] = useState<Gift[]>([]);
  const [opened, setOpened] = useState<Gift | null>(null);
  useEffect(() => {
    let next = 0;
    const target = host.current;
    const drop = (event: Event) => {
      const { x, y } = (event as CustomEvent<{ x: number; y: number }>).detail;
      const gift = { id: ++next, x, y, tip: Math.floor(Math.random() * tips.length) };
      setGifts((current) =>
        [...current.filter((g) => Math.hypot(g.x - x, g.y - y) > 35), gift].slice(-4),
      );
    };
    // Fixed-position presents never linger over content after it moves.
    const clear = () => setGifts([]);
    target?.addEventListener("seasonal-gift", drop);
    window.addEventListener("scroll", clear, true);
    window.addEventListener("resize", clear);
    return () => {
      target?.removeEventListener("seasonal-gift", drop);
      window.removeEventListener("scroll", clear, true);
      window.removeEventListener("resize", clear);
    };
  }, [host]);
  return (
    <>
      <div className="bf-seasonal-gifts">
        {gifts.map((gift) => (
          <button
            key={gift.id}
            className="bf-seasonal-gift"
            style={{ left: gift.x, top: gift.y }}
            aria-label="Open Santa’s debugging gift"
            title="A debugging gift from Santa"
            onClick={() => {
              setOpened(gift);
              setGifts((current) => current.filter((g) => g.id !== gift.id));
            }}
          >
            <svg aria-hidden="true" viewBox="0 0 36 38" width="30" height="32">
              <path d="M3 13 18 7 33 13 18 20Z" fill="#fa6876" />
              <path d="M3 13 18 20V36L3 29Z" fill="#be2346" />
              <path d="M18 20 33 13V29L18 36Z" fill="#861c3d" />
              <path d="m9 10 15 7 5-2-15-7Z" fill="#fff0b0" />
              <path d="m23 9-15 6 5 3 15-7Z" fill="#ffd66b" />
              <path d="m9 16 5 2v16l-5-3Z" fill="#ffd66b" />
              <path d="m24 17 5-2v16l-5 3Z" fill="#dda63b" />
              <path
                d="M18 9C4 10 8-4 18 9c10-13 14 1 0 0Z"
                fill="none"
                stroke="#ffe7a1"
                strokeWidth="3"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        ))}
      </div>
      <Dialog
        open={!!opened}
        onOpenChange={(open) => {
          if (!open) setOpened(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tips[opened?.tip ?? 0]![0]}</DialogTitle>
            <DialogDescription>{tips[opened?.tip ?? 0]![1]}</DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    </>
  );
}
