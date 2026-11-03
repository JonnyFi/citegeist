import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

/** The custom properties of one theme block (`:root` or `.dark`). */
function tokens(selector: string): Record<string, string> {
  const start = css.indexOf(`\n${selector} {`);
  const end = css.indexOf("\n}", start);
  const out: Record<string, string> = {};
  for (const m of css.slice(start, end).matchAll(/--([\w-]+):\s*([^;]+);/g)) {
    out[m[1] as string] = (m[2] as string).trim();
  }
  return out;
}

type Rgb = [number, number, number];

function parse(value: string): { rgb: Rgb; alpha: number } {
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const n = Number.parseInt(hex[1] as string, 16);
    return { rgb: [(n >> 16) & 255, (n >> 8) & 255, n & 255], alpha: 1 };
  }
  const rgba = /^rgba?\(([^)]+)\)$/.exec(value);
  if (!rgba) throw new Error(`cannot read the colour '${value}'`);
  const [r, g, b, a] = (rgba[1] as string).split(",").map((x) => Number.parseFloat(x));
  return { rgb: [r as number, g as number, b as number], alpha: a ?? 1 };
}

const luminance = ([r, g, b]: Rgb): number => {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};

const contrast = (a: Rgb, b: Rgb): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi as number) + 0.05) / ((lo as number) + 0.05);
};

/** The colour the eye sees when the translucent fill lies over a ground. */
function over(fill: string, ground: Rgb): Rgb {
  const { rgb, alpha } = parse(fill);
  return rgb.map((c, i) => c * alpha + (ground[i] as number) * (1 - alpha)) as Rgb;
}

const COLORS = ["yellow", "green", "blue", "red"] as const;
const WHITE: Rgb = [255, 255, 255];
const BLACK: Rgb = [0, 0, 0];

describe("highlight colour tokens", () => {
  // protects=text stays readable (at least 4.5:1) on every highlight fill in both themes, on every ground it can lie over;
  // fails_when=a fill is made too strong, or a theme loses a token; no_claim=contrast of the solid dots and card tabs
  it.each([":root", ".dark"])("keeps text readable on the fills in %s", (selector) => {
    const t = tokens(selector);
    const grounds = ["bg", "surface", "sunken"].map((k) => parse(t[k] as string).rgb);
    for (const color of COLORS) {
      const fill = t[`hl-${color}-fill`];
      expect(fill, `--hl-${color}-fill in ${selector}`).toBeDefined();
      expect(t[`hl-${color}`], `--hl-${color} in ${selector}`).toBeDefined();
      const ink = parse(t.ink as string).rgb;
      for (const ground of grounds) {
        expect(
          contrast(ink, over(fill as string, ground)),
          `${color} in ${selector}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
      // the PDF page stays white in both themes and its text is dark
      expect(
        contrast(BLACK, over(fill as string, WHITE)),
        `${color} on the PDF page`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
});
