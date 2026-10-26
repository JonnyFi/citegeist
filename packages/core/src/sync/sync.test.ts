import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  defineContract,
  Registry,
  type SyncConflict,
  type SyncStatusResult,
  syncConfigure,
  syncNow,
  syncResolveConflict,
  syncStatus,
} from "@citegeist/ops";
import { CitegeistError } from "@citegeist/schema";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { Library } from "../library.js";
import { cleanTmpDirs, noteData, noteFile, tmpDir } from "../test-helpers.js";
import { Git } from "./git.js";
import { detectGitDir, detectLocation } from "./location.js";
import { bindSyncOperations } from "./ops.js";
import type { SyncService } from "./service.js";
import { Versioner } from "./versioning.js";

const human = { actor: "human" as const };
const agent = { actor: "agent:claude-code" as const };

const open: { lib: Library; service?: SyncService }[] = [];

afterEach(async () => {
  for (const o of open.splice(0)) {
    o.service?.close();
    await o.lib.close();
  }
  cleanTmpDirs();
});

interface Mac {
  lib: Library;
  root: string;
  registry: Registry;
  service: SyncService;
  localBase: string;
}

/** Binds the sync operations to a fresh registry, with a writer operation for tests. */
function wire(lib: Library, opts: Parameters<typeof bindSyncOperations>[2] = {}): Mac {
  const registry = new Registry();
  const service = bindSyncOperations(registry, lib, { autoStart: false, ...opts });
  const write = defineContract({
    name: "test.write",
    summary: "Writes a file (test only)",
    access: "write",
    input: z.object({ rel: z.string(), content: z.string() }),
    output: z.object({ ok: z.literal(true) }),
  });
  registry.bind(write, async (_ctx, input) => {
    lib.writeFile(input.rel, input.content);
    return { ok: true as const };
  });
  open.push({ lib, service });
  return { lib, root: lib.root, registry, service, localBase: dirname(lib.local.dir) };
}

async function newMac(opts: Parameters<typeof bindSyncOperations>[2] = {}): Promise<Mac> {
  const root = tmpDir("cg-sync-");
  const localBase = tmpDir("cg-local-");
  const lib = await Library.init(root, { name: "Sync", localBase, watch: false });
  const mac = wire(lib, opts);
  await mac.service.start();
  return mac;
}

/** Opens a clone of a git remote as a second Mac. */
async function cloneMac(remote: string, opts: Parameters<typeof bindSyncOperations>[2] = {}) {
  const root = tmpDir("cg-clone-");
  const localBase = tmpDir("cg-local-");
  await new Git({ cwd: root }).exec(["clone", "--quiet", remote, root]);
  const lib = await Library.open(root, { localBase, watch: false });
  const mac = wire(lib, opts);
  await mac.service.start();
  return mac;
}

async function bareRemote(): Promise<string> {
  const dir = tmpDir("cg-remote-");
  await new Git({ cwd: dir }).exec(["init", "--quiet", "--bare", "--initial-branch=main", dir]);
  return dir;
}

const status = (m: Mac): Promise<SyncStatusResult> =>
  m.registry.call(syncStatus.name, human, {}) as Promise<SyncStatusResult>;
const configure = (m: Mac, input: Record<string, unknown>) =>
  m.registry.call(syncConfigure.name, human, input) as Promise<SyncStatusResult>;
const syncNowOp = (m: Mac, input: Record<string, unknown> = {}) =>
  m.registry.call(syncNow.name, human, input) as Promise<{
    commits: { message: string; actor: string; files: number }[];
    pulled: boolean;
    pushed: boolean;
    downloaded: string[];
    evicted: string[];
    conflicts: SyncConflict[];
  }>;
const resolve = (m: Mac, input: Record<string, unknown>) =>
  m.registry.call(syncResolveConflict.name, human, input);

const git = (m: Mac) => m.service.versioner.git() as Git;
const log = async (m: Mac): Promise<string[]> =>
  (await git(m).out(["log", "--format=%an|%s"])).split("\n").filter(Boolean);

function writeNote(m: Mac, slug: string, body: string, id?: string): string {
  const fm = noteData(slug, id ? { id } : {});
  m.lib.writeFile(`notes/${slug}.md`, noteFile(fm, body));
  return fm.id;
}

