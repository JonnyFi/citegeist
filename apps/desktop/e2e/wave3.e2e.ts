/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import {
  type ElectronApplication,
  _electron as electron,
  expect,
  type Page,
  test,
} from "@playwright/test";
import { fixturePdf } from "./fixture-pdf.js";

/**
 * Wave 3 in the real app: the core takes the caller from x-citegeist-actor (also for `cg`),
 * items.attach puts a file into an existing item, and the settings screen runs the connector
 * listener and offers the quick-insert hotkey. The palette window loads from the built UI.
 */

const STUB_WORKER = join(import.meta.dirname, "../../../packages/core/src/ingest/stub-worker.mjs");
const CLI_DIR = join(import.meta.dirname, "../../cli");

let tmp: string;
let library: string;
let localBase: string;
let userData: string;
let app: ElectronApplication | undefined;

test.beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "citegeist-wave3-"));
  library = join(tmp, "library");
  localBase = join(tmp, "local");
  userData = join(tmp, "user-data");
  for (const dir of [library, localBase, userData]) mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(library, "citegeist.json"),
    JSON.stringify({ format: 1, id: "01J0E2E000000000000000LIB3", name: "Wave 3 library" }),
  );
  writeFileSync(join(localBase, "settings.json"), JSON.stringify({ uiLanguage: "en" }));
  // The test must not take the real global hotkey of whoever runs it.
  writeFileSync(
    join(userData, "quick-insert.json"),
    JSON.stringify({ enabled: false, accelerator: "CommandOrControl+Shift+K" }),
  );
});

test.afterEach(async () => {
  await app?.close().catch(() => {});
  app = undefined;
  rmSync(tmp, { recursive: true, force: true });
});

interface BridgeWindow {
  citegeist?: { connection: { url: string; wsUrl: string; token: string } | null };
}
type Rpc = (input: unknown) => Promise<unknown>;

async function launch(): Promise<{ page: Page; url: string; token: string }> {
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
  const connection = await page.evaluate(() => (window as BridgeWindow).citegeist?.connection);
  if (!connection) throw new Error("the window has no core connection");
  return { page, url: connection.url, token: connection.token };
}

/** An oRPC client for the running core. `actor` goes out as x-citegeist-actor when given. */
function rpcClient(core: { url: string; token: string }, actor?: string) {
  const client = createORPCClient<Record<string, Record<string, Rpc>>>(
    new RPCLink({
      url: `${core.url}/rpc`,
      headers: {
        authorization: `Bearer ${core.token}`,
        ...(actor ? { "x-citegeist-actor": actor } : {}),
      },
    }),
  );
  // Playwright's transpiler turns `a?.b?.()` into `.call()`, which oRPC reads as a path segment,
  // so the procedure is looked up first and called as a plain function.
  return async (name: string, input: unknown): Promise<unknown> => {
    const [namespace = "", operation = ""] = name.split(".");
    const procedure = client[namespace]?.[operation];
    if (!procedure) throw new Error(`no operation ${name}`);
    return procedure(input);
  };
}

async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = (probe.address() as { port: number }).port;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

function noteFiles(): string[] {
  const dir = join(library, "notes");
  try {
    return readdirSync(dir).map((f) => readFileSync(join(dir, f), "utf8"));
  } catch {
    return [];
  }
}

function runCg(args: string[]): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", "src/bin.ts", ...args], {
      cwd: CLI_DIR,
      env: { ...process.env, CITEGEIST_LIBRARY: library, CITEGEIST_LOCAL_BASE: localBase },
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (c: Buffer) => {
      out += c;
    });
    child.stderr.on("data", (c: Buffer) => {
      err += c;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, out, err }));
  });
}

test("the running app takes the caller from x-citegeist-actor, also for cg", async () => {
  const core = await launch();
  const health = await fetch(`${core.url}/health`, {
    headers: { authorization: `Bearer ${core.token}` },
  });
  expect(await health.json()).toMatchObject({ ok: true, actors: true });

  const input = { title: "Written by an agent", type: "permanent" };
  await rpcClient(core, "agent:e2e-bot")("notes.create", input);
  await rpcClient(core)("notes.create", { ...input, title: "Written by the UI" });
  const files = noteFiles();
  expect(files.find((f) => f.includes("Written by an agent"))).toContain("agent:e2e-bot");
  expect(files.find((f) => f.includes("Written by the UI"))).not.toContain("agent:");

  // A header that is no actor is refused; nothing is written as the human.
  await expect(
    rpcClient(core, "root")("notes.create", { ...input, title: "Refused" }),
  ).rejects.toThrow();
  expect(noteFiles().some((f) => f.includes("Refused"))).toBe(false);

  // cg finds the app through core.lock and forwards, so the app stays the only writer.
  const cg = await runCg([
    "--actor",
    "agent:cg-e2e",
    "notes",
    "create",
    "--title",
    "Written through cg",
    "--type",
    "permanent",
    "--json",
  ]);
  expect(cg.err).toBe("");
  expect(cg.code).toBe(0);
  expect(noteFiles().find((f) => f.includes("Written through cg"))).toContain("agent:cg-e2e");
  // The app shows the note without a reload.
  await app?.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send("citegeist:navigate", "/notes");
  });
  await expect(core.page.getByText("Written through cg").first()).toBeVisible();
});

