import { CitegeistError, Citekey, type Creator, type ItemFrontmatter } from "@citegeist/schema";

/** The default formula, identical to LibraryManifest.defaults.citekey. */
export const DEFAULT_CITEKEY_FORMULA = "auth.lower + year + shorttitle(1,0)";

/** The fields of an item the generator reads. */
export type CitekeySource = Pick<ItemFrontmatter, "title"> &
  Partial<Pick<ItemFrontmatter, "author" | "editor" | "issued">>;

const STOP_WORDS = new Set([
  // German
  "der",
  "die",
  "das",
  "des",
  "dem",
  "den",
  "ein",
  "eine",
  "einer",
  "eines",
  "einem",
  "einen",
  "und",
  "oder",
  "von",
  "vom",
  "zu",
  "zur",
  "zum",
  "im",
  "in",
  "am",
  "an",
  "auf",
  "aus",
  "bei",
  "mit",
  "nach",
  "fur",
  "uber",
  "als",
  "zwischen",
  // English
  "the",
  "a",
  "an",
  "of",
  "on",
  "in",
  "and",
  "or",
  "for",
  "to",
  "with",
  "from",
  "by",
  "at",
  "as",
  "is",
  "are",
  "about",
  "between",
  "towards",
  "toward",
]);

const SPECIAL_FOLD: Record<string, string> = {
  ß: "ss",
  ø: "o",
  Ø: "O",
  æ: "ae",
  Æ: "AE",
  œ: "oe",
  Œ: "OE",
  đ: "d",
  Đ: "D",
  ł: "l",
  Ł: "L",
  þ: "th",
  Þ: "TH",
  ð: "d",
  Ð: "D",
  ı: "i",
};

/** Folds accents and ligatures to plain ASCII letters ("Müller" gives "Muller", "Straße" gives "Strasse"). */
export function asciiFold(input: string): string {
  let out = "";
  for (const ch of input) out += SPECIAL_FOLD[ch] ?? ch;
  return out.normalize("NFKD").replace(/[̀-ͯ]/g, "");
}

function words(text: string): string[] {
  return asciiFold(text)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 0);
}

function firstCreator(item: CitekeySource): Creator | undefined {
  return item.author?.[0] ?? item.editor?.[0];
}

function authorPart(item: CitekeySource): string {
  const creator = firstCreator(item);
  if (!creator) return "anon";
  if ("literal" in creator) {
    const ws = words(creator.literal);
    return ws.find((w) => !STOP_WORDS.has(w)) ?? ws[0] ?? "anon";
  }
  const family = words(creator.family).join("");
  return family || "anon";
}

function yearPart(item: CitekeySource): string {
  const issued = item.issued;
  if (issued === undefined) return "nd";
  const match = /^-?(\d{1,4})/.exec(String(issued));
  return match?.[1] ?? "nd";
}

/** Significant title words: stop words dropped, only the part before the first colon or sentence end. */
function titleWords(title: string): string[] {
  const head = title.split(/[:.?!]\s/)[0] ?? title;
  const significant = words(head).filter((w) => !STOP_WORDS.has(w));
  if (significant.length > 0) return significant;
  const all = words(title).filter((w) => !STOP_WORDS.has(w));
  return all.length > 0 ? all : words(title);
}

/** shorttitle(n, m): n significant title words after skipping the first m. */
function shortTitle(item: CitekeySource, n: number, m: number): string {
  return titleWords(item.title)
    .slice(m, m + n)
    .join("");
}

type Token =
  | { kind: "term"; name: string; args: number[]; filters: string[] }
  | { kind: "literal"; value: string };

function tokenize(formula: string): Token[] {
  const tokens: Token[] = [];
  for (const rawPart of formula.split("+")) {
    const part = rawPart.trim();
    if (part === "") continue;
    const lit = /^"([^"]*)"$/.exec(part);
    if (lit) {
      tokens.push({ kind: "literal", value: lit[1] ?? "" });
      continue;
    }
    const m = /^([A-Za-z]+)(?:\(([^)]*)\))?((?:\.[A-Za-z]+)*)$/.exec(part);
    if (!m) throw badFormula(formula, `cannot parse "${part}"`);
    const args = (m[2] ?? "")
      .split(",")
      .map((a) => a.trim())
      .filter((a) => a !== "")
      .map((a) => {
        const n = Number(a);
        if (!Number.isInteger(n) || n < 0) throw badFormula(formula, `bad argument "${a}"`);
        return n;
      });
    const filters = (m[3] ?? "").split(".").filter((f) => f !== "");
    tokens.push({ kind: "term", name: (m[1] ?? "").toLowerCase(), args, filters });
  }
  if (tokens.length === 0) throw badFormula(formula, "formula is empty");
  return tokens;
}

