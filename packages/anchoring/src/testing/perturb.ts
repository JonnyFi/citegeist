// Re-conversion simulation. Every perturbation keeps the origin map so ground truth survives.
import { type Mapped, replaceRegex } from "../mapped.js";

export { rng } from "./fixture.js";

import { rng } from "./fixture.js";

export type PerturbName = "ws" | "lig" | "hyph" | "word" | "wordDense" | "spacing" | "rehyph";

/** Char-level edit: fn returns the replacement for each char (empty string deletes). */
function edit(p: Mapped, fn: (c: string, i: number) => string): Mapped {
  let text = "";
  const src: number[] = [];
  for (let i = 0; i < p.text.length; i++) {
    const r = fn(p.text[i] ?? "", i);
    for (let k = 0; k < r.length; k++) {
      text += r[k];
      src.push(p.src[i] ?? -1);
    }
  }
  return { text, src };
}

const LIG_FORWARD: [RegExp, string][] = [
  [/ffi/g, "ﬃ"],
  [/ffl/g, "ﬄ"],
  [/ff/g, "ﬀ"],
  [/fi/g, "ﬁ"],
  [/fl/g, "ﬂ"],
];

export function perturb(paras: Mapped[], names: PerturbName[], seed = 1): Mapped[] {
  const rand = rng(seed);
  let out = paras;
  for (const name of names) {
    switch (name) {
      case "ws":
        // whitespace changes: doubled spaces, nbsp, hard line breaks, trailing blanks
        out = out.map((p) => {
          const e = edit(p, (c) => {
            if (c !== " ") return c;
            const r = rand();
            if (r < 0.04) return "  ";
            if (r < 0.07) return " ";
            if (r < 0.1) return "\n";
            return c;
          });
          return { text: e.text + " \n", src: [...e.src, -1, -1] };
        });
        break;
      case "lig":
        // the other engine keeps presentation-form ligatures
        out = out.map((p) => LIG_FORWARD.reduce((m, [re, to]) => replaceRegex(m, re, () => to), p));
        break;
      case "hyph":
        // hyphenation removed: half of the in-word hyphens vanish, a quarter become spaces
        out = out.map((p) =>
          replaceRegex(p, /(?<=\p{L})-(?=\p{L})/gu, () => {
            const r = rand();
            return r < 0.5 ? "" : r < 0.75 ? " " : "-";
          }),
        );
        break;
      case "word": {
        // one changed word in 5 percent of the paragraphs
        const pool = out.flatMap((p) => p.text.match(/\p{L}{4,}/gu) ?? []);
        out = out.map((p) => {
          if (rand() >= 0.05) return p;
          const words = [...p.text.matchAll(/\p{L}{4,}/gu)];
          if (words.length === 0) return p;
          const w = words[Math.floor(rand() * words.length)];
          if (!w) return p;
          let repl = pool[Math.floor(rand() * pool.length)] ?? "x";
          if (repl === w[0]) repl += "s";
          const at = w.index ?? 0;
          const src = [
            ...p.src.slice(0, at),
            ...new Array<number>(repl.length).fill(p.src[at] ?? -1),
            ...p.src.slice(at + w[0].length),
          ];
          return { text: p.text.slice(0, at) + repl + p.text.slice(at + w[0].length), src };
        });
        break;
      }
      case "wordDense": {
        // stress: about one word in 25 is replaced everywhere
        const pool = out.flatMap((p) => p.text.match(/\p{L}{4,}/gu) ?? []);
        out = out.map((p) =>
          replaceRegex(p, /\p{L}{4,}/gu, (m) => {
            if (rand() >= 0.04) return m[0];
            const r = pool[Math.floor(rand() * pool.length)] ?? "x";
            return r === m[0] ? r + "s" : r;
          }),
        );
        break;
      }
      case "spacing":
        // extraction differences: 1.5 percent of word gaps glued, 1 percent of words split
        out = out.map((p) =>
          edit(p, (c, i) => {
            if (c === " ") return rand() < 0.015 ? "" : c;
            if (
              /\p{L}/u.test(c) &&
              /\p{L}/u.test(p.text[i + 1] ?? "") &&
              /\p{L}/u.test(p.text[i - 1] ?? "") &&
              rand() < 0.003
            )
              return c + " ";
            return c;
          }),
        );
        break;
      case "rehyph":
        // failed dehyphenation: 5 percent of long words keep a "- " in the middle
        out = out.map((p) =>
          replaceRegex(p, /\p{L}{9,}/gu, (m) => {
            if (rand() >= 0.05) return m[0];
            const k = 3 + Math.floor(rand() * (m[0].length - 6));
            return m[0].slice(0, k) + "- " + m[0].slice(k);
          }),
        );
        break;
    }
  }
  return out;
}