test("items.attach adds a file to an item that exists and converts it", async () => {
  const core = await launch();
  const rpc = rpcClient(core, "agent:zotero-connector");
  const added = (await rpc("items.add", {
    identifier:
      "@book{luhmann_gesellschaft, title={Die Gesellschaft der Gesellschaft}, author={Luhmann, Niklas}, year={1997}}",
    target: "library",
  })) as { citekey: string; job: string };
  await expect
    .poll(async () => ((await rpc("jobs.get", { job: added.job })) as { status: string }).status)
    .toBe("succeeded");
  const before = (await rpc("items.get", { citekey: added.citekey })) as {
    frontmatter: { sources: unknown[] };
  };
  expect(before.frontmatter.sources).toEqual([]);

  const pdfPath = join(tmp, "gesellschaft.pdf");
  writeFileSync(pdfPath, fixturePdf());
  const attached = (await rpc("items.attach", {
    citekey: added.citekey,
    path: pdfPath,
    url: "https://example.org/gesellschaft.pdf",
  })) as { source: string; added: boolean; job: string };
  expect(attached.added).toBe(true);
  await expect
    .poll(async () => ((await rpc("jobs.get", { job: attached.job })) as { status: string }).status)
    .toBe("succeeded");

  const after = (await rpc("items.get", { citekey: added.citekey })) as {
    frontmatter: { sources: Array<Record<string, unknown>> };
  };
  expect(after.frontmatter.sources).toHaveLength(1);
  expect(after.frontmatter.sources[0]).toMatchObject({
    hash: attached.source,
    kind: "pdf",
    role: "main",
    url: "https://example.org/gesellschaft.pdf",
    added: { by: "agent:zotero-connector" },
  });

  // Attaching the same file again changes nothing.
  const again = (await rpc("items.attach", { citekey: added.citekey, path: pdfPath })) as {
    added: boolean;
    source: string;
  };
  expect(again).toEqual({ citekey: added.citekey, source: attached.source, added: false });

  // The item opens in the reader with the attached PDF.
  await app?.evaluate(({ BrowserWindow }, path) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send("citegeist:navigate", path);
  }, `/items/${added.citekey}?tab=read`);
  await expect(core.page.locator(".cg-page").first()).toBeVisible({ timeout: 30_000 });
});

test("settings: connector switch and port, hotkey field, semantic search stays off", async () => {
  const { page, ...core } = await launch();
  await app?.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send("citegeist:navigate", "/settings");
  });
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();

  // Semantic search is off and nothing is downloaded until the user turns it on.
  await expect(page.getByRole("checkbox", { name: "Turn on semantic search" })).not.toBeChecked();

  // The connector listens on the chosen port once switched on, and stops when switched off.
  const port = await freePort();
  const toggle = page.getByRole("checkbox", { name: "Turn on the listener" });
  await expect(toggle).not.toBeChecked();
  await page.getByRole("textbox", { name: "Port" }).fill(String(port));
  await page.getByRole("button", { name: "Save port" }).click();
  await expect(toggle).toBeEnabled();
  await toggle.click();
  await expect(
    page.getByText(`The listener is accepting connections on 127.0.0.1:${port}.`),
  ).toBeVisible();
  const ping = await fetch(`http://127.0.0.1:${port}/connector/ping`);
  expect(ping.status).toBe(200);
  expect(ping.headers.get("x-zotero-version")).toBeTruthy();
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect
    .poll(() =>
      fetch(`http://127.0.0.1:${port}/connector/ping`).then(
        () => "up",
        () => "down",
      ),
    )
    .toBe("down");

  // The hotkey of the quick-insert palette: shown, and a hotkey without modifier is refused.
  const hotkey = page.getByRole("textbox", { name: "Hotkey" });
  await expect(hotkey).toHaveValue("CommandOrControl+Shift+K");
  await hotkey.fill("K");
  await page.getByRole("button", { name: "Save hotkey" }).click();
  await expect(page.getByRole("alert")).toContainText("at least one modifier");

  // The setting is stored on this machine, next to settings.json of the core.
  const stored = JSON.parse(readFileSync(join(localBase, "settings.json"), "utf8")) as {
    connector: { enabled: boolean; port: number };
  };
  expect(stored.connector).toEqual({ enabled: false, port });
  expect(core.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
});

test("the quick-insert palette window loads the built UI", async () => {
  await launch();
  const isPalette = (w: Page) => w.url().endsWith("#/quick-insert");
  await expect.poll(() => app?.windows().some(isPalette), { timeout: 15_000 }).toBe(true);
  const palette = app?.windows().find(isPalette);
  if (!palette) throw new Error("no palette window");
  await expect(palette.getByRole("combobox")).toBeAttached({ timeout: 15_000 });
});
