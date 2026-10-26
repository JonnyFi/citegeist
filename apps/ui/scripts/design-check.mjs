// Takes 1280x820 screenshots of the app against the mock core, one per screen. Screens that
// mirror a design board can also be compared with the board files when DESIGN_BOARDS_DIR points
// at a folder of them (the boards are not part of this repository).
//
//   pnpm --filter @citegeist/ui design-check --lang=en  English screenshots with English file names
//                                                      (the ones committed to docs/design/screens)
//   pnpm --filter @citegeist/ui design-check            German screenshots with German file names
//                                                      (not committed; the mock library is German too)
//   pnpm --filter @citegeist/ui design-check --lang=en --only=graph
//                                                      only the named screens
//   DESIGN_BOARDS_DIR=<dir> pnpm --filter @citegeist/ui design-check --boards
//                                                      also screenshots of the board files
//
// Output goes to docs/design/screens/ at the repository root. The script starts
// `vite --mode mock` itself on port 5188 (DESIGN_CHECK_PORT) when nothing listens there.
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(here, "..");
const repo = resolve(appDir, "../..");
const out = join(repo, "docs", "design", "screens");
const port = process.env.DESIGN_CHECK_PORT ?? "5188";
const url = `http://localhost:${port}`;
const boardsDir = process.env.DESIGN_BOARDS_DIR;
const withBoards = process.argv.includes("--boards") && Boolean(boardsDir);
const lang = process.argv.includes("--lang=en") ? "en" : "de";
// --only=graph,graph-edge takes only the screens with these (English or German) names
const only = process.argv
  .find((a) => a.startsWith("--only="))
  ?.slice("--only=".length)
  .split(",");

/** UI texts the shots look for, German and English. */
const TEXT = {
  add: ["Hinzufügen", "Add"],
  added: ["Hinzugefügt:", "Added:"],
  sources: ["Metadatenquellen", "Metadata sources"],
  chatAgent: ["Chat-Agent", "Chat agent"],
  semantic: ["Suche nach Bedeutung", "Search by meaning"],
  model: ["Embedding-Modell", "Embedding model"],
  pathFile: ["Pfad zur Datei", "Path to the file"],
  preview: ["Vorschau", "Preview"],
  pathZotero: [
    "Pfad zu zotero.sqlite oder zum Zotero-Ordner",
    "Path to zotero.sqlite or to the Zotero folder",
  ],
  projects: ["Projekten", "Projects"],
  run: ["Importieren", "Import"],
  newMatrix: ["Neue Matrix", "New matrix"],
  createMatrix: ["Matrix anlegen", "Create matrix"],
  createForm: ["Matrix anlegen", "Create a matrix"],
  question: ["Fragestellung", "Research question"],
  method: ["Methode", "Method"],
  finding: ["Ergebnis", "Result"],
  matrixTable: ["Literaturmatrix", "Literature matrix"],
  fillOpen: ["Offene Zellen füllen", "Fill open cells"],
  filling: ["Zellen werden gefüllt", "Filling cells"],
  related: ["Verwandte Werke", "Related works"],
  citing: ["Zitiert von", "Cited by"],
  retracted: ["Zurückgezogen", "Retracted"],
  composer: ["Nachricht an den Agent", "Message to the agent"],
  agentMessage: [
    "Ich sehe eine Verbindung zwischen Luhmann und Gillespie, bitte notieren",
    "I see a connection between Luhmann and Gillespie, please note this",
  ],
  agentNoted: [
    "Notiert in 2, Luhmanns Kommunikationsbegriff.",
    "Noted in 2, Luhmann's concept of communication.",
  ],
  nodes: ["Knoten", "Nodes"],
  showCards: ["Karten zeigen", "Show cards"],
  edgeOpposes: [
    /Luhmann 1984 widerspricht .* Habermas 1981/,
    /Luhmann 1984 opposes .* Habermas 1981/,
  ],
  bibFile: ["/Users/alex/Zotero/export/bibliothek.bib", "/Users/alex/Zotero/export/library.bib"],
};
const tx = (key) => TEXT[key][lang === "en" ? 1 : 0];

const READ = "#/items/luhmann1984soziale?tab=read";

