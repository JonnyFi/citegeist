import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ElectronApplication, _electron as electron, expect, test } from "@playwright/test";
import { SEED, seedLibrary } from "../src/testing/seed.js";

let tmp: string;
let library: string;
let localBase: string;
const apps: ElectronApplication[] = [];

test.beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "citegeist-e2e-"));
  library = join(tmp, "library");
  localBase = join(tmp, "local");
  seedLibrary(library);
});

test.afterEach(async () => {
  for (const app of apps.splice(0).reverse()) await app.close().catch(() => {});
  rmSync(tmp, { recursive: true, force: true });
});

async function launch(name: string, withLibrary = true): Promise<ElectronApplication> {
  const userData = join(tmp, `user-data-${name}`);
  mkdirSync(userData, { recursive: true });
  const app = await electron.launch({
    args: ["."],
    cwd: join(import.meta.dirname, ".."),
    env: {
      ...process.env,
      ...(withLibrary ? { CITEGEIST_LIBRARY: library } : {}),
      CITEGEIST_LOCAL_BASE: localBase,
      CITEGEIST_USER_DATA: userData,
    },
  });
  apps.push(app);
  return app;
}

test("starts the core, shows the library table and opens an item", async () => {
  const app = await launch("a");
  const page = await app.firstWindow();

  // Library table with the seeded library items; the agent's inbox item stays out of it.
  await expect(page.getByRole("heading", { level: 1, name: "Library" })).toBeVisible();
  const rows = page.getByTestId("item-row");
  await expect(rows).toHaveCount(3);
  await expect(page.getByText("Theorie des kommunikativen Handelns")).toBeVisible();
  await expect(page.getByText("The Age of Surveillance Capitalism")).toHaveCount(0);

  // Open an item: metadata, literature note, card.
  await rows.filter({ hasText: SEED.items.luhmann }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Soziale Systeme" })).toBeVisible();
  await expect(page.getByText("Niklas", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("Kommunikation ist das Element sozialer Systeme.")).toBeVisible();
  await expect(page.getByTestId("card")).toHaveCount(1);
  await expect(page.getByText(SEED.quote)).toBeVisible();

  // Inbox and projects come from the same core.
  await page.getByRole("link", { name: /Inbox/ }).click();
  await expect(page.getByTestId("item-row")).toHaveCount(1);
  await page.getByRole("link", { name: "Projects", exact: true }).click();
  await expect(page.getByRole("heading", { level: 2, name: "PhD proposal" })).toBeVisible();
});

test("a second app attaches to the running core instead of starting another", async () => {
  const first = await launch("a");
  const firstPage = await first.firstWindow();
  await expect(firstPage.getByTestId("item-row")).toHaveCount(3);

  const lockPath = join(localBase, SEED.libraryId, "core.lock");
  const before = JSON.parse(readFileSync(lockPath, "utf8")) as { pid: number; port: number };

  const second = await launch("b");
  const secondPage = await second.firstWindow();
  await expect(secondPage.getByTestId("item-row")).toHaveCount(3);

  const after = JSON.parse(readFileSync(lockPath, "utf8")) as { pid: number; port: number };
  expect(after).toMatchObject({ pid: before.pid, port: before.port });
});

test("shows the welcome screen when no library is open", async () => {
  const app = await launch("a", false);
  const page = await app.firstWindow();
  await expect(page.getByRole("heading", { name: "Open a library" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open library" })).toBeVisible();
});

test("routes citegeist:// links through the single instance", async () => {
  const app = await launch("a");
  const page = await app.firstWindow();
  await expect(page.getByTestId("item-row")).toHaveCount(3);
  await app.evaluate(({ BrowserWindow }, path) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send("citegeist:navigate", path);
  }, `/items/${SEED.items.habermas}`);
  await expect(
    page.getByRole("heading", { level: 1, name: "Theorie des kommunikativen Handelns" }),
  ).toBeVisible();
});
