import { seededRandom } from "@/lib/appearance";

/**
 * A spider's orb web anchored in a corner: radial spokes from the anchor, rings that sag between them, a few missing
 * segments so it looks lived-in, and a small spider sitting on it. Each thread has pathLength=1 so CSS can draw it in.
 * Built for the top-right corner; the other corners are mirrored with a transform.
 */
export function Web({
  corner,
  size = 190,
  seed = 1,
}: {
  corner: "tr" | "bl" | "tl";
  size?: number;
  seed?: number;
}) {
  const rand = seededRandom(seed * 7 + 3);
  const S = 200;
  const ax = S,
    ay = 0;
  const spokes = 9;
  const angles = Array.from(
    { length: spokes },
    (_, i) =>
      Math.PI / 2 +
      (Math.PI / 2) * (i / (spokes - 1)) +
      (i === 0 || i === spokes - 1 ? 0 : (rand() - 0.5) * 0.06),
  );
  const point = (r: number, a: number) => [ax + r * Math.cos(a), ay + r * Math.sin(a)] as const;
  const paths: { d: string; delay: number; thin?: boolean }[] = [];
  angles.forEach((a, i) => {
    const [x, y] = point(S * 1.05, a);
    paths.push({ d: `M${ax} ${ay} L${x.toFixed(1)} ${y.toFixed(1)}`, delay: i * 0.25 });
  });
  const rings = [24, 42, 60, 80, 100, 122, 146, 172];
  rings.forEach((r, ri) => {
    for (let i = 0; i < spokes - 1; i++) {
      if (rand() < 0.07 && ri > 1) continue; // a broken segment now and then
      const r1 = r * (0.97 + rand() * 0.06),
        r2 = r * (0.97 + rand() * 0.06);
      const [x1, y1] = point(r1, angles[i]!),
        [x2, y2] = point(r2, angles[i + 1]!);
      const [cx, cy] = point(r * 0.9, (angles[i]! + angles[i + 1]!) / 2);
      paths.push({
        d: `M${x1.toFixed(1)} ${y1.toFixed(1)} Q${cx.toFixed(1)} ${cy.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`,
        delay: 2.4 + ri * 1.1 + i * 0.12,
        thin: true,
      });
    }
  });
  const [sx, sy] = point(112, angles[5]!);
  const transform =
    corner === "bl" ? "scale(-1, -1)" : corner === "tl" ? "scale(-1, 1)" : undefined;
  return (
    <svg
      className={`bf-web bf-web-${corner}`}
      viewBox={`0 0 ${S} ${S}`}
      width={size}
      height={size}
      style={transform ? { transform } : undefined}
      aria-hidden="true"
    >
      <g fill="none" stroke="currentColor" strokeLinecap="round">
        {paths.map((p, i) => (
          <path
            key={i}
            d={p.d}
            pathLength={1}
            strokeWidth={p.thin ? 0.7 : 1}
            style={{ animationDelay: `${p.delay}s` }}
          />
        ))}
      </g>
      <g
        className="bf-web-spider"
        transform={`translate(${sx.toFixed(1)} ${sy.toFixed(1)})`}
        fill="currentColor"
      >
        <path
          d="M-7 -6 L-13 -11 M-8 -2 L-15 -2 M-7 2 L-13 7 M7 -6 L13 -11 M8 -2 L15 -2 M7 2 L13 7"
          stroke="currentColor"
          strokeWidth="1.2"
          fill="none"
        />
        <circle r="3.2" cy="-4" />
        <ellipse rx="4.2" ry="5.2" cy="3" />
      </g>
    </svg>
  );
}