/** Each entry mirrors one board: where to go and what to click before the shot. */
const screens = [
  {
    name: "lesen-hell",
    enName: "reading-light",
    hash: READ,
    async setup(page) {
      await showText(page);
      await openFirstCard(page);
    },
  },
  {
    name: "lesen-dunkel",
    enName: "reading-dark",
    hash: READ,
    theme: "dark",
    async setup(page) {
      await showText(page);
      await openFirstCard(page);
    },
  },
  {
    name: "lesen-agent-chat",
    enName: "reading-agent-chat",
    hash: READ,
    async setup(page) {
      await showText(page);
      await page.getByRole("tab", { name: /^Agent/ }).click();
    },
  },
  {
    name: "quelle-uebersicht",
    enName: "source-overview",
    hash: "#/items/luhmann1984soziale",
    // "Weiterlesen, S. 216" needs a stored reading position
    local: {
      "citegeist.reading.luhmann1984soziale": JSON.stringify({
        page: 215,
        label: "216",
        ratio: 0.32,
        at: "2026-10-23T10:00:00.000Z",
      }),
    },
  },
  {
    name: "bibliothek-leer",
    enName: "library-empty",
    hash: "",
    query: "?mock=empty",
    board: false,
  },
  { name: "bibliothek", enName: "library", hash: "#/" },
  {
    name: "bibliothek-spalte-offen",
    enName: "library-column-open",
    hash: "#/?project=phd-proposal",
    rail: "open",
  },
  {
    name: "inbox",
    enName: "inbox-review",
    hash: "#/inbox",
    async setup(page) {
      const boxes = page.getByRole("checkbox");
      await boxes.nth(1).check();
      await boxes.nth(2).check();
    },
  },
  { name: "projekt", enName: "project", hash: "#/projects/phd-proposal" },

  // Screens without a board of their own, drawn in the same system
  {
    name: "bibliothek-hinzufuegen",
    enName: "library-add",
    hash: "#/",
    board: false,
    async setup(page) {
      const field = page.getByRole("textbox", { name: tx("add") });
      await field.fill("10.1000/xyz123");
      await field.press("Enter");
      await page.getByText(tx("added")).waitFor();
    },
  },
  {
    name: "projekt-karten",
    enName: "project-cards",
    hash: "#/projects/phd-proposal?tab=cards",
    board: false,
  },
  {
    name: "projekt-plan",
    enName: "project-plan",
    hash: "#/projects/phd-proposal?tab=plan&node=k_01JC6A1B2D",
    board: false,
    async setup(page) {
      await page.getByRole("button", { name: "2.2 Autopoiesis" }).waitFor();
      await page.locator(".cm-content").waitFor();
    },
  },
  {
    name: "projekt-plan-einsichten",
    enName: "project-plan-insights",
    hash: "#/projects/phd-proposal?tab=plan&view=insights",
    board: false,
    async setup(page) {
      await page.getByTestId("insight").first().waitFor();
    },
  },
  {
    name: "projekt-plan-luecken",
    enName: "project-plan-gaps",
    hash: "#/projects/phd-proposal?tab=plan&view=gaps",
    board: false,
    async setup(page) {
      await page.getByTestId("gap").first().waitFor();
    },
  },
  {
    name: "projekt-plan-agent",
    enName: "project-plan-agent",
    hash: "#/projects/phd-proposal?tab=plan&view=insights&node=k_01JC6A1B2C",
    board: false,
    async setup(page) {
      await page.getByTestId("insight").first().waitFor();
      await page.getByRole("tab", { name: /^Agent/ }).click();
      const composer = page.getByRole("textbox", { name: tx("composer") });
      await composer.fill(tx("agentMessage"));
      await composer.press("Enter");
      await page.getByText(tx("agentNoted")).waitFor();
    },
  },
  {
    name: "projekt-plan-neu",
    enName: "project-plan-new",
    hash: "#/projects/rag-evaluation?tab=plan",
    board: false,
  },

  // UI-2b: settings sections and the import screen
  { name: "einstellungen", enName: "settings", hash: "#/settings", board: false },
  {
    name: "einstellungen-quellen",
    enName: "settings-sources",
    hash: "#/settings",
    board: false,
    async setup(page) {
      await page.getByRole("heading", { name: tx("sources") }).scrollIntoViewIfNeeded();
      await page.getByRole("heading", { name: tx("chatAgent") }).scrollIntoViewIfNeeded();
      await page.getByRole("heading", { name: tx("sources") }).scrollIntoViewIfNeeded();
    },
  },
  {
    name: "einstellungen-modell",
    enName: "settings-model",
    hash: "#/settings",
    board: false,
    async setup(page) {
      await page.getByRole("heading", { name: tx("semantic") }).scrollIntoViewIfNeeded();
      await page.getByRole("combobox", { name: tx("model") }).waitFor();
    },
  },
  {
    name: "einstellungen-sync",
    enName: "settings-sync",
    hash: "#/settings?section=sync",
    board: false,
    async setup(page) {
      await page.getByTestId("conflict").first().waitFor();
    },
  },
  {
    name: "einstellungen-webhooks",
    enName: "settings-webhooks",
    hash: "#/settings?section=webhooks",
    board: false,
    async setup(page) {
      await page.getByTestId("connector").first().waitFor();
    },
  },
  {
    name: "import",
    enName: "import-preview",
    hash: "#/import",
    board: false,
    async setup(page) {
      await page.getByRole("button", { name: "BibTeX" }).click();
      await page.getByLabel(tx("pathFile")).fill(tx("bibFile"));
      await page.getByRole("button", { name: tx("preview") }).click();
      await page.getByTestId("import-report").waitFor();
    },
  },
  {
    name: "import-ergebnis",
    enName: "import-result",
    hash: "#/import",
    board: false,
    async setup(page) {
      await page.getByLabel(tx("pathZotero")).fill("~/Zotero");
      await page.getByRole("button", { name: tx("projects") }).click();
      await page.getByRole("button", { name: tx("preview") }).click();
      await page.getByTestId("import-report").waitFor();
      await page.getByRole("button", { name: tx("run"), exact: true }).click();
      await page.getByTestId("import-result").waitFor({ timeout: 10000 });
    },
  },

  // UI-2a: literature matrix, related works, retraction warnings
  {
    name: "projekt-matrix-anlegen",
    enName: "project-matrix-create",
    hash: "#/projects/phd-proposal?tab=matrix",
    board: false,
    async setup(page) {
      await newMatrix(page);
      await page.getByRole("button", { name: tx("method"), exact: true }).click();
      await page.getByRole("button", { name: tx("finding"), exact: true }).click();
    },
  },
  {
    name: "projekt-matrix",
    enName: "project-matrix",
    hash: "#/projects/phd-proposal?tab=matrix",
    board: false,
    async setup(page) {
      await newMatrix(page);
      for (const preset of [tx("question"), tx("method"), tx("finding")]) {
        await page.getByRole("button", { name: preset, exact: true }).click();
      }
      await page.getByRole("button", { name: tx("createMatrix") }).click();
      await page.getByRole("table", { name: tx("matrixTable") }).waitFor();
      await page.getByRole("button", { name: tx("fillOpen") }).click();
      const fill = page.getByRole("progressbar", { name: tx("filling") });
      await fill.waitFor();
      await fill.waitFor({ state: "detached", timeout: 20000 });
    },
  },
  {
    name: "quelle-verwandte-werke",
    enName: "source-related-works",
    hash: "#/items/luhmann1984soziale",
    board: false,
    async setup(page) {
      const heading = page.getByRole("heading", { name: tx("related") });
      await heading.scrollIntoViewIfNeeded();
      await page.getByTestId("related-work").first().waitFor();
      await page.getByRole("button", { name: tx("citing"), exact: true }).click();
      await page.getByText("Reassembling the Social").waitFor();
      await heading.evaluate((el) => el.closest("section")?.scrollIntoView({ block: "start" }));
    },
  },
  {
    name: "quelle-rueckzug",
    enName: "source-retraction",
    hash: "#/items/es2023ragas",
    board: false,
    async setup(page) {
      await page.getByTestId("retraction-note").waitFor();
    },
  },
  {
    name: "bibliothek-rueckzug",
    enName: "library-retraction",
    hash: "#/?project=rag-evaluation",
    board: false,
    async setup(page) {
      await page.getByText(tx("retracted")).first().waitFor();
    },
  },
  {
    name: "graph-projekt",
    enName: "graph",
    hash: "#/graph",
    board: false,
    async setup(page) {
      await page.getByTestId("graph-canvas").waitFor();
    },
  },
  {
    name: "graph-karten",
    enName: "graph-cards",
    hash: "#/graph",
    board: false,
    async setup(page) {
      await page.getByTestId("graph-canvas").waitFor();
      await page.getByText(tx("nodes"), { exact: true }).click();
      await page.getByTestId("graph-nodes").getByRole("button", { name: "Luhmann 1984" }).click();
      await page.getByRole("menuitem", { name: tx("showCards") }).click();
    },
  },
  {
    name: "graph-verbindung",
    enName: "graph-edge",
    hash: "#/graph",
    board: false,
    async setup(page) {
      await page.getByTestId("graph-canvas").waitFor();
      await page
        .getByTestId("graph-edges")
        .getByRole("button", { name: tx("edgeOpposes") })
        .click();
    },
  },
  {
    name: "graph-von-hier",
    enName: "graph-from-here",
    hash: "#/graph?project=phd-proposal&node=habermas1981theorie",
    board: false,
    async setup(page) {
      await page.getByTestId("graph-canvas").waitFor();
    },
  },
];