function raw(root: string, rel: string, content: string | Buffer): void {
  const abs = join(root, ...rel.split("/"));
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

describe("locations", () => {
  it("recognizes iCloud Drive and Dropbox folders", () => {
    expect(
      detectLocation("/Users/alex/Library/Mobile Documents/com~apple~CloudDocs/Papers/Library"),
    ).toBe("icloud");
    expect(detectLocation("/Users/alex/Dropbox/Library")).toBe("dropbox");
    expect(detectLocation("/Users/alex/Dropbox (Personal)/Library")).toBe("dropbox");
    expect(detectLocation("/Users/alex/Library/CloudStorage/Dropbox/Library")).toBe("dropbox");
    expect(detectLocation("/Users/alex/Citegeist")).toBe("local");
  });

  it("tells embedded, separate, broken and missing git directories apart", async () => {
    const root = tmpDir("cg-gd-");
    const sep = join(tmpDir("cg-gd-sep-"), "git");
    expect(detectGitDir(root, sep).kind).toBe("none");
    await new Git({ cwd: root }).exec(["init", "--quiet", root]);
    expect(detectGitDir(root, sep).kind).toBe("embedded");

    const root2 = tmpDir("cg-gd-");
    await new Git({ cwd: root2 }).exec(["init", "--quiet", "--separate-git-dir", sep, root2]);
    expect(detectGitDir(root2, sep)).toEqual({ kind: "separate", gitDir: sep });
    expect(lstatSync(join(root2, ".git")).isFile()).toBe(true);
    // the pointer file came along without the git directory
    expect(detectGitDir(root2, join(sep, "nope")).kind).toBe("separate");
    writeFileSync(join(root2, ".git"), "gitdir: /does/not/exist\n");
    expect(detectGitDir(root2, join(sep, "nope")).kind).toBe("broken");
  });
});

describe("versioning", () => {
  it("creates the repository with a .gitignore that keeps idmap.json and blocks.jsonl", async () => {
    const m = await newMac();
    await configure(m, { versioning: true });
    expect(lstatSync(join(m.root, ".git")).isDirectory()).toBe(true);
    const ignored = async (rel: string) => git(m).ok(["check-ignore", "--quiet", rel]);
    const d = "items/luhmann1984/derived/3f9a1c2e7b4d";
    expect(await ignored(`${d}/doc.md`)).toBe(true);
    expect(await ignored(`${d}/doc.html`)).toBe(true);
    expect(await ignored(`${d}/refs.jsonl`)).toBe(true);
    expect(await ignored(`${d}/assets/fig1.png`)).toBe(true);
    expect(await ignored(`${d}/idmap.json`)).toBe(false);
    expect(await ignored(`${d}/blocks.jsonl`)).toBe(false);
    expect(await ignored(`${d}/pages.json`)).toBe(false);
    expect(await ignored("items/luhmann1984/sources/3f9a1c2e7b4d.pdf")).toBe(false);
    expect(await log(m)).toEqual(["system|system: initial snapshot of the library"]);
    expect((await status(m)).git).toMatchObject({ initialised: true, gitDir: "embedded" });
  });

  it("commits once per actor, and agent writes carry the agent name", async () => {
    const m = await newMac();
    await configure(m, { versioning: true });
    await m.registry.call("test.write", agent, {
      rel: "notes/agent-note.md",
      content: noteFile(noteData("Agent note"), "from the agent"),
    });
    await m.registry.call("test.write", human, {
      rel: "notes/my-note.md",
      content: noteFile(noteData("My note"), "from me"),
    });
    await m.registry.call("test.write", agent, {
      rel: "notes/agent-note-2.md",
      content: noteFile(noteData("Agent note 2"), "again"),
    });
    const res = await syncNowOp(m);
    expect(res.commits.map((c) => c.actor).sort()).toEqual(["agent:claude-code", "human"]);
    const agentCommit = res.commits.find((c) => c.actor === "agent:claude-code");
    expect(agentCommit?.message).toBe("agent:claude-code: test.write (2 files)");
    expect(agentCommit?.files).toBe(2);
    const lines = await log(m);
    expect(lines).toContain("agent:claude-code|agent:claude-code: test.write (2 files)");
    expect(lines).toContain("human|human: test.write (1 file)");
    // each commit holds only its own files
    const files = await git(m).out(["show", "--name-only", "--format=", "HEAD~1"]);
    expect(files.split("\n").every((f) => f.startsWith("notes/"))).toBe(true);
    expect((await status(m)).git.uncommitted).toBe(0);
  });

  it("commits changes from outside the core as human, worker output as system", async () => {
    const m = await newMac();
    await configure(m, { versioning: true });
    raw(m.root, "notes/obsidian.md", noteFile(noteData("Obsidian"), "typed by hand"));
    m.lib.emit("change", { rel: "notes/obsidian.md", status: "indexed", external: true });
    raw(m.root, "items/a/derived/3f9a1c2e7b4d/idmap.json", "{}");
    m.lib.emit("change", {
      rel: "items/a/derived/3f9a1c2e7b4d/idmap.json",
      status: "indexed",
      external: true,
    });
    const res = await syncNowOp(m);
    expect(res.commits.map((c) => c.actor).sort()).toEqual(["human", "system"]);
  });

  it("moves an existing .git out of the library when it lands in iCloud", async () => {
    const m = await newMac();
    await configure(m, { versioning: true });
    expect(lstatSync(join(m.root, ".git")).isDirectory()).toBe(true);
    const v = new Versioner(m.root, { localGitDir: join(m.lib.local.dir, "git"), quietMs: 10 });
    const out = await v.ensureRepo(true);
    expect(out.state.kind).toBe("separate");
    expect(lstatSync(join(m.root, ".git")).isFile()).toBe(true);
    expect(existsSync(join(m.lib.local.dir, "git", "HEAD"))).toBe(true);
    expect((await log(m)).length).toBeGreaterThan(0);
  });
});

describe("separate git directory in iCloud", () => {
  it("keeps .git outside the library and still commits", async () => {
    const m = await newMac({ location: "icloud" });
    const res = await configure(m, { transport: "icloud" });
    expect(res.location).toBe("icloud");
    expect(res.git.gitDir).toBe("separate");
    expect(res.git.gitDirPath).toBe(join(m.lib.local.dir, "git"));
    expect(lstatSync(join(m.root, ".git")).isFile()).toBe(true);
    expect(readFileSync(join(m.root, ".git"), "utf8")).toContain(join(m.lib.local.dir, "git"));
    await m.registry.call("test.write", agent, {
      rel: "notes/x.md",
      content: noteFile(noteData("X"), "x"),
    });
    const sync = await syncNowOp(m);
    expect(sync.commits[0]?.message).toMatch(/^agent:claude-code: /);
    expect(existsSync(join(m.root, ".git", "HEAD"))).toBe(false);
  });

  it("recreates a pointer that points to a git directory from another Mac", async () => {
    const m = await newMac({ location: "icloud" });
    mkdirSync(m.root, { recursive: true });
    writeFileSync(join(m.root, ".git"), "gitdir: /Users/other/Library/git-elsewhere\n");
    expect((await status(m)).git.gitDir).toBe("broken");
    const res = await configure(m, { transport: "icloud" });
    expect(res.git.gitDir).toBe("separate");
  });
});

describe("transport rules", () => {
  it("refuses a git remote while the library sits in iCloud, with an agent-ready error", async () => {
    const m = await newMac({ location: "icloud" });
    const remote = await bareRemote();
    const err = await configure(m, { transport: "git", remote }).catch((e) => e);
    expect(err).toBeInstanceOf(CitegeistError);
    expect((err as CitegeistError).detail).toMatchObject({
      code: "SYNC_GIT_REMOTE_IN_SYNCED_FOLDER",
      recovery: "fix-and-retry",
    });
    expect((err as CitegeistError).detail.fix).toMatch(/icloud/i);
    expect((await status(m)).transport).toBe("none");
    expect(existsSync(join(m.lib.local.dir, "sync.json"))).toBe(false);
  });

  it("refuses a git remote in Dropbox as well, and iCloud outside iCloud", async () => {
    const dropbox = await newMac({ location: "dropbox" });
    await expect(
      configure(dropbox, { transport: "git", remote: await bareRemote() }),
    ).rejects.toMatchObject({ detail: { code: "SYNC_GIT_REMOTE_IN_SYNCED_FOLDER" } });
    const local = await newMac();
    await expect(configure(local, { transport: "icloud" })).rejects.toMatchObject({
      detail: { code: "SYNC_NOT_IN_ICLOUD" },
    });
  });

  it("rejects remote addresses that could run commands", async () => {
    const m = await newMac();
    for (const remote of ["ext::sh -c touch /tmp/x", "--upload-pack=x", "not a url"]) {
      await expect(configure(m, { transport: "git", remote })).rejects.toMatchObject({
        detail: { code: "SYNC_REMOTE_INVALID" },
      });
    }
    await expect(configure(m, { transport: "git" })).rejects.toMatchObject({
      detail: { code: "SYNC_REMOTE_MISSING" },
    });
  });

  it("stores the configuration per machine and survives a restart", async () => {
    const m = await newMac();
    const remote = await bareRemote();
    await configure(m, { transport: "git", remote, intervalMinutes: 5 });
    const second = wire(m.lib);
    const st = await status(second);
    expect(st).toMatchObject({ transport: "git", intervalMinutes: 5, versioning: true });
    expect(st.git.remote?.url).toBe(remote);
  });
});

describe("git remote", () => {
  async function pair(): Promise<{ a: Mac; b: Mac; remote: string }> {
    const remote = await bareRemote();
    const a = await newMac();
    await configure(a, { transport: "git", remote, lfs: "off" });
    await syncNowOp(a);
    const b = await cloneMac(remote);
    await configure(b, { transport: "git", remote, lfs: "off" });
    return { a, b, remote };
  }

  it("pushes the first sync and a second clone sees the files", async () => {
    const { a, b } = await pair();
    expect((await status(a)).git.remote).toMatchObject({ ahead: 0, behind: 0 });
    expect(existsSync(join(b.root, "citegeist.json"))).toBe(true);
    expect(existsSync(join(b.root, "AGENTS.md"))).toBe(true);
  });

  it("merges two clones that edit different cards without conflict", async () => {
    const { a, b } = await pair();
    writeNote(a, "from-a", "written on A");
    writeNote(b, "from-b", "written on B");
    const onA = await syncNowOp(a);
    expect(onA.pushed).toBe(true);
    const onB = await syncNowOp(b);
    expect(onB.pulled).toBe(true);
    expect(onB.pushed).toBe(true);
    expect(onB.conflicts).toEqual([]);
    const onA2 = await syncNowOp(a);
    expect(onA2.pulled).toBe(true);
    expect(onA2.conflicts).toEqual([]);

    for (const m of [a, b]) {
      expect(readFileSync(join(m.root, "notes", "from-a.md"), "utf8")).toContain("written on A");
      expect(readFileSync(join(m.root, "notes", "from-b.md"), "utf8")).toContain("written on B");
      expect(m.lib.status().notes).toBe(2);
      expect((await status(m)).git.remote).toMatchObject({ ahead: 0, behind: 0 });
    }
    expect(await git(a).out(["rev-parse", "HEAD"])).toBe(await git(b).out(["rev-parse", "HEAD"]));
  });

  it("keeps the history of different actors when it rebases", async () => {
    const { a, b } = await pair();
    await b.registry.call("test.write", agent, {
      rel: "notes/by-agent.md",
      content: noteFile(noteData("By agent"), "agent text"),
    });
    writeNote(a, "by-human", "human text");
    await syncNowOp(a);
    await syncNowOp(b);
    expect(await log(b)).toContain("agent:claude-code|agent:claude-code: test.write (1 file)");
  });

  it("writes both versions side by side when two clones edit the same file", async () => {
    const { a, b } = await pair();
    const id = writeNote(a, "shared", "original text");
    await syncNowOp(a);
    await syncNowOp(b);
    expect(existsSync(join(b.root, "notes", "shared.md"))).toBe(true);

    writeNote(a, "shared", "edit from A", id);
    writeNote(b, "shared", "edit from B", id);
    await syncNowOp(a);
    const onB = await syncNowOp(b);

    expect(onB.pulled).toBe(true);
    expect(onB.conflicts).toHaveLength(1);
    const conflict = onB.conflicts[0] as SyncConflict;
    expect(conflict).toMatchObject({ path: "notes/shared.md", copy: "notes/shared 2.md" });
    expect(conflict.identical).toBe(false);
    expect(conflict.diff).toContain("edit from");
    // a is this Mac, b is the remote
    expect(readFileSync(join(b.root, "notes", "shared.md"), "utf8")).toContain("edit from B");
    expect(readFileSync(join(b.root, "notes", "shared 2.md"), "utf8")).toContain("edit from A");
    expect(await git(b).out(["status", "--porcelain"])).toBe("");

    // the problem list of the library reports the copy
    b.lib.sync();
    expect(
      b.lib.status().problems.some((p) => p.path.endsWith("shared 2.md") && p.code.length > 0),
    ).toBe(true);
    expect((await status(b)).conflicts).toHaveLength(1);

    // the other Mac receives the conflict as well, so nobody overlooks it
    const onA = await syncNowOp(a);
    expect(onA.conflicts.map((c) => c.copy)).toEqual(["notes/shared 2.md"]);
  });

  it("resolves a conflict by keeping a, b or both", async () => {
    const { a, b } = await pair();
    const id = writeNote(a, "shared", "original");
    await syncNowOp(a);
    await syncNowOp(b);
    writeNote(a, "shared", "edit from A", id);
    writeNote(b, "shared", "edit from B", id);
    await syncNowOp(a);
    await syncNowOp(b);

    const keepBoth = await resolve(b, { path: "notes/shared.md", keep: "both" });
    expect(keepBoth).toMatchObject({ keep: "both", removed: ["notes/shared 2.md"] });
    const kept = (keepBoth as { kept: string[] }).kept;
    expect(kept).toEqual(["notes/shared.md", "notes/shared-copy.md"]);
    expect(readFileSync(join(b.root, "notes", "shared-copy.md"), "utf8")).toContain("edit from A");
    expect(readFileSync(join(b.root, "notes", "shared-copy.md"), "utf8")).not.toContain(id);
    expect((await status(b)).conflicts).toEqual([]);
    expect(await git(b).out(["status", "--porcelain"])).toBe("");
    expect((await log(b))[0]).toMatch(/^human\|human: sync\.resolveConflict/);

    // the resolution travels to the other Mac, which then has no conflict either
    await syncNowOp(b);
    const onA = await syncNowOp(a);
    expect(onA.conflicts).toEqual([]);
    expect(existsSync(join(a.root, "notes", "shared 2.md"))).toBe(false);
    expect(existsSync(join(a.root, "notes", "shared-copy.md"))).toBe(true);
  });

  it("keeps a or b by deleting or promoting the copy", async () => {
    const { a, b } = await pair();
    const id = writeNote(a, "shared", "original");
    await syncNowOp(a);
    await syncNowOp(b);
    writeNote(a, "shared", "edit from A", id);
    writeNote(b, "shared", "edit from B", id);
    await syncNowOp(a);
    await syncNowOp(b);

    await resolve(b, { path: "notes/shared.md", keep: "b" });
    const text = readFileSync(join(b.root, "notes", "shared.md"), "utf8");
    expect(text).toContain("edit from A");
    expect(existsSync(join(b.root, "notes", "shared 2.md"))).toBe(false);
    await expect(resolve(b, { path: "notes/shared.md", keep: "a" })).rejects.toMatchObject({
      detail: { code: "SYNC_NO_CONFLICT" },
    });
    await expect(resolve(b, { path: "../escape.md", keep: "a" })).rejects.toMatchObject({
      detail: { code: "SYNC_PATH_INVALID" },
    });
  });

  it("turns on LFS tracking for PDFs when git-lfs is installed", async () => {
    const remote = await bareRemote();
    const on = await newMac({ lfsInstalled: async () => true });
    const st = await configure(on, { transport: "git", remote, lfs: "auto" });
    expect(st.git.lfs).toEqual({ mode: "auto", installed: true, tracking: true });
    expect(readFileSync(join(on.root, ".gitattributes"), "utf8")).toContain(
      "items/*/sources/* filter=lfs",
    );
    const off = await newMac({ lfsInstalled: async () => false });
    const st2 = await configure(off, { transport: "git", remote, lfs: "auto" });
    expect(st2.git.lfs).toEqual({ mode: "auto", installed: false, tracking: false });
    expect(existsSync(join(off.root, ".gitattributes"))).toBe(false);
    await expect(configure(off, { transport: "git", remote, lfs: "on" })).rejects.toMatchObject({
      detail: { code: "SYNC_LFS_MISSING" },
    });
  });

  it("reports an unreachable remote and keeps the local commits", async () => {
    const m = await newMac();
    await configure(m, { transport: "git", remote: "/does/not/exist.git", lfs: "off" });
    writeNote(m, "n", "text");
    await expect(syncNowOp(m)).rejects.toMatchObject({
      detail: { code: "SYNC_REMOTE_UNREACHABLE" },
    });
    expect((await status(m)).git.uncommitted).toBe(0);
    expect((await status(m)).lastSync?.ok).toBe(false);
  });
});

describe("iCloud", () => {
  it("downloads evicted files that the index needs and leaves PDFs for on-demand use", async () => {
    const downloads: string[] = [];
    const m = await newMac({
      location: "icloud",
      runner: async (abs) => {
        downloads.push(abs);
        const dir = dirname(abs);
        const name = abs.slice(dir.length + 1);
        writeFileSync(abs, `content of ${name}`);
        rmSync(join(dir, `.${name}.icloud`));
        return { code: 0, stderr: "" };
      },
    });
    await configure(m, { transport: "icloud" });
    raw(m.root, "notes/.remote-note.md.icloud", "");
    raw(m.root, "items/luhmann1984/sources/.3f9a1c2e7b4d.pdf.icloud", "");
    expect((await status(m)).evicted).toEqual([
      "items/luhmann1984/sources/3f9a1c2e7b4d.pdf",
      "notes/remote-note.md",
    ]);

    const res = await syncNowOp(m);
    expect(res.downloaded).toEqual(["notes/remote-note.md"]);
    expect(res.evicted).toEqual(["items/luhmann1984/sources/3f9a1c2e7b4d.pdf"]);
    expect(downloads).toHaveLength(1);

    // the PDF comes down when something asks for it
    expect(await m.service.ensureLocal("items/luhmann1984/sources/3f9a1c2e7b4d.pdf")).toBe(true);
    expect(await m.service.ensureLocal("notes/remote-note.md")).toBe(true);
    expect((await status(m)).evicted).toEqual([]);
  });

  it("downloads everything on request and reports files that did not arrive", async () => {
    const m = await newMac({
      location: "icloud",
      runner: async () => ({ code: 1, stderr: "no network" }),
    });
    raw(m.root, "items/a/sources/.abc.pdf.icloud", "");
    const res = await syncNowOp(m, { downloadAll: true });
    expect(res.downloaded).toEqual([]);
    expect(res.evicted).toEqual(["items/a/sources/abc.pdf"]);
  });

  it("reports conflict copies and resolves them", async () => {
    const m = await newMac({ location: "icloud" });
    await configure(m, { transport: "icloud" });
    const id = writeNote(m, "idea", "mine");
    raw(m.root, "notes/idea 2.md", noteFile(noteData("Idea", { id }), "theirs"));
    m.lib.sync();

    const st = await status(m);
    expect(st.conflicts).toHaveLength(1);
    expect(st.conflicts[0]).toMatchObject({ path: "notes/idea.md", copy: "notes/idea 2.md" });
    expect(st.conflicts[0]?.diff).toContain("theirs");
    expect(m.lib.status().problems.some((p) => p.path.endsWith("idea 2.md"))).toBe(true);

    await resolve(m, { path: "notes/idea.md", keep: "b" });
    expect(readFileSync(join(m.root, "notes", "idea.md"), "utf8")).toContain("theirs");
    expect((await status(m)).conflicts).toEqual([]);
    m.lib.sync();
    expect(m.lib.status().problems.some((p) => p.path.endsWith("idea 2.md"))).toBe(false);
  });

  it("also recognizes Dropbox conflicted copies", async () => {
    const m = await newMac({ location: "dropbox" });
    writeNote(m, "idea", "mine");
    raw(
      m.root,
      "notes/idea (Alex's conflicted copy 2026-10-23).md",
      noteFile(noteData("Idea"), "theirs"),
    );
    const st = await status(m);
    expect(st.conflicts.map((c) => c.path)).toEqual(["notes/idea.md"]);
    await resolve(m, { path: "notes/idea.md", keep: "a" });
    expect((await status(m)).conflicts).toEqual([]);
  });

  it("gives a kept-both card its own id and file name", async () => {
    const m = await newMac();
    const card = "items/luhmann1984/cards/c_01ABC.md";
    const body = (text: string) => `---\nid: c_01ABC\nitem: luhmann1984\n---\n\n> ${text}\n`;
    raw(m.root, card, body("one"));
    raw(m.root, "items/luhmann1984/cards/c_01ABC 2.md", body("two"));
    const res = (await resolve(m, { path: card, keep: "both" })) as { kept: string[] };
    const other = res.kept.find((k) => k !== card) as string;
    expect(other).toMatch(/^items\/luhmann1984\/cards\/c_[0-9A-Z]{26}\.md$/);
    const text = readFileSync(join(m.root, ...other.split("/")), "utf8");
    expect(text).toContain(`id: ${other.split("/").pop()?.replace(".md", "")}`);
    expect(text).toContain("two");
  });
});