function badFormula(formula: string, why: string): CitegeistError {
  return new CitegeistError({
    code: "CITEKEY_BAD_FORMULA",
    message: `Citekey formula "${formula}" is invalid: ${why}`,
    fix: `Use terms auth, year, shorttitle(n,m), veryshorttitle and "literals" joined by +, for example ${DEFAULT_CITEKEY_FORMULA}`,
    recovery: "fix-and-retry",
    context: { formula },
  });
}

function evalTerm(item: CitekeySource, token: Extract<Token, { kind: "term" }>, f: string): string {
  let value: string;
  switch (token.name) {
    case "auth":
    case "authorlast":
      value = authorPart(item);
      break;
    case "year":
      value = yearPart(item);
      break;
    case "shorttitle":
      value = shortTitle(item, token.args[0] ?? 3, token.args[1] ?? 0);
      break;
    case "veryshorttitle":
      value = shortTitle(item, 1, 0);
      break;
    case "title":
      value = words(item.title).join("");
      break;
    default:
      throw badFormula(f, `unknown term "${token.name}"`);
  }
  for (const filter of token.filters) {
    if (filter === "lower" || filter === "fold") continue; // the final key is always lower-case ASCII
    if (filter === "capitalize") {
      value = value.charAt(0).toUpperCase() + value.slice(1);
      continue;
    }
    throw badFormula(f, `unknown filter ".${filter}"`);
  }
  return value;
}

/** Reduces a string to the Citekey alphabet: lower-case ASCII letters, digits, underscore, hyphen. */
export function sanitizeCitekey(input: string): string {
  return asciiFold(input)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "")
    .replace(/^[_-]+/, "")
    .slice(0, 72);
}

/**
 * Computes the base key from a formula, without disambiguation. The formula is a `+` separated
 * list of `auth`, `year`, `shorttitle(n,m)` (n significant words after skipping the first m),
 * `veryshorttitle`, `title` and quoted literals, each with optional `.lower` or `.fold` filters.
 */
export function baseCitekey(
  item: CitekeySource,
  formula: string = DEFAULT_CITEKEY_FORMULA,
): string {
  const tokens = tokenize(formula);
  const raw = tokens
    .map((t) => (t.kind === "literal" ? t.value : evalTerm(item, t, formula)))
    .join("");
  const key = sanitizeCitekey(raw);
  return key.length >= 2 ? key : sanitizeCitekey(`${key}x`) || "item";
}

function letterSuffix(index: number): string {
  // 0 gives "a", 25 gives "z", 26 gives "aa"
  let n = index;
  let out = "";
  do {
    out = String.fromCharCode(97 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

/** Returns `base` if free, else the first of base+a, base+b, ... that is not in `existing`. */
export function disambiguateCitekey(base: string, existing: ReadonlySet<string>): string {
  if (!existing.has(base)) return base;
  for (let i = 0; ; i++) {
    const candidate = `${base}${letterSuffix(i)}`;
    if (!existing.has(candidate)) return candidate;
  }
}

/**
 * Generates a unique citekey. Deterministic: the same item and the same set of existing keys
 * always give the same key. The caller adds the result to its set before the next call.
 */
export function generateCitekey(
  item: CitekeySource,
  existing: ReadonlySet<string> = new Set(),
  formula: string = DEFAULT_CITEKEY_FORMULA,
): string {
  return disambiguateCitekey(baseCitekey(item, formula), existing);
}

/**
 * Picks the citekey of an imported item: the key from the source file when it is a valid Citekey
 * and not taken yet, else a freshly generated one.
 */
export function resolveImportedCitekey(
  draft: CitekeySource & { citekey?: string | undefined },
  existing: ReadonlySet<string> = new Set(),
  formula: string = DEFAULT_CITEKEY_FORMULA,
): string {
  const source = draft.citekey;
  if (source !== undefined && Citekey.safeParse(source).success && !existing.has(source)) {
    return source;
  }
  return generateCitekey(draft, existing, formula);
}
