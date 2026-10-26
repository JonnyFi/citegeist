// biome-ignore-all lint/suspicious/noExplicitAny: parsed JSON of requests and replies
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  itemsAdd,
  itemsGet,
  notesCreate,
  projectsGet,
  Registry,
  webhooksCreate,
  webhooksSetAuth,
} from "@citegeist/ops";
import { CitegeistError } from "@citegeist/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { attachWebhooks } from "./attach.js";
import {
  ConnectorStore,
  FailureLimiter,
  generateSecret,
  ID_HEADER,
  type InboundResponse,
  memoryTaskTracker,
  queueTaskTracker,
  type SecretStore,
  SIGNATURE_HEADER,
  signRequest,
  TIMESTAMP_HEADER,
  verifyRequest,
  WebhookService,
} from "./index.js";

class MemorySecrets implements SecretStore {
  readonly map = new Map<string, string>();
  async get(a: string) {
    return this.map.get(a);
  }
  async set(a: string, s: string) {
    this.map.set(a, s);
  }
  async delete(a: string) {
    this.map.delete(a);
  }
  async has(a: string) {
    return this.map.has(a);
  }
}

const PROJECT_JOB = "j_01JB8Z3QK7ABCDEFGH";

interface Calls {
  items: any[];
  notes: any[];
  actors: string[];
}

/** A registry with just the operations the receiver calls, recording what they get. */
function fakeRegistry(): { registry: Registry; calls: Calls } {
  const calls: Calls = { items: [], notes: [], actors: [] };
  const registry = new Registry()
    .bind(itemsAdd, async (ctx, input) => {
      calls.items.push(input);
      calls.actors.push(ctx.actor);
      if (input.identifier === "nonsense") {
        throw new CitegeistError({
          code: "IDENTIFIER_UNRECOGNIZED",
          message: "not an identifier",
          fix: "Pass a DOI.",
          recovery: "fix-and-retry",
        });
      }
      const key =
        input.identifier
          .replace(/[^a-z0-9]/gi, "")
          .toLowerCase()
          .slice(0, 20) || "x1";
      return { citekey: `k${key}`.slice(0, 30), job: PROJECT_JOB };
    })
    .bind(itemsGet, async (_ctx, input) => {
      if (input.citekey !== "smith2020") throw new Error("missing");
      return {
        frontmatter: {
          id: "01JB8Z3QK7ABCDEFGH",
          citekey: "smith2020",
          type: "article-journal",
          title: "A known paper",
          created: { at: "2026-10-24T10:00:00.000Z", by: "human" },
        },
        note: "",
        cards: 0,
        path: "items/smith2020",
      } as never;
    })
    .bind(notesCreate, async (ctx, input) => {
      calls.notes.push(input);
      calls.actors.push(ctx.actor);
      return {
        frontmatter: {
          id: "n_01JB8Z3QK7",
          type: input.type,
          title: input.title,
          links: [],
          tags: [],
          projects: input.projects,
          created: { at: "2026-10-24T10:00:00.000Z", by: ctx.actor },
        },
        body: input.body,
        path: "notes/x.md",
      };
    })
    .bind(projectsGet, async (_ctx, input) => {
      return {
        frontmatter: {
          slug: input.slug,
          title: "Systems theory",
          status: "active",
          questions: [],
          style: "apa",
          locale: "de-DE",
          export: { paraphrase: "own-else-ai", labelAi: false },
          created: { at: "2026-10-24T10:00:00.000Z", by: "human" },
        },
        brief: `Brief of ${input.slug}. ${"x".repeat(3000)}`,
        items: 0,
      } as never;
    });
  return { registry, calls };
}

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "citegeist-webhooks-"));
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

function makeService(
  over: {
    dir?: string;
    fetch?: typeof fetch;
    publicBaseUrl?: string;
    tasks?: ReturnType<typeof memoryTaskTracker>;
    retryDelaysMs?: readonly number[];
    sleep?: (ms: number) => Promise<void>;
  } = {},
) {
  const { registry, calls } = fakeRegistry();
  const secrets = new MemorySecrets();
  const tasks = over.tasks ?? memoryTaskTracker();
  let clock = new Date("2026-10-24T12:00:00Z");
  const service = new WebhookService({
    store: ConnectorStore.inDir(over.dir ?? tmp),
    secrets,
    registry,
    tasks,
    publicBaseUrl: () => over.publicBaseUrl,
    localBaseUrl: () => "http://127.0.0.1:4711",
    now: () => clock,
    retryDelaysMs: over.retryDelaysMs ?? [],
    ...(over.sleep ? { sleep: over.sleep } : {}),
    ...(over.fetch ? { fetch: over.fetch } : {}),
  });
  return {
    service,
    calls,
    secrets,
    tasks,
    setClock: (d: Date) => {
      clock = d;
    },
    now: () => clock,
  };
}

type Harness = ReturnType<typeof makeService>;

/** Signs a JSON payload as the external agent would and delivers it to the receiver. */
async function deliver(
  h: Harness,
  name: string,
  secret: string,
  payload: unknown,
  opts: { id?: string; at?: Date; raw?: string } = {},
): Promise<InboundResponse> {
  const raw = opts.raw ?? JSON.stringify(payload);
  const headers = signRequest(secret, raw, {
    ...(opts.id ? { id: opts.id } : {}),
    now: opts.at ?? h.now(),
  });
  const res = await h.service.handleInbound({
    method: "POST",
    path: `/hooks/${name}`,
    headers,
    rawBody: Buffer.from(raw),
  });
  if (!res) throw new Error("not a webhook path");
  return res;
}

