// Takes 1280x820 screenshots of the app against the mock core, one per board of
// docs/design/boards, so the result can be compared with the mockups side by side, plus the
// screens that have no board (planning, project cards, add field).
//
//   pnpm --filter @citegeist/ui design-check            screenshots of the app
//   pnpm --filter @citegeist/ui design-check --boards   also screenshots of the board files
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
const withBoards = process.argv.includes("--boards");

const READ = "#/items/luhmann1984soziale?tab=read";

/** Each entry mirrors one board: where to go and what to click before the shot. */
const screens = [
  {
    name: "lesen-hell",
    hash: READ,
    async setup(page) {
      await showText(page);
      await openFirstCard(page);
    },
  },
  {
    name: "lesen-dunkel",
    hash: READ,
    theme: "dark",
    async setup(page) {
      await showText(page);
      await openFirstCard(page);
    },
  },
  {
    name: "lesen-agent-chat",
    hash: READ,
    async setup(page) {
      await showText(page);
      await page.getByRole("tab", { name: /^Agent/ }).click();
    },
  },
  {
    name: "quelle-uebersicht",
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
  { name: "bibliothek", hash: "#/" },
  {
    name: "bibliothek-spalte-offen",
    hash: "#/?project=phd-proposal",
    rail: "open",
  },
  {
    name: "inbox",
    hash: "#/inbox",
    async setup(page) {
      const boxes = page.getByRole("checkbox");
      await boxes.nth(1).check();
      await boxes.nth(2).check();
    },
  },
  { name: "projekt", hash: "#/projects/phd-proposal" },

  // W3.8: screens without a board of their own, drawn in the same system
  {
    name: "bibliothek-hinzufuegen",
    hash: "#/",
    board: false,
    async setup(page) {
      const field = page.getByRole("textbox", { name: "Hinzufügen" });
      await field.fill("10.1000/xyz123");
      await field.press("Enter");
      await page.getByText("Hinzugefügt:").waitFor();
    },
  },
  { name: "projekt-karten", hash: "#/projects/phd-proposal?tab=cards", board: false },
  {
    name: "projekt-plan",
    hash: "#/projects/phd-proposal?tab=plan&node=k_01JC6A1B2D",
    board: false,
    async setup(page) {
      await page.getByRole("button", { name: "2.2 Autopoiesis" }).waitFor();
      await page.locator(".cm-content").waitFor();
    },
  },
  {
    name: "projekt-plan-einsichten",
    hash: "#/projects/phd-proposal?tab=plan&view=insights",
    board: false,
    async setup(page) {
      await page.getByTestId("insight").first().waitFor();
    },
  },
  {
    name: "projekt-plan-luecken",
    hash: "#/projects/phd-proposal?tab=plan&view=gaps",
    board: false,
    async setup(page) {
      await page.getByTestId("gap").first().waitFor();
    },
  },
  {
    name: "projekt-plan-agent",
    hash: "#/projects/phd-proposal?tab=plan&view=insights&node=k_01JC6A1B2C",
    board: false,
    async setup(page) {
      await page.getByTestId("insight").first().waitFor();
      await page.getByRole("tab", { name: /^Agent/ }).click();
      const composer = page.getByRole("textbox", { name: "Nachricht an den Agent" });
      await composer.fill(
        "Ich sehe eine Verbindung zwischen Luhmann und Gillespie, bitte notieren",
      );
      await composer.press("Enter");
      await page.getByText("Notiert in 2, Luhmanns Kommunikationsbegriff.").waitFor();
    },
  },
  {
    name: "projekt-plan-neu",
    hash: "#/projects/rag-evaluation?tab=plan",
    board: false,
  },

  // UI-2b: settings sections and the import screen
  { name: "einstellungen", hash: "#/settings", board: false },
  {
    name: "einstellungen-quellen",
    hash: "#/settings",
    board: false,
    async setup(page) {
      await page.getByRole("heading", { name: "Metadatenquellen" }).scrollIntoViewIfNeeded();
      await page.getByRole("heading", { name: "Chat-Agent" }).scrollIntoViewIfNeeded();
      await page.getByRole("heading", { name: "Metadatenquellen" }).scrollIntoViewIfNeeded();
    },
  },
  {
    name: "einstellungen-modell",
    hash: "#/settings",
    board: false,
    async setup(page) {
      await page.getByRole("heading", { name: "Suche nach Bedeutung" }).scrollIntoViewIfNeeded();
      await page.getByRole("combobox", { name: "Embedding-Modell" }).waitFor();
    },
  },
  {
    name: "einstellungen-sync",
    hash: "#/settings?section=sync",
    board: false,
    async setup(page) {
      await page.getByTestId("conflict").first().waitFor();
    },
  },
  {
    name: "einstellungen-webhooks",
    hash: "#/settings?section=webhooks",
    board: false,
    async setup(page) {
      await page.getByTestId("connector").first().waitFor();
    },
  },
  {
    name: "import",
    hash: "#/import",
    board: false,
    async setup(page) {
      await page.getByRole("button", { name: "BibTeX" }).click();
      await page.getByLabel("Pfad zur Datei").fill("/Users/jonny/Zotero/export/bibliothek.bib");
      await page.getByRole("button", { name: "Vorschau" }).click();
      await page.getByTestId("import-report").waitFor();
    },
  },
  {
    name: "import-ergebnis",
    hash: "#/import",
    board: false,
    async setup(page) {
      await page.getByLabel("Pfad zu zotero.sqlite oder zum Zotero-Ordner").fill("~/Zotero");
      await page.getByRole("button", { name: "Projekten" }).click();
      await page.getByRole("button", { name: "Vorschau" }).click();
      await page.getByTestId("import-report").waitFor();
      await page.getByRole("button", { name: "Importieren" }).click();
      await page.getByTestId("import-result").waitFor({ timeout: 10000 });
    },
  },

  // UI-2a: literature matrix, related works, retraction warnings
  {
    name: "projekt-matrix-anlegen",
    hash: "#/projects/phd-proposal?tab=matrix",
    board: false,
    async setup(page) {
      await newMatrix(page);
      await page.getByRole("button", { name: "Methode", exact: true }).click();
      await page.getByRole("button", { name: "Ergebnis", exact: true }).click();
    },
  },
  {
    name: "projekt-matrix",
    hash: "#/projects/phd-proposal?tab=matrix",
    board: false,
    async setup(page) {
      await newMatrix(page);
      for (const preset of ["Fragestellung", "Methode", "Ergebnis"]) {
        await page.getByRole("button", { name: preset, exact: true }).click();
      }
      await page.getByRole("button", { name: "Matrix anlegen" }).click();
      await page.getByRole("table", { name: "Literaturmatrix" }).waitFor();
      await page.getByRole("button", { name: "Offene Zellen füllen" }).click();
      const fill = page.getByRole("progressbar", { name: "Zellen werden gefüllt" });
      await fill.waitFor();
      await fill.waitFor({ state: "detached", timeout: 20000 });
    },
  },
  {
    name: "quelle-verwandte-werke",
    hash: "#/items/luhmann1984soziale",
    board: false,
    async setup(page) {
      const heading = page.getByRole("heading", { name: "Verwandte Werke" });
      await heading.scrollIntoViewIfNeeded();
      await page.getByTestId("related-work").first().waitFor();
      await page.getByRole("button", { name: "Zitiert von", exact: true }).click();
      await page.getByText("Reassembling the Social").waitFor();
      await heading.evaluate((el) => el.closest("section")?.scrollIntoView({ block: "start" }));
    },
  },
  {
    name: "quelle-rueckzug",
    hash: "#/items/es2023ragas",
    board: false,
    async setup(page) {
      await page.getByTestId("retraction-note").waitFor();
    },
  },
  {
    name: "bibliothek-rueckzug",
    hash: "#/?project=rag-evaluation",
    board: false,
    async setup(page) {
      await page.getByText("Zurückgezogen").first().waitFor();
    },
  },
];

async function newMatrix(page) {
  await page.getByRole("button", { name: "Neue Matrix" }).click();
  await page.getByRole("form", { name: "Matrix anlegen" }).waitFor();
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
  for (const screen of screens) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 820 } });
    await context.addInitScript(
      ([theme, rail, local]) => {
        localStorage.setItem("citegeist.theme", theme);
        localStorage.setItem("citegeist.lang", "de");
        localStorage.setItem("citegeist.rail", rail);
        for (const [key, value] of Object.entries(local)) localStorage.setItem(key, value);
      },
      [screen.theme ?? "light", screen.rail ?? "closed", screen.local ?? {}],
    );
    const page = await context.newPage();
    await page.goto(`${url}/${screen.hash}`);
    await page.waitForSelector("header");
    await page.evaluate(() => document.fonts.ready);
    await screen.setup?.(page);
    await page.waitForTimeout(600);
    const file = join(out, `${screen.name}.png`);
    await page.screenshot({ path: file });
    console.log(file);
    await context.close();
  }

  if (withBoards) {
    mkdirSync(join(out, "boards"), { recursive: true });
    for (const screen of screens.filter((s) => s.board !== false)) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 820 } });
      const page = await context.newPage();
      const file = resolve(repo, "docs/design/boards", `${screen.name}.html`);
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
