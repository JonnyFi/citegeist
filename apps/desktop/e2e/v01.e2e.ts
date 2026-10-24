/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { type ElectronApplication, _electron as electron, expect, test } from "@playwright/test";
import { fixturePdf, paragraph } from "./fixture-pdf.js";

/**
 * v0.1 end to end in the real app: a temp library, a local PDF added through items.add and
 * converted by the stub worker, read in the PDF view, a card made from a selection with the
 * canned AI backend, and the citation on the clipboard.
 */

const STUB_WORKER = join(import.meta.dirname, "../../../packages/core/src/ingest/stub-worker.mjs");
const PASSAGE = paragraph(0, 1);

let tmp: string;
let app: ElectronApplication | undefined;

test.beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "citegeist-v01-"));
});

test.afterEach(async () => {
  await app?.close().catch(() => {});
  app = undefined;
  rmSync(tmp, { recursive: true, force: true });
});

type Rpc = (input: unknown) => Promise<unknown>;

/** The browser side of the preload bridge, as far as this test reads it. */
interface BridgeWindow {
  citegeist?: { connection: { url: string; wsUrl: string; token: string } | null };
}

test("adds a PDF, reads it, makes a card with AI and copies the citation", async () => {
  const library = join(tmp, "library");
  const localBase = join(tmp, "local");
  const userData = join(tmp, "user-data");
  mkdirSync(library, { recursive: true });
  mkdirSync(localBase, { recursive: true });
  mkdirSync(userData, { recursive: true });
  writeFileSync(
    join(library, "citegeist.json"),
    JSON.stringify({ format: 1, id: "01J0E2E000000000000000LIB1", name: "E2E library" }),
  );
  writeFileSync(join(localBase, "settings.json"), JSON.stringify({ uiLanguage: "en" }));
  const pdfPath = join(tmp, "paper.pdf");
  writeFileSync(pdfPath, fixturePdf());

  app = await electron.launch({
    args: ["."],
    cwd: join(import.meta.dirname, ".."),
    env: {
      ...process.env,
      CITEGEIST_LIBRARY: library,
      CITEGEIST_LOCAL_BASE: localBase,
      CITEGEIST_USER_DATA: userData,
      CITEGEIST_WORKER_CMD: `node ${STUB_WORKER}`,
      CITEGEIST_AI_MOCK: "1",
    },
  });
  const page = await app.firstWindow();
  await expect(page.getByRole("heading", { level: 1, name: "Library" })).toBeVisible();

  // Add the local PDF through the same operation the CLI and agents use.
  const connection = await page.evaluate(() => (window as BridgeWindow).citegeist?.connection);
  if (!connection) throw new Error("the window has no core connection");
  const client = createORPCClient<Record<string, Record<string, Rpc>>>(
    new RPCLink({
      url: `${connection.url}/rpc`,
      headers: { authorization: `Bearer ${connection.token}` },
    }),
  );
  // Playwright's transpiler turns `a?.b?.()` into `.call()`, which oRPC reads as a path segment,
  // so the procedure is looked up first and called as a plain function.
  const rpc = async (name: string, input: unknown): Promise<unknown> => {
    const [namespace = "", operation = ""] = name.split(".");
    const procedure = client[namespace]?.[operation];
    if (!procedure) throw new Error(`no operation ${name}`);
    return procedure(input);
  };
  const added = (await rpc("items.add", { identifier: pdfPath, target: "library" })) as {
    citekey: string;
    job: string;
  };
  await expect
    .poll(async () => ((await rpc("jobs.get", { job: added.job })) as { status: string }).status)
    .toBe("succeeded");

  // The new item shows up in the library without a reload.
  const row = page.getByTestId("item-row").filter({ hasText: added.citekey });
  await expect(row).toBeVisible();

  // Open it in the reader: the PDF comes from the core's /files route with the session token.
  await app.evaluate(({ BrowserWindow }, path) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send("citegeist:navigate", path);
  }, `/items/${added.citekey}?tab=read`);
  const line = page
    .locator('.cg-page[data-page="0"] .textLayer span[data-item]')
    .filter({ hasText: PASSAGE });
  await expect(line).toBeVisible({ timeout: 30_000 });

  // Select the passage like a reader would and make a card from it.
  await page.evaluate((text) => {
    const spans = [
      ...document.querySelectorAll<HTMLElement>(
        '.cg-page[data-page="0"] .textLayer span[data-item]',
      ),
    ];
    const span = spans.find((s) => s.textContent?.includes(text));
    const node = span?.firstChild;
    if (!span || !node) throw new Error(`text not found: ${text}`);
    const start = (span.textContent ?? "").indexOf(text);
    window.getSelection()?.setBaseAndExtent(node, start, node, start + text.length);
  }, PASSAGE);
  await page.getByTestId("selection-quote").click();

  // The card appears at once; the paraphrase of the canned backend arrives from the job.
  await expect(page.getByTestId("card-editor")).toBeVisible();
  await expect(page.getByText("Canned paraphrase of the selected passage.")).toBeVisible({
    timeout: 20_000,
  });

  // Copy the citation and read it back from the system clipboard.
  await page.getByRole("button", { name: "Quote verbatim" }).click();
  await expect(page.getByRole("status").filter({ hasText: /copied/i })).toBeVisible();
  const clipboard = await app.evaluate(({ clipboard: c }) => c.readText());
  expect(clipboard).toContain(PASSAGE);
});