describe("signature validation", () => {
  it("accepts a good signature", async () => {
    const h = makeService();
    const { secret } = await h.service.create({ name: "grok", kind: "inbound" });
    const res = await deliver(h, "grok", secret, { event: "ping" });
    expect(res.status).toBe(200);
    expect(res.body.pong).toBe(true);
  });

  it("rejects a wrong secret, a changed body and missing headers with 401", async () => {
    const h = makeService();
    const { secret } = await h.service.create({ name: "grok", kind: "inbound" });

    const wrong = await deliver(h, "grok", generateSecret(), { event: "ping" });
    expect(wrong.status).toBe(401);

    const raw = JSON.stringify({ event: "ping" });
    const headers = signRequest(secret, raw, { now: h.now() });
    const tampered = await h.service.handleInbound({
      method: "POST",
      path: "/hooks/grok",
      headers,
      rawBody: Buffer.from(`${raw} `),
    });
    expect(tampered?.status).toBe(401);

    const bare = await h.service.handleInbound({
      method: "POST",
      path: "/hooks/grok",
      headers: {},
      rawBody: Buffer.from(raw),
    });
    expect(bare?.status).toBe(401);
    expect(bare?.body.reason).toBe("missing-headers");
  });

  it("answers an unknown connector like a bad signature", async () => {
    const h = makeService();
    const res = await deliver(h, "nobody", generateSecret(), { event: "ping" });
    expect(res.status).toBe(401);
    expect(res.body.reason).toBe("bad-signature");
  });

  it("rejects a timestamp outside the window, in both directions", async () => {
    const h = makeService();
    const { secret } = await h.service.create({ name: "grok", kind: "inbound" });
    const old = new Date(h.now().getTime() - 6 * 60_000);
    const future = new Date(h.now().getTime() + 6 * 60_000);
    expect((await deliver(h, "grok", secret, { event: "ping" }, { at: old })).status).toBe(401);
    expect((await deliver(h, "grok", secret, { event: "ping" }, { at: future })).body.reason).toBe(
      "stale-timestamp",
    );
    const ok = new Date(h.now().getTime() - 4 * 60_000);
    expect((await deliver(h, "grok", secret, { event: "ping" }, { at: ok })).status).toBe(200);
  });

  it("refuses a replayed delivery", async () => {
    const h = makeService();
    const { secret } = await h.service.create({ name: "grok", kind: "inbound" });
    const payload = { event: "papers.add", papers: ["10.1000/x"] };
    const raw = JSON.stringify(payload);
    const req = {
      method: "POST",
      path: "/hooks/grok",
      headers: signRequest(secret, raw, { now: h.now(), id: "delivery-1" }),
      rawBody: Buffer.from(raw),
    };
    expect((await h.service.handleInbound(req))?.status).toBe(200);
    const again = await h.service.handleInbound(req);
    expect(again?.status).toBe(409);
    expect(again?.body.error).toBe("replayed");
    expect(h.calls.items).toHaveLength(1);
  });

  it("does not use up a delivery id when the signature is wrong", async () => {
    const h = makeService();
    const { secret } = await h.service.create({ name: "grok", kind: "inbound" });
    const raw = JSON.stringify({ event: "ping" });
    const forged = signRequest(generateSecret(), raw, { now: h.now(), id: "same-id" });
    const real = signRequest(secret, raw, { now: h.now(), id: "same-id" });
    const send = (headers: Record<string, string>) =>
      h.service.handleInbound({
        method: "POST",
        path: "/hooks/grok",
        headers,
        rawBody: Buffer.from(raw),
      });
    expect((await send(forged))?.status).toBe(401);
    expect((await send(real))?.status).toBe(200);
  });

  it("keeps the previous secret valid during the grace period only", async () => {
    const h = makeService();
    const { secret: first } = await h.service.create({ name: "grok", kind: "inbound" });
    const { secret: second, webhook } = await h.service.rotateSecret({
      name: "grok",
      graceMinutes: 10,
    });
    expect(second).not.toBe(first);
    expect(webhook.previousSecretUntil).toBeDefined();
    expect((await deliver(h, "grok", second, { event: "ping" })).status).toBe(200);
    expect((await deliver(h, "grok", first, { event: "ping" })).status).toBe(200);

    h.setClock(new Date(h.now().getTime() + 11 * 60_000));
    expect((await deliver(h, "grok", first, { event: "ping" })).status).toBe(401);
    expect((await deliver(h, "grok", second, { event: "ping" })).status).toBe(200);
  });

  it("revokes the old secret at once with a grace period of 0", async () => {
    const h = makeService();
    const { secret: first } = await h.service.create({ name: "grok", kind: "inbound" });
    await h.service.rotateSecret({ name: "grok", graceMinutes: 0 });
    expect((await deliver(h, "grok", first, { event: "ping" })).status).toBe(401);
  });

  it("verifyRequest compares against every listed signature", () => {
    const body = Buffer.from("{}");
    const now = new Date("2026-10-24T12:00:00Z");
    const a = signRequest("secret-a", "{}", { now, id: "i1" });
    const b = signRequest("secret-b", "{}", { now, id: "i1" });
    const both = `${a[SIGNATURE_HEADER]} ${b[SIGNATURE_HEADER]}`;
    const verdict = verifyRequest({
      id: a[ID_HEADER],
      timestamp: a[TIMESTAMP_HEADER],
      signature: both,
      rawBody: body,
      secrets: ["secret-b"],
      now,
    });
    expect(verdict.ok).toBe(true);
  });
});

