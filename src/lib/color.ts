/**
 * Colour maths for custom themes. A colour picker gives sRGB hex; the theme tokens are OKLCH with a fixed
 * lightness per mode, so any accent the Admin picks keeps readable text on it (Björn Ottosson's OKLab, 2020).
 */
export type Oklch = { l: number; c: number; h: number };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/** '#rgb' or '#rrggbb' (case-insensitive) → [r,g,b] in 0–255, or null. */
export function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const s = m[1]!.length === 3 ? [...m[1]!].map((ch) => ch + ch).join("") : m[1]!;
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16)) as [number, number, number];
}

export function hexToOklch(hex: string): Oklch | null {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb.map((v) => toLinear(v / 255)) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const c = Math.hypot(A, B);
  const h = c < 1e-4 ? 0 : ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360;
  return { l: clamp(L, 0, 1), c, h };
}

/** OKLCH → sRGB hex; chroma is reduced until the colour fits the sRGB gamut, so hues never clip to neon. */
export function oklchToHex({ l, c, h }: Oklch): string {
  const rad = (h * Math.PI) / 180;
  for (let cc = c; cc >= 0; cc -= 0.005) {
    const a = cc * Math.cos(rad),
      b = cc * Math.sin(rad);
    const l_ = l + 0.3963377774 * a + 0.2158037573 * b,
      m_ = l - 0.1055613458 * a - 0.0638541728 * b,
      s_ = l - 0.0894841775 * a - 1.291485548 * b;
    const L = l_ ** 3,
      M = m_ ** 3,
      S = s_ ** 3;
    const rgb = [
      4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S,
      -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S,
      -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S,
    ];
    if (rgb.every((v) => v >= -0.0005 && v <= 1.0005) || cc < 0.005)
      return `#${rgb
        .map((v) =>
          Math.round(clamp(toGamma(clamp(v, 0, 1)), 0, 1) * 255)
            .toString(16)
            .padStart(2, "0"),
        )
        .join("")}`;
  }
  return "#000000";
}

export const oklch = ({ l, c, h }: Oklch) =>
  `oklch(${+l.toFixed(3)} ${+c.toFixed(3)} ${+h.toFixed(1)})`;

/** Brand tokens for one mode, from an accent (and optional partner) the Admin picked. Lightness is pinned per mode so the text on it stays readable; chroma is capped so it stays a UI colour, not a neon. */
export function brandTokens(accentHex: string, partnerHex: string | null, dark: boolean) {
  const a = hexToOklch(accentHex) ?? { l: 0.5, c: 0.1, h: 192 };
  const p = partnerHex ? hexToOklch(partnerHex) : null;
  const hue2 = p ? p.h : (a.h + 50) % 360;
  const chroma2 = p ? p.c : a.c;
  const cap = (c: number) => clamp(c, 0.02, dark ? 0.15 : 0.19);
  return dark
    ? {
        primary: oklch({ l: 0.78, c: cap(a.c), h: a.h }),
        primaryForeground: oklch({ l: 0.19, c: Math.min(0.04, a.c), h: a.h }),
        brand2: oklch({ l: 0.75, c: cap(chroma2), h: hue2 }),
        accent: oklch({ l: 0.31, c: Math.min(0.06, a.c), h: a.h }),
      }
    : {
        primary: oklch({ l: 0.5, c: cap(a.c), h: a.h }),
        primaryForeground: "oklch(1 0 0)",
        brand2: oklch({ l: 0.53, c: cap(chroma2), h: hue2 }),
        accent: oklch({ l: 0.945, c: Math.min(0.035, a.c), h: a.h }),
      };
}

/** The hex a colour input should show for a preset token like 'oklch(0.5 0.1 192)'. */
export function cssOklchToHex(value: string): string | null {
  const m = /oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(value);
  if (!m) return null;
  return oklchToHex({ l: Number(m[1]), c: Number(m[2]), h: Number(m[3]) });
}