async function newMatrix(page) {
  await page.getByRole("button", { name: tx("newMatrix") }).click();
  await page.getByRole("form", { name: tx("createForm") }).waitFor();
}

async function showText(page) {
  const text = page.getByRole("button", { name: "Text", exact: true });
  await text.waitFor();
  await text.click();
  await page.getByTestId("reflow-scroll").waitFor();
}

async function openFirstCard(page) {
  const first = page.getByTestId("panel-card").first();
  await first.waitFor();
  await first.getByRole("button", { expanded: false }).click();
}

async function reachable() {
  try {
    return (await fetch(url)).ok;
  } catch {
    return false;
  }
}

async function startServer() {
  if (await reachable()) return null;
  const child = spawn("pnpm", ["exec", "vite", "--mode", "mock", "--port", port], {
    cwd: appDir,
    stdio: "ignore",
  });
  for (let i = 0; i < 100; i++) {
    if (await reachable()) return child;
    await new Promise((r) => setTimeout(r, 300));
  }
  child.kill();
  throw new Error(`dev server did not come up at ${url}`);
}

mkdirSync(out, { recursive: true });
const server = await startServer();
const browser = await chromium.launch();
try {
  for (const screen of screens.filter(
    (s) => !only || only.includes(s.name) || only.includes(s.enName),
  )) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 820 } });
    await context.addInitScript(
      ([theme, rail, local, lang]) => {
        localStorage.setItem("citegeist.theme", theme);
        localStorage.setItem("citegeist.lang", lang);
        localStorage.setItem("citegeist.rail", rail);
        for (const [key, value] of Object.entries(local)) localStorage.setItem(key, value);
      },
      [screen.theme ?? "light", screen.rail ?? "closed", screen.local ?? {}, lang],
    );
    const page = await context.newPage();
    await page.goto(`${url}/${screen.query ?? ""}${screen.hash}`);
    await page.waitForSelector("header");
    await page.evaluate(() => document.fonts.ready);
    await screen.setup?.(page);
    await page.waitForTimeout(600);
    const file = join(out, `${lang === "en" ? screen.enName : screen.name}.png`);
    await page.screenshot({ path: file });
    console.log(file);
    await context.close();
  }

  if (withBoards) {
    mkdirSync(join(out, "boards"), { recursive: true });
    for (const screen of screens.filter((s) => s.board !== false)) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 820 } });
      const page = await context.newPage();
      const file = resolve(boardsDir, `${screen.name}.html`);
      await page.goto(pathToFileURL(file).href, { waitUntil: "load" }).catch(() => {});
      await page.waitForTimeout(800);
      await page.screenshot({ path: join(out, "boards", `${screen.name}.png`) });
      await context.close();
    }
  }
} finally {
  await browser.close();
  server?.kill();
}