describe("inbound payloads", () => {
  async function connected(kind: "inbound" | "outbound" | "both" = "inbound") {
    const h = makeService();
    const { secret } = await h.service.create({
      name: "grok",
      kind,
      ...(kind === "inbound" ? {} : { url: "https://grok.example/hook" }),
    });
    return { h, secret };
  }

  it("puts papers into the inbox by default, as the connector's agent actor", async () => {
    const { h, secret } = await connected();
    const res = await deliver(h, "grok", secret, {
      event: "papers.add",
      papers: ["10.1000/abc", { url: "https://arxiv.org/abs/2401.00001", why: "its own reason" }],
      why: "from the X thread on autopoiesis",
    });
    expect(res.status).toBe(200);
    expect(res.body.target).toBe("inbox");
    expect(h.calls.items).toEqual([
      {
        identifier: "10.1000/abc",
        target: "inbox",
        projects: [],
        tags: [],
        why: "from the X thread on autopoiesis",
      },
      {
        identifier: "https://arxiv.org/abs/2401.00001",
        target: "inbox",
        projects: [],
        tags: [],
        why: "its own reason",
      },
    ]);
    expect(new Set(h.calls.actors)).toEqual(new Set(["agent:grok"]));
  });

  it("passes target library, projects and tags through", async () => {
    const { h, secret } = await connected();
    await deliver(h, "grok", secret, {
      event: "papers.add",
      papers: ["10.1000/known"],
      target: "library",
      projects: ["systems-theory"],
      tags: ["x-thread"],
    });
    expect(h.calls.items[0]).toMatchObject({
      target: "library",
      projects: ["systems-theory"],
      tags: ["x-thread"],
    });
  });

  it("reports a paper that fails and still adds the others", async () => {
    const { h, secret } = await connected();
    const res = await deliver(h, "grok", secret, {
      event: "papers.add",
      papers: ["nonsense", "10.1000/fine"],
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect((res.body as any).results[0]).toMatchObject({
      ok: false,
      error: { code: "IDENTIFIER_UNRECOGNIZED" },
    });
    expect((res.body as any).results[1].ok).toBe(true);
  });

  it("refuses local files and private addresses without calling items.add", async () => {
    const { h, secret } = await connected();
    const bad = [
      "/Users/me/Documents/taxes.pdf",
      "~/secret.html",
      "../notes/page.html",
      "file:///etc/passwd",
      "secret.epub",
      "http://127.0.0.1:41234/health",
      "http://localhost:11434/api/tags",
      "http://169.254.169.254/latest/meta-data/",
      "http://[::1]/",
      "http://2130706433/",
      "https://192.168.1.1/admin",
      "http://printer.local/status.html",
      "http://intranet/wiki",
      "ftp://example.org/a.pdf",
    ];
    const res = await deliver(h, "grok", secret, { event: "papers.add", papers: bad });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    const results = (res.body as any).results as Array<{ ok: boolean; error?: { code: string } }>;
    expect(results).toHaveLength(bad.length);
    for (const r of results)
      expect(r).toMatchObject({ ok: false, error: { code: "WEBHOOK_INPUT_REFUSED" } });
    expect(h.calls.items).toEqual([]);
  });

  it("still accepts DOIs, ids, public URLs and BibTeX", async () => {
    const { h, secret } = await connected();
    const good = [
      "10.1000/abc.pdf",
      "doi:10.1000/xyz",
      "arXiv:2401.00001",
      "https://arxiv.org/abs/2401.00001",
      "http://example.org/paper.pdf",
      "@article{k, title={T}, year={2020}}",
    ];
    const res = await deliver(h, "grok", secret, { event: "papers.add", papers: good });
    expect(res.body.ok).toBe(true);
    expect(h.calls.items.map((i: any) => i.identifier)).toEqual(good);
  });

  it("refuses a local file inside a note's sources as well", async () => {
    const { h, secret } = await connected();
    const res = await deliver(h, "grok", secret, {
      event: "note.add",
      title: "t",
      text: "body",
      sources: ["/Users/me/secret.pdf"],
    });
    expect(res.status).toBe(200);
    expect(h.calls.items).toEqual([]);
  });

  it("rejects an invalid payload with 400 and a list of problems", async () => {
    const { h, secret } = await connected();
    const empty = await deliver(h, "grok", secret, { event: "papers.add", papers: [] });
    expect(empty.status).toBe(400);
    const unknown = await deliver(h, "grok", secret, { event: "drop.database" });
    expect(unknown.status).toBe(400);
    const notJson = await deliver(h, "grok", secret, null, { raw: "{nope" });
    expect(notJson.status).toBe(400);
    expect(h.calls.items).toHaveLength(0);
  });

  it("creates a note with its sources as links", async () => {
    const { h, secret } = await connected();
    const res = await deliver(h, "grok", secret, {
      event: "note.add",
      title: "Luhmann on autopoiesis",
      text: "Autopoiesis is not a metaphor in Luhmann's use.",
      type: "claim",
      sources: [
        { citekey: "smith2020" },
        "10.1000/new-paper",
        "https://x.com/someone/status/1",
        { url: "https://example.org/post", title: "A blog post" },
        "smith2020",
      ],
      projects: ["systems-theory"],
    });
    expect(res.status).toBe(200);
    expect(res.body.note).toBe("n_01JB8Z3QK7");
    const note = h.calls.notes[0];
    expect(note).toMatchObject({
      title: "Luhmann on autopoiesis",
      type: "claim",
      projects: ["systems-theory"],
    });
    expect(note.body).toContain("Autopoiesis is not a metaphor");
    expect(note.body).toContain("## Sources");
    expect(note.body).toContain("- [[smith2020]]");
    expect(note.body).toContain("- <https://x.com/someone/status/1>");
    expect(note.body).toContain("- [A blog post](https://example.org/post)");
    // The identifier became an inbox item and the note links to it.
    expect(h.calls.items).toEqual([
      expect.objectContaining({ identifier: "10.1000/new-paper", target: "inbox" }),
    ]);
    expect(note.body).toContain("- [[k101000newpaper]]");
    // The same source twice appears once.
    expect(note.body.match(/\[\[smith2020\]\]/g)).toHaveLength(1);
    expect(new Set(h.calls.actors)).toEqual(new Set(["agent:grok"]));
  });

  it("keeps an outbound-only connector from adding content, but lets it ping", async () => {
    const { h, secret } = await connected("outbound");
    expect((await deliver(h, "grok", secret, { event: "ping" })).status).toBe(200);
    const res = await deliver(h, "grok", secret, { event: "papers.add", papers: ["10.1000/x"] });
    expect(res.status).toBe(403);
    expect(h.calls.items).toHaveLength(0);
  });

  it("answers 405 to GET and 404 to a path under /hooks/ that is no connector", async () => {
    const h = makeService();
    const get = await h.service.handleInbound({
      method: "GET",
      path: "/hooks/grok",
      headers: {},
      rawBody: Buffer.alloc(0),
    });
    expect(get?.status).toBe(405);
    const odd = await h.service.handleInbound({
      method: "POST",
      path: "/hooks/Bad/Name",
      headers: {},
      rawBody: Buffer.alloc(0),
    });
    expect(odd?.status).toBe(404);
    expect(
      await h.service.handleInbound({
        method: "POST",
        path: "/rpc/items/list",
        headers: {},
        rawBody: Buffer.alloc(0),
      }),
    ).toBeUndefined();
  });
});

describe("outbound tasks", () => {
  interface Sent {
    url: string;
    headers: Record<string, string>;
    body: string;
  }

  function recordingFetch(status = 202): { fetch: typeof fetch; sent: Sent[] } {
    const sent: Sent[] = [];
    const fn = (async (url: string | URL | Request, init?: RequestInit) => {
      sent.push({
        url: String(url),
        headers: init?.headers as Record<string, string>,
        body: String(init?.body),
      });
      return new Response(status === 204 ? null : "ok", { status });
    }) as typeof fetch;
    return { fetch: fn, sent };
  }

  async function setup(status = 202, dir = "first") {
    const rec = recordingFetch(status);
    const h = makeService({
      fetch: rec.fetch,
      publicBaseUrl: "https://mac.example.ts.net/",
      dir: join(tmp, dir),
    });
    const { secret } = await h.service.create({
      name: "grok",
      kind: "both",
      url: "https://grok.example/tasks",
    });
    return { h, secret, sent: rec.sent };
  }

  it("signs the task so the connector can verify it", async () => {
    const { h, secret, sent } = await setup();
    const { job } = await h.service.send("human", {
      name: "grok",
      prompt: "Find recent work on autopoiesis in sociology",
      project: "systems-theory",
      briefChars: 100,
    });
    expect(sent).toHaveLength(1);
    const req = sent[0] as Sent;
    expect(req.url).toBe("https://grok.example/tasks");
    const verdict = verifyRequest({
      id: req.headers[ID_HEADER],
      timestamp: req.headers[TIMESTAMP_HEADER],
      signature: req.headers[SIGNATURE_HEADER],
      rawBody: Buffer.from(req.body),
      secrets: [secret],
      now: h.now(),
    });
    expect(verdict.ok).toBe(true);
    const payload = JSON.parse(req.body);
    expect(payload).toMatchObject({
      event: "task.request",
      task: job,
      prompt: "Find recent work on autopoiesis in sociology",
      callback: { url: "https://mac.example.ts.net/hooks/grok", event: "task.result" },
      project: { slug: "systems-theory", title: "Systems theory" },
    });
    expect(payload.project.briefExcerpt.length).toBeLessThanOrEqual(100);
    expect(payload.project.briefExcerpt).toContain("Brief of systems-theory");
  });

  it("ties the callback to the job, and the result lands in the inbox of the project", async () => {
    const { h, secret } = await setup();
    const { job } = await h.service.send("human", {
      name: "grok",
      prompt: "Find recent work on autopoiesis",
      project: "systems-theory",
      briefChars: 0,
    });
    expect(h.tasks.get(job)).toMatchObject({ connector: "grok", open: true });

    const res = await deliver(h, "grok", secret, {
      event: "task.result",
      task: job,
      summary: "Three relevant papers, one is a review.",
      papers: ["10.1000/p1", "10.1000/p2"],
    });
    expect(res.status).toBe(200);
    expect(res.body.task).toBe(job);
    expect(h.calls.items).toHaveLength(2);
    expect(h.calls.items[0]).toMatchObject({
      target: "inbox",
      projects: ["systems-theory"],
    });
    expect(h.calls.items[0].why).toContain(job);
    expect(h.calls.notes[0]).toMatchObject({ projects: ["systems-theory"] });
    expect(h.tasks.outcome(job)).toMatchObject({ ok: true });
    expect(h.tasks.get(job)?.open).toBe(false);

    // A second callback for the same task is refused.
    const again = await deliver(h, "grok", secret, { event: "task.result", task: job });
    expect(again.status).toBe(409);
  });

  it("marks the job failed when the connector reports a failure", async () => {
    const { h, secret } = await setup();
    const { job } = await h.service.send("human", { name: "grok", prompt: "x", briefChars: 0 });
    const res = await deliver(h, "grok", secret, {
      event: "task.result",
      task: job,
      status: "failed",
      error: "rate limited by X",
    });
    expect(res.status).toBe(200);
    expect(h.tasks.outcome(job)).toEqual({ ok: false, message: "rate limited by X" });
    expect(h.calls.items).toHaveLength(0);
  });

  it("refuses a callback for an unknown task or a task of another connector", async () => {
    const { h, secret } = await setup();
    const other = await h.service.create({
      name: "hermes",
      kind: "both",
      url: "https://h.example/t",
    });
    const { job } = await h.service.send("human", { name: "grok", prompt: "x", briefChars: 0 });

    const unknown = await deliver(h, "grok", secret, {
      event: "task.result",
      task: "j_01JB8Z3QK7ZZZZZZZZ",
    });
    expect(unknown.status).toBe(404);
    const stolen = await deliver(h, "hermes", other.secret, { event: "task.result", task: job });
    expect(stolen.status).toBe(403);
    expect(h.tasks.get(job)?.open).toBe(true);
  });

  it("fails the job when the connector does not take the task", async () => {
    const tasks = memoryTaskTracker();
    const created: string[] = [];
    const create = tasks.create.bind(tasks);
    tasks.create = (input) => {
      const id = create(input);
      created.push(id);
      return id;
    };
    const h = makeService({ fetch: recordingFetch(500).fetch, tasks });
    await h.service.create({ name: "grok", kind: "both", url: "https://grok.example/tasks" });
    await expect(
      h.service.send("human", { name: "grok", prompt: "x", briefChars: 0 }),
    ).rejects.toMatchObject({ detail: { code: "WEBHOOK_DELIVERY_FAILED" } });
    expect(created).toHaveLength(1);
    expect(tasks.outcome(created[0] as string)).toMatchObject({ ok: false });
    expect(tasks.get(created[0] as string)?.open).toBe(false);
  });

  it("refuses to send through an inbound-only connector", async () => {
    const h = makeService();
    await h.service.create({ name: "grok", kind: "inbound" });
    await expect(
      h.service.send("human", { name: "grok", prompt: "x", briefChars: 0 }),
    ).rejects.toMatchObject({ detail: { code: "WEBHOOK_NOT_OUTBOUND" } });
  });

  it("test sends a signed ping and reports the HTTP status", async () => {
    const { h, secret, sent } = await setup(204);
    const out = await h.service.test("grok");
    expect(out).toMatchObject({ ok: true, mode: "remote", status: 204 });
    const req = sent[0] as Sent;
    expect(JSON.parse(req.body).event).toBe("ping");
    expect(
      verifyRequest({
        id: req.headers[ID_HEADER],
        timestamp: req.headers[TIMESTAMP_HEADER],
        signature: req.headers[SIGNATURE_HEADER],
        rawBody: Buffer.from(req.body),
        secrets: [secret],
        now: h.now(),
      }).ok,
    ).toBe(true);

    const failing = await setup(503, "second");
    expect(await failing.h.service.test("grok")).toMatchObject({ ok: false, status: 503 });
  });

  it("test checks signing locally for an inbound-only connector", async () => {
    const h = makeService();
    await h.service.create({ name: "grok", kind: "inbound" });
    expect(await h.service.test("grok")).toMatchObject({ ok: true, mode: "local", status: 200 });
    h.secrets.map.clear();
    expect(await h.service.test("grok")).toMatchObject({ ok: false, mode: "local" });
  });
});

describe("queueTaskTracker", () => {
  /** Minimal JobQueue stand-in: stores jobs and runs the registered handler on demand. */
  function fakeQueue() {
    const jobs = new Map<string, any>();
    let handler: ((ctx: { job: { id: string } }) => Promise<unknown>) | undefined;
    let n = 0;
    return {
      jobs,
      run: (id: string) => handler?.({ job: { id } }) as Promise<unknown>,
      queue: {
        newId: () => `j_FAKE${++n}`,
        enqueue(o: any) {
          const id = o.id ?? `j_FAKE${++n}`;
          jobs.set(id, { id, kind: o.kind, status: "queued", input: o.input });
          return { id };
        },
        get: (id: string) => jobs.get(id),
        register(_kind: "research", h: any) {
          handler = h;
        },
      },
    };
  }

  it("lets a job wait for its callback and succeed with the result", async () => {
    const q = fakeQueue();
    const tracker = queueTaskTracker(q.queue);
    const id = tracker.create({ connector: "grok", prompt: "p", project: "demo", by: "human" });
    expect(tracker.get(id)).toEqual({
      id,
      connector: "grok",
      prompt: "p",
      project: "demo",
      open: true,
    });
    const running = q.run(id);
    tracker.complete(id, { papers: [] });
    await expect(running).resolves.toEqual({ papers: [] });
  });

  it("keeps an answer that arrives before the job starts", async () => {
    const q = fakeQueue();
    const tracker = queueTaskTracker(q.queue);
    const id = tracker.create({ connector: "grok", prompt: "p", by: "human" });
    tracker.fail(id, "boom");
    await expect(q.run(id)).rejects.toMatchObject({ detail: { code: "WEBHOOK_TASK_FAILED" } });
  });

  it("fails a job whose callback never comes", async () => {
    const q = fakeQueue();
    const tracker = queueTaskTracker(q.queue, { timeoutMs: 10 });
    const id = tracker.create({ connector: "grok", prompt: "p", by: "human" });
    await expect(q.run(id)).rejects.toThrow(/did not call back/);
  });

  it("does not know jobs of other kinds", () => {
    const q = fakeQueue();
    const tracker = queueTaskTracker(q.queue);
    q.jobs.set("j_OTHER", { id: "j_OTHER", kind: "convert", status: "queued", input: {} });
    expect(tracker.get("j_OTHER")).toBeUndefined();
  });
});

describe("over HTTP with the registry operations", () => {
  let server: Server;
  let base: string;
  let h: ReturnType<typeof fakeRegistry>;
  let hooks: ReturnType<typeof attachWebhooks>;

  beforeEach(async () => {
    h = fakeRegistry();
    hooks = attachWebhooks(
      { registry: h.registry },
      {
        dir: tmp,
        secrets: new MemorySecrets(),
        port: () => (server.address() as AddressInfo).port,
        publicBaseUrl: "https://hooks.example.com",
      },
    );
    server = createServer(async (req, res) => {
      if (await hooks.handle(req, res)) return;
      res.writeHead(401).end("token required");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  });

  const call = (name: string, input: unknown, actor: "human" | `agent:${string}` = "human") =>
    h.registry.call(name, { actor }, input) as Promise<any>;

  it("manages connectors through webhooks.* and receives a signed request", async () => {
    const created = await call("webhooks.create", { name: "grok", kind: "inbound" });
    expect(created.secret).toMatch(/^whsec_/);
    expect(created.webhook.inboundUrl).toBe("https://hooks.example.com/hooks/grok");

    const listed = await call("webhooks.list", {});
    expect(listed.publicBaseUrl).toBe("https://hooks.example.com");
    expect(listed.webhooks).toHaveLength(1);
    expect(JSON.stringify(listed)).not.toContain(created.secret);

    const raw = JSON.stringify({ event: "papers.add", papers: ["10.1000/http"] });
    const res = await fetch(`${base}/hooks/grok`, {
      method: "POST",
      headers: { "content-type": "application/json", ...signRequest(created.secret, raw) },
      body: raw,
    });
    expect(res.status).toBe(200);
    expect(h.calls.items[0]).toMatchObject({ identifier: "10.1000/http", target: "inbox" });

    const bad = await fetch(`${base}/hooks/grok`, {
      method: "POST",
      headers: { "content-type": "application/json", ...signRequest(generateSecret(), raw) },
      body: raw,
    });
    expect(bad.status).toBe(401);
    expect((await call("webhooks.test", { name: "grok" })).ok).toBe(true);

    await call("webhooks.delete", { name: "grok" });
    expect((await call("webhooks.list", {})).webhooks).toEqual([]);
  });

  it("leaves other paths to the caller and refuses a body over the limit", async () => {
    expect((await fetch(`${base}/rpc/items/list`, { method: "POST" })).status).toBe(401);
    const big = "x".repeat(1024 * 1024 + 10);
    const res = await fetch(`${base}/hooks/grok`, { method: "POST", body: big }).catch(() => null);
    // Either the 413 arrives or the server closes the connection while the body is still coming.
    if (res) expect(res.status).toBe(413);
  });

  it("only a human may create, rotate, delete or test connectors", async () => {
    await expect(
      call("webhooks.create", { name: "evil", kind: "inbound" }, "agent:grok"),
    ).rejects.toMatchObject({ detail: { code: "FORBIDDEN_ADMIN" } });
  });

  it("validates the create input", async () => {
    await expect(call("webhooks.create", { name: "Bad Name" })).rejects.toThrow();
    await expect(call("webhooks.create", { name: "ok", kind: "outbound" })).rejects.toThrow();
    await call("webhooks.create", { name: "ok", kind: "outbound", url: "https://x.example/t" });
    await expect(call("webhooks.create", { name: "ok", kind: "inbound" })).rejects.toMatchObject({
      detail: { code: "WEBHOOK_EXISTS" },
    });
  });
});

describe("outbound auth header", () => {
  function capture(status = 200) {
    const sent: Array<{ headers: Record<string, string>; body: string }> = [];
    const fn = (async (_url: string | URL | Request, init?: RequestInit) => {
      sent.push({ headers: init?.headers as Record<string, string>, body: String(init?.body) });
      return new Response("ok", { status });
    }) as typeof fetch;
    return { fetch: fn, sent };
  }

  it("sends the agent's own key next to the HMAC headers and keeps the value in the Keychain", async () => {
    const rec = capture();
    const h = makeService({ fetch: rec.fetch, dir: join(tmp, "auth") });
    const created = await h.service.create({
      name: "grok",
      kind: "both",
      url: "https://api2.cursor.sh/automations/webhook/abc",
      authHeader: "Authorization",
      authValue: "Bearer crsr_secret_value",
    });
    expect(created.webhook).toMatchObject({
      authHeader: "Authorization",
      hasAuthValue: true,
      hasInboundToken: false,
    });
    expect(JSON.stringify(created.webhook)).not.toContain("crsr_secret_value");
    expect(h.secrets.map.get("webhook-grok-auth")).toBe("Bearer crsr_secret_value");
    const listed = await h.service.list();
    expect(JSON.stringify(listed)).not.toContain("crsr_secret_value");
    expect(readFileSync(join(tmp, "auth", "webhooks.json"), "utf8")).not.toContain(
      "crsr_secret_value",
    );

    await h.service.send("human", { name: "grok", prompt: "x", briefChars: 0 });
    const headers = rec.sent[0]?.headers ?? {};
    expect(headers.Authorization).toBe("Bearer crsr_secret_value");
    expect(headers[SIGNATURE_HEADER]).toMatch(/^v1=/);
    expect(headers[ID_HEADER]).toBeTruthy();
    await h.service.test("grok");
    expect(rec.sent[1]?.headers["Authorization"]).toBe("Bearer crsr_secret_value");
  });

  it("changes and removes the header with setAuth, and deleting the connector clears it", async () => {
    const rec = capture();
    const h = makeService({ fetch: rec.fetch, dir: join(tmp, "auth2") });
    await h.service.create({ name: "grok", kind: "outbound", url: "https://a.example/t" });
    const set = await h.service.setAuth({
      name: "grok",
      authHeader: "x-api-key",
      authValue: "k-123",
    });
    expect(set.webhook).toMatchObject({ authHeader: "x-api-key", hasAuthValue: true });
    await h.service.test("grok");
    expect(rec.sent[0]?.headers["x-api-key"]).toBe("k-123");
    const cleared = await h.service.setAuth({ name: "grok" });
    expect(cleared.webhook.authHeader).toBeUndefined();
    expect(cleared.webhook.hasAuthValue).toBe(false);
    await h.service.test("grok");
    expect(rec.sent[1]?.headers["x-api-key"]).toBeUndefined();
    await h.service.setAuth({ name: "grok", authHeader: "x-api-key", authValue: "k-456" });
    await h.service.delete("grok");
    expect(h.secrets.map.has("webhook-grok-auth")).toBe(false);
  });

  it("refuses a header on an inbound-only connector and reserved header names", async () => {
    const h = makeService({ dir: join(tmp, "auth3") });
    await expect(
      h.service.create({
        name: "grok",
        kind: "inbound",
        authHeader: "Authorization",
        authValue: "Bearer x",
      }),
    ).rejects.toMatchObject({ detail: { code: "WEBHOOK_AUTH_NOT_OUTBOUND" } });
    for (const name of ["Content-Type", "x-citegeist-signature", "Host", "bad name", "a:b"]) {
      const parsed = webhooksSetAuth.input.safeParse({
        name: "grok",
        authHeader: name,
        authValue: "v",
      });
      expect(parsed.success, name).toBe(false);
    }
    expect(
      webhooksCreate.input.safeParse({
        name: "grok",
        kind: "both",
        url: "https://a.example",
        authHeader: "Authorization",
      }).success,
    ).toBe(false);
    expect(
      webhooksSetAuth.input.safeParse({ name: "grok", authHeader: "x-k", authValue: "a\nb" })
        .success,
    ).toBe(false);
  });
});

describe("delivery retries", () => {
  function scripted(statuses: number[]) {
    let call = 0;
    const fn = (async () => {
      const status = statuses[Math.min(call, statuses.length - 1)] ?? 200;
      call += 1;
      return new Response(null, { status });
    }) as typeof fetch;
    return { fetch: fn, calls: () => call };
  }
  const make = (statuses: number[]) => {
    const waits: number[] = [];
    const f = scripted(statuses);
    const h = makeService({
      fetch: f.fetch,
      dir: join(tmp, "retry"),
      retryDelaysMs: [10, 20],
      sleep: async (ms) => {
        waits.push(ms);
      },
    });
    return { h, f, waits };
  };
  const input = { name: "grok", prompt: "x", briefChars: 0 };

  it("tries again with backoff when the answer is not 2xx", async () => {
    const { h, f, waits } = make([400, 503, 200]);
    await h.service.create({ name: "grok", kind: "both", url: "https://a.example/t" });
    const out = await h.service.send("human", input);
    expect(out.job).toBeTruthy();
    expect(f.calls()).toBe(3);
    expect(waits).toEqual([10, 20]);
  });

  it("fails the job after the last attempt and names the attempts", async () => {
    const { h, f } = make([400]);
    await h.service.create({ name: "grok", kind: "both", url: "https://a.example/t" });
    await expect(h.service.send("human", input)).rejects.toMatchObject({
      detail: { code: "WEBHOOK_DELIVERY_FAILED", message: expect.stringContaining("3 attempts") },
    });
    expect(f.calls()).toBe(3);
  });

  it("does not repeat a refused key", async () => {
    const { h, f, waits } = make([401]);
    await h.service.create({ name: "grok", kind: "both", url: "https://a.example/t" });
    await expect(h.service.send("human", input)).rejects.toMatchObject({
      detail: { code: "WEBHOOK_DELIVERY_FAILED", fix: expect.stringContaining("auth header") },
    });
    expect(f.calls()).toBe(1);
    expect(waits).toEqual([]);
  });
});

describe("inbound bearer token", () => {
  const post = (h: Harness, headers: Record<string, string>, body: unknown) =>
    h.service.handleInbound({
      method: "POST",
      path: "/hooks/grok",
      headers,
      rawBody: Buffer.from(JSON.stringify(body)),
    });

  async function withToken() {
    const h = makeService({ dir: join(tmp, "tok") });
    const created = await h.service.create({
      name: "grok",
      kind: "inbound",
      inboundToken: true,
    });
    return { h, token: created.inboundToken as string, secret: created.secret };
  }

  it("is off until the user turns it on", async () => {
    const h = makeService({ dir: join(tmp, "tok0") });
    await h.service.create({ name: "grok", kind: "inbound" });
    const res = await post(
      h,
      { authorization: "Bearer whtok_guess", [ID_HEADER]: "a" },
      { event: "ping" },
    );
    expect(res?.status).toBe(401);
  });

  it("accepts the token with an id from the header or the body", async () => {
    const { h, token } = await withToken();
    expect(token).toMatch(/^whtok_/);
    const viaHeader = await post(
      h,
      { authorization: `Bearer ${token}`, [ID_HEADER]: "d-1" },
      { event: "ping" },
    );
    expect(viaHeader?.status).toBe(200);
    const viaBody = await post(
      h,
      { authorization: `Bearer ${token}` },
      { event: "ping", id: "d-2" },
    );
    expect(viaBody?.status).toBe(200);
  });

  it("rejects a request without an id, a replayed id and a wrong token", async () => {
    const { h, token } = await withToken();
    const noId = await post(h, { authorization: `Bearer ${token}` }, { event: "ping" });
    expect(noId?.status).toBe(400);
    expect(noId?.body.error).toBe("missing id");
    const emptyId = await post(h, { authorization: `Bearer ${token}` }, { event: "ping", id: "" });
    expect(emptyId?.status).toBe(400);
    const first = await post(
      h,
      { authorization: `Bearer ${token}`, [ID_HEADER]: "same" },
      { event: "ping" },
    );
    expect(first?.status).toBe(200);
    const again = await post(
      h,
      { authorization: `Bearer ${token}`, [ID_HEADER]: "same" },
      { event: "ping" },
    );
    expect(again?.status).toBe(409);
    const wrong = await post(
      h,
      { authorization: "Bearer whtok_wrong", [ID_HEADER]: "x" },
      { event: "ping" },
    );
    expect(wrong?.status).toBe(401);
    const unknown = await h.service.handleInbound({
      method: "POST",
      path: "/hooks/nobody",
      headers: { authorization: `Bearer ${token}`, [ID_HEADER]: "y" },
      rawBody: Buffer.from("{}"),
    });
    expect(unknown?.status).toBe(401);
  });

  it("writes as the connector's actor, and HMAC keeps working next to it", async () => {
    const { h, token, secret } = await withToken();
    const res = await post(
      h,
      { authorization: `Bearer ${token}`, [ID_HEADER]: "p-1" },
      { event: "papers.add", papers: ["10.1000/x"] },
    );
    expect(res?.status).toBe(200);
    expect(h.calls.actors).toEqual(["agent:grok"]);
    const signed = await deliver(h, "grok", secret, { event: "ping" });
    expect(signed.status).toBe(200);
  });

  it("never lets the token stand in for a bad signature", async () => {
    const { h, token } = await withToken();
    const res = await post(
      h,
      {
        authorization: `Bearer ${token}`,
        [ID_HEADER]: "z",
        [SIGNATURE_HEADER]: "v1=00",
        [TIMESTAMP_HEADER]: "1",
      },
      { event: "ping" },
    );
    expect(res?.status).toBe(401);
  });

  it("is switched off and on again with a new token", async () => {
    const { h, token } = await withToken();
    const off = await h.service.setInboundToken({ name: "grok", enabled: false });
    expect(off.webhook.hasInboundToken).toBe(false);
    const refused = await post(
      h,
      { authorization: `Bearer ${token}`, [ID_HEADER]: "o-1" },
      { event: "ping" },
    );
    expect(refused?.status).toBe(401);
    const on = await h.service.setInboundToken({ name: "grok", enabled: true });
    expect(on.token).toBeTruthy();
    expect(on.token).not.toBe(token);
    expect(on.webhook.hasInboundToken).toBe(true);
  });
});

describe("MCP access of a connector", () => {
  it("issues a token once and recognises it, with the connector's actor and scope", async () => {
    const h = makeService({ dir: join(tmp, "mcp") });
    expect(h.service.hasMcpAccess()).toBe(false);
    const made = await h.service.create({
      name: "grok",
      kind: "both",
      url: "https://a.example/t",
      mcp: "write",
    });
    expect(made.mcpToken).toMatch(/^whmcp_/);
    expect(made.webhook.mcpScope).toBe("write");
    expect(h.service.hasMcpAccess()).toBe(true);
    const other = await h.service.create({ name: "reader", kind: "inbound" });
    expect(other.mcpToken).toBeUndefined();
    const read = await h.service.setMcpAccess({ name: "reader", enabled: true, scope: "read" });
    expect(await h.service.authenticateMcp(`Bearer ${made.mcpToken}`)).toEqual({
      actor: "agent:grok",
      scope: "write",
      name: "grok",
    });
    expect(await h.service.authenticateMcp(`Bearer ${read.token}`)).toMatchObject({
      actor: "agent:reader",
      scope: "read",
    });
    expect(await h.service.authenticateMcp("Bearer whmcp_wrong")).toBeUndefined();
    expect(await h.service.authenticateMcp(undefined)).toBeUndefined();
    expect(await h.service.authenticateMcp(`Basic ${made.mcpToken}`)).toBeUndefined();
    // the webhook secret is no MCP token
    expect(await h.service.authenticateMcp(`Bearer ${made.secret}`)).toBeUndefined();
  });

  it("loses the token when access is withdrawn or the connector is deleted", async () => {
    const h = makeService({ dir: join(tmp, "mcp2") });
    const made = await h.service.create({ name: "grok", kind: "inbound", mcp: "write" });
    const off = await h.service.setMcpAccess({ name: "grok", enabled: false, scope: "write" });
    expect(off.webhook.mcpScope).toBeUndefined();
    expect(await h.service.authenticateMcp(`Bearer ${made.mcpToken}`)).toBeUndefined();
    expect(h.service.hasMcpAccess()).toBe(false);
    const on = await h.service.setMcpAccess({ name: "grok", enabled: true, scope: "write" });
    await h.service.delete("grok");
    expect(await h.service.authenticateMcp(`Bearer ${on.token}`)).toBeUndefined();
    expect(h.secrets.map.has("webhook-grok-mcp")).toBe(false);
  });
});

describe("FailureLimiter", () => {
  it("turns a source away after its failures and lets it back when the window passes", () => {
    const limiter = new FailureLimiter(3, 100, 60_000);
    for (let i = 0; i < 3; i += 1) limiter.fail("a", 1000 + i);
    expect(limiter.retryAfter("a", 2000)).toBeGreaterThan(0);
    expect(limiter.retryAfter("b", 2000)).toBe(0);
    expect(limiter.retryAfter("a", 1000 + 59_999)).toBe(1);
    expect(limiter.retryAfter("a", 1000 + 60_001)).toBe(0);
  });

  it("has an overall budget against guessing from many addresses", () => {
    const limiter = new FailureLimiter(10, 3, 60_000);
    limiter.fail("a", 1);
    limiter.fail("b", 2);
    limiter.fail("c", 3);
    expect(limiter.retryAfter("d", 10)).toBeGreaterThan(0);
  });
});
