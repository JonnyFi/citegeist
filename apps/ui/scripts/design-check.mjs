// Takes 1280x820 screenshots of the app against the mock core, one per board of
// docs/design/boards, so the result can be compared with the mockups side by side.
//
//   pnpm --filter @citegeist/ui design-check            screenshots of the app
//   pnpm --filter @citegeist/ui design-check --boards   also screenshots of the board files
//
// Output goes to .context/design-check/ at the repository root. The script starts
// `vite --mode mock` itself on port 5188 (DESIGN_CHECK_PORT) when nothing listens there.
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(here, "..");
const repo = resolve(appDir, "../..");
const out = join(repo, ".context", "design-check");
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
  { name: "quelle-uebersicht", hash: "#/items/luhmann1984soziale" },
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
];

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
      ([theme, rail]) => {
        localStorage.setItem("citegeist.theme", theme);
        localStorage.setItem("citegeist.lang", "de");
        localStorage.setItem("citegeist.rail", rail);
      },
      [screen.theme ?? "light", screen.rail ?? "closed"],
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
    for (const screen of screens) {
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
