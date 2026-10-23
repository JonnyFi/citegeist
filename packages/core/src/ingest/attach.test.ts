import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanTmpDirs, tmpDir } from "../test-helpers.js";
import { createTestEnv, makePdf, type TestEnv } from "./testing.js";

let envs: TestEnv[] = [];
afterEach(async () => {
  for (const e of envs) {
    await e.svc.close();
    await e.lib.close();
  }
  envs = [];
  cleanTmpDirs();
});

async function env(): Promise<TestEnv> {
  const e = await createTestEnv();
  envs.push(e);
  return e;
}

/** An item that exists from BibTeX alone, so it has no source file yet. */
async function bareItem(e: TestEnv): Promise<string> {
  const out = await e.call<{ citekey: string; job: string }>("items.add", {
    identifier:
      "@book{luhmann_gesellschaft, title={Die Gesellschaft der Gesellschaft}, author={Luhmann, Niklas}, year={1997}}",
  });
  await e.svc.queue.waitFor(out.job);
  return out.citekey;
}

function file(name: string, content: string | Buffer): string {
  const path = join(tmpDir("cg-attach-"), name);
  writeFileSync(path, content);
  return path;
}

interface AttachOut {
  citekey: string;
  source: string;
  added: boolean;
  job?: string;
}

describe("items.attach", () => {
  it("copies a PDF into the item, converts it and keeps the item's metadata", async () => {
    const e = await env();
    const citekey = await bareItem(e);
    const before = e.lib.getItem(citekey).frontmatter;
    expect(before.sources).toEqual([]);

    const path = file("paper.pdf", makePdf([["Kapitel 1"], ["Kapitel 2"]]));
    const out = await e.call<AttachOut>("items.attach", {
      citekey,
      path,
      url: "https://example.org/paper.pdf",
    });
    expect(out).toMatchObject({ citekey, added: true });
    expect(out.job).toBeDefined();
    const job = await e.svc.queue.waitFor(out.job as string);
    expect(job.status).toBe("succeeded");

    const after = e.lib.getItem(citekey).frontmatter;
    expect(after.title).toBe(before.title);
    expect(after.sources).toHaveLength(1);
    expect(after.sources[0]).toMatchObject({
      hash: out.source,
      kind: "pdf",
      role: "main",
      filename: "paper.pdf",
      url: "https://example.org/paper.pdf",
      pages: 3,
    });
    expect(existsSync(e.lib.paths.sourceFile(citekey, out.source, "pdf"))).toBe(true);
    expect(existsSync(e.lib.paths.derivedManifest(citekey, out.source))).toBe(true);
    expect(e.lib.status().problems).toEqual([]);
  });

  it("shows the progress messages of the worker as the progress of the job", async () => {
    const e = await env();
    const citekey = await bareItem(e);
    const seen: Array<{ kind: string; message?: string | undefined }> = [];
    e.svc.queue.on("job", (job: { kind: string; message?: string | undefined }) => {
      seen.push({ kind: job.kind, message: job.message });
    });
    const out = await e.call<AttachOut>("items.attach", {
      citekey,
      path: file("p.pdf", makePdf([["Text"]])),
    });
    await e.svc.queue.waitFor(out.job as string);
    const messages = seen.filter((s) => s.kind === "convert").map((s) => s.message);
    expect(messages).toContain("stub converting");
    expect(messages).toContain("stub writing files");
  });

  it("does not add the same file twice, by content or by origin URL", async () => {
    const e = await env();
    const citekey = await bareItem(e);
    const bytes = makePdf([["Seite eins"]]);
    const first = await e.call<AttachOut>("items.attach", {
      citekey,
      path: file("a.pdf", bytes),
      url: "https://example.org/a.pdf",
    });
    await e.svc.queue.waitFor(first.job as string);

    const sameBytes = await e.call<AttachOut>("items.attach", {
      citekey,
      path: file("copy.pdf", bytes),
    });
    expect(sameBytes).toEqual({ citekey, source: first.source, added: false });

    const sameUrl = await e.call<AttachOut>("items.attach", {
      citekey,
      path: file("b.pdf", makePdf([["Eine andere Fassung"]])),
      url: "https://example.org/a.pdf",
    });
    expect(sameUrl).toEqual({ citekey, source: first.source, added: false });
    expect(e.lib.getItem(citekey).frontmatter.sources).toHaveLength(1);
  });

  it("keeps the first PDF as main and stores a second one as supplement", async () => {
    const e = await env();
    const citekey = await bareItem(e);
    const a = await e.call<AttachOut>("items.attach", {
      citekey,
      path: file("a.pdf", makePdf([["Erste Fassung"]])),
    });
    const b = await e.call<AttachOut>("items.attach", {
      citekey,
      path: file("b.pdf", makePdf([["Zweite Fassung"]])),
    });
    await e.svc.queue.waitFor(a.job as string);
    await e.svc.queue.waitFor(b.job as string);
    const roles = e.lib.getItem(citekey).frontmatter.sources.map((s) => [s.hash, s.role]);
    expect(roles).toEqual([
      [a.source, "main"],
      [b.source, "supplement"],
    ]);
  });

  it("attaches an HTML snapshot as a web source", async () => {
    const e = await env();
    const citekey = await bareItem(e);
    const out = await e.call<AttachOut>("items.attach", {
      citekey,
      path: file("page.html", `<html><body>${"<p>Text der Seite.</p>".repeat(20)}</body></html>`),
      filename: "Snapshot",
    });
    await e.svc.queue.waitFor(out.job as string);
    expect(e.lib.getItem(citekey).frontmatter.sources[0]).toMatchObject({
      kind: "web",
      filename: "Snapshot",
    });
  });

  it("stamps the actor and leaves a human-free trail for agents", async () => {
    const e = await env();
    const citekey = await bareItem(e);
    const out = await e.call<AttachOut>(
      "items.attach",
      { citekey, path: file("a.pdf", makePdf([["Text"]])) },
      "agent:zotero-connector",
    );
    await e.svc.queue.waitFor(out.job as string);
    const source = e.lib.getItem(citekey).frontmatter.sources[0];
    expect(source?.added.by).toBe("agent:zotero-connector");
    const job = await e.call<{ by: string }>("jobs.get", { job: out.job });
    expect(job.by).toBe("agent:zotero-connector");
  });

  it("refuses an unknown item, a missing file, a wrong type and a fake PDF", async () => {
    const e = await env();
    const citekey = await bareItem(e);
    const code = async (input: Record<string, unknown>) =>
      (
        (await e.call("items.attach", input).catch((err: unknown) => err)) as {
          detail: { code: string };
        }
      ).detail.code;

    expect(await code({ citekey: "nope1234", path: file("a.pdf", makePdf([["x"]])) })).toBe(
      "ITEM_NOT_FOUND",
    );
    expect(await code({ citekey, path: join(tmpDir("cg-gone-"), "missing.pdf") })).toBe(
      "FILE_NOT_FOUND",
    );
    expect(await code({ citekey, path: file("notes.txt", "plain") })).toBe("FILE_TYPE_UNSUPPORTED");
    expect(await code({ citekey, path: file("fake.pdf", "this is not a pdf") })).toBe(
      "FILE_TYPE_UNSUPPORTED",
    );
    expect(e.lib.getItem(citekey).frontmatter.sources).toEqual([]);
  });
});
