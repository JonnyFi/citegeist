import {
  type LitsearchPaper,
  type LitsearchPreprint,
  type LitsearchRunMeta,
  type LitsearchStage,
  litsearchCancel,
  litsearchCompare,
  litsearchExport,
  litsearchGet,
  litsearchPreprints,
  litsearchPreprintsCheck,
  litsearchPreprintsImport,
  litsearchReport,
  litsearchResume,
  litsearchRuns,
  litsearchStart,
  litsearchSuggest,
  litsearchToInbox,
  type Registry,
} from "@citegeist/ops";
import type { CoreEvent } from "../lib/core";
import type { MockData } from "../mock/fixtures";

/** The 18 stages of pipeline.py, as its plan event lists them. */
export const MOCK_STAGES: ReadonlyArray<{ id: string; label: string }> = [
  { id: "search", label: "Search OpenAlex and arXiv" },
  { id: "resolve", label: "Resolve arXiv hits in OpenAlex" },
  { id: "filter", label: "Dedup, filter, relevance gate" },
  { id: "authors", label: "Author h-index (OpenAlex)" },
  { id: "orcid", label: "Merge split author profiles (ORCID)" },
  { id: "s2", label: "Semantic Scholar" },
  { id: "score", label: "Score" },
  { id: "dblp", label: "Venues and tracks (DBLP)" },
  { id: "openreview", label: "Review status (OpenReview)" },
  { id: "verify", label: "Verify DOIs" },
  { id: "snowball", label: "Snowballing" },
  { id: "snowball_authors", label: "Author h-index (snowball papers)" },
  { id: "snowball_orcid", label: "Merge split author profiles (snowball papers)" },
  { id: "snowball_s2", label: "Semantic Scholar (snowball papers)" },
  { id: "snowball_dblp", label: "DBLP (snowball papers)" },
  { id: "snowball_openreview", label: "OpenReview (snowball papers)" },
  { id: "snowball_verify", label: "Re-score and verify" },
  { id: "write", label: "Write outputs" },
];

function paper(
  over: Partial<LitsearchPaper> & Pick<LitsearchPaper, "key" | "title">,
): LitsearchPaper {
  return {
    section: "main",
    score: 50,
    scoreParts: { relevance: 15, venue: 15, author: 10, citations: 10 },
    why: "",
    foundVia: "query",
    authors: [],
    venue: "",
    type: "article",
    verified: true,
    abstract: "",
    summary: "",
    queries: [],
    status: "new",
    ...over,
  };
}

/** What a finished mock run found. */
export const MOCK_PAPERS: readonly LitsearchPaper[] = [
  paper({
    key: "W4400000001",
    rank: 1,
    score: 81.4,
    scoreParts: { relevance: 27, venue: 30, author: 12.4, citations: 12 },
    why: "Tier-1 venue, high relevance, FWCI 3.1",
    title: "A Survey of Agent Interoperability Protocols",
    authors: ["Ana Ruiz", "Tom Becker"],
    year: 2025,
    venue: "ACM Computing Surveys",
    venueTier: 1,
    doi: "10.1145/3700001",
    openalex: "W4400000001",
    citedBy: 120,
    citationsPerYear: 60,
    fwci: 3.1,
  }),
  paper({
    key: "W4200000002",
    rank: 2,
    score: 64,
    why: "found via snowballing, Tier-2 venue",
    foundVia: "snowballing (cited by W4400000001)",
    title: "Emergent Communication in Multi-Agent Reinforcement Learning",
    authors: ["Li Wei"],
    year: 2022,
    venue: "AAMAS",
    venueTier: 2,
    doi: "10.5555/3535850.3535900",
    citedBy: 45,
    citationsPerYear: 11.3,
  }),
  paper({
    key: "W4600000003",
    section: "preprint",
    rank: 1,
    score: 55.5,
    why: "not peer-reviewed, very high relevance",
    title: "LLM Agents Talking: A Benchmark",
    authors: ["Sam Okafor", "Ines Vogel", "Kai Lund"],
    year: 2026,
    venue: "arXiv",
    doi: "10.48550/arXiv.2601.01234",
    arxiv: "2601.01234",
  }),
  paper({
    key: "W4300000005",
    section: "rejected",
    score: 40,
    title: "Agent Communication, Revisited",
    authors: ["J. Doe"],
    year: 2023,
    venue: "Some Workshop",
    doi: "10.9999/fake.1",
    verified: false,
    rejectedReason: "DOI not found at Crossref or DataCite",
  }),
];

interface MockRun {
  meta: LitsearchRunMeta;
  /** Papers the alert's run found that its previous run lacked. */
  newKeys?: string[];
  /** What the run found; MOCK_PAPERS when absent. */
  papers?: readonly LitsearchPaper[];
  /** Stages finished so far; the next one is running while the run runs. */
  step: number;
  /** Stage that fails, for a run that hits the OpenAlex limit. */
  failAt?: number;
  timer?: ReturnType<typeof setTimeout>;
}

export interface LitsearchMockState {
  runs: Map<string, MockRun>;
  preprints: Map<string, LitsearchPreprint>;
  lastCheck?: string;
}

/** A finished run and one that failed at snowballing, so the list has something to show. */
export function createLitsearchMockState(): LitsearchMockState {
  const runs = new Map<string, MockRun>();
  runs.set("2026-10-20-agent-communication-protocols", {
    step: MOCK_STAGES.length,
    newKeys: ["W4400000001"],
    meta: {
      id: "2026-10-20-agent-communication-protocols",
      alert: "agent-communication-protocols",
      topic: "agent communication protocols",
      status: "done",
      queries: ['"agent communication protocol"', '"multi-agent communication" LLM'],
      since: 2022,
      created: "2026-10-20T10:12:00",
      finished: "2026-10-20T10:16:40",
      counts: { main: 2, preprint: 1, grey: 0, rejected: 1 },
      droppedQueries: [],
      attempts: 1,
    },
  });
  // an earlier run on the same topic, so "compare with" has something to show
  runs.set("2026-10-10-agent-communication-protocols", {
    step: MOCK_STAGES.length,
    papers: [
      { ...(MOCK_PAPERS[1] as LitsearchPaper), rank: 1 },
      paper({
        key: "W4100000007",
        rank: 2,
        score: 48,
        title: "Speech Acts for Software Agents, Revisited",
        authors: ["M. Klein"],
        year: 2021,
        venue: "AAMAS",
        venueTier: 2,
        doi: "10.5555/old.7",
      }),
    ],
    meta: {
      id: "2026-10-10-agent-communication-protocols",
      topic: "agent communication protocols",
      status: "done",
      queries: ['"agent communication protocol"'],
      created: "2026-10-10T09:30:00",
      finished: "2026-10-10T09:33:10",
      counts: { main: 2, preprint: 0, grey: 0, rejected: 0 },
      droppedQueries: [],
      attempts: 1,
    },
  });
  runs.set("2026-10-18-recursive-self-improvement", {
    step: 10,
    failAt: 10,
    meta: {
      id: "2026-10-18-recursive-self-improvement",
      topic: "recursive self-improvement",
      status: "failed",
      queries: ['"recursive self-improvement"', '"recursively self-improving"'],
      created: "2026-10-18T09:00:00",
      finished: "2026-10-18T09:02:31",
      counts: {},
      droppedQueries: [],
      attempts: 1,
      error:
        "RateLimited: Tageslimit von api.openalex.org erreicht, wieder frei in etwa 12 h. Mit einem kostenlosen OpenAlex-API-Key ist das Limit viel höher.",
    },
  });
  const preprints = new Map<string, LitsearchPreprint>([
    [
      "arxiv:2601.01234",
      {
        id: "arxiv:2601.01234",
        title: "LLM Agents Talking: A Benchmark",
        doi: "10.48550/arxiv.2601.01234",
        arxiv: "2601.01234",
        status: "preprint",
        from: ["run:2026-10-20-agent-communication-protocols"],
      },
    ],
    [
      "arxiv:2410.00042",
      {
        id: "arxiv:2410.00042",
        title: "Toolformer Agents in the Wild",
        doi: "10.48550/arxiv.2410.00042",
        arxiv: "2410.00042",
        status: "published",
        from: ["import:references.bib"],
        checked: "2026-10-23T08:00:00",
        published: { doi: "10.1145/3711111", venue: "ACM Computing Surveys", year: 2026 },
      },
    ],
  ]);
  return { runs, preprints, lastCheck: "2026-10-23T08:00:00" };
}

function stagesOf(run: MockRun): LitsearchStage[] {
  return MOCK_STAGES.map((s, i): LitsearchStage => {
    if (run.failAt === i) return { ...s, status: "failed" };
    if (i < run.step) return { ...s, status: "done", seconds: 1.2 };
    if (i === run.step && run.meta.status === "running") {
      return { ...s, status: "running", done: 1, total: 2, note: "records" };
    }
    return { ...s, status: "pending" };
  });
}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
/** A job id in the j_<ULID> form the contracts check. */
function mockJobId(): string {
  let out = "";
  for (let i = 0; i < 26; i++) out += CROCKFORD[Math.floor(Math.random() * 32)];
  return `j_0${out.slice(1)}`;
}

function slug(topic: string): string {
  return (
    topic
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "run"
  );
}

/**
 * The litsearch.* operations of the browser preview and the UI tests: a run steps through the
 * stages every `stepMs` and finishes with MOCK_PAPERS. A topic containing "limit" fails at
 * snowballing, like a run without an OpenAlex key.
 */
export function bindLitsearchMock(
  registry: Registry,
  state: LitsearchMockState,
  emit: (e: CoreEvent) => void,
  stepMs: number,
  data?: MockData,
): void {
  /** Marks a paper against the mock library by DOI, the way core matches. */
  const marked = (p: LitsearchPaper): LitsearchPaper => {
    const doi = p.doi?.toLowerCase();
    const hit = doi
      ? [...(data?.items.values() ?? [])].find((i) => i.frontmatter.DOI?.toLowerCase() === doi)
      : undefined;
    if (!hit) return { ...p, status: "new" };
    return {
      ...p,
      status: hit.frontmatter.inbox ? "inbox" : "library",
      citekey: hit.frontmatter.citekey,
    };
  };
  const changed = (id: string) =>
    emit({ type: "change", path: `research/runs/${id}/run.json`, external: false });
  const active = () => [...state.runs.values()].find((r) => r.meta.status === "running");
  const fail = (code: string, message: string) => new Error(`${code}: ${message}`);

  const tick = (run: MockRun) => {
    run.timer = setTimeout(() => {
      if (run.meta.status !== "running") return;
      if (run.failAt === run.step) {
        run.meta = {
          ...run.meta,
          status: "failed",
          finished: new Date().toISOString().slice(0, 19),
          error: "RateLimited: Tageslimit von api.openalex.org erreicht, wieder frei in etwa 12 h.",
        };
      } else {
        run.step += 1;
        if (run.step >= MOCK_STAGES.length) {
          run.meta = {
            ...run.meta,
            status: "done",
            finished: new Date().toISOString().slice(0, 19),
            counts: { main: 2, preprint: 1, grey: 0, rejected: 1 },
          };
          if (run.meta.alert) run.newKeys = ["W4400000001"];
        } else tick(run);
      }
      changed(run.meta.id);
    }, stepMs);
  };

  const begin = (run: MockRun) => {
    run.meta = { ...run.meta, status: "running", attempts: run.meta.attempts + 1 };
    delete run.meta.error;
    delete run.meta.finished;
    tick(run);
    changed(run.meta.id);
    return { runId: run.meta.id, job: mockJobId() };
  };

  registry
    .bind(litsearchSuggest, async (_ctx, input) => {
      await new Promise((r) => setTimeout(r, stepMs));
      const t = input.topic.toLowerCase();
      const base = t.includes("agent")
        ? [
            '"agent communication protocol"',
            '"multi-agent communication"',
            '"agent-to-agent" communication',
            '"LLM agents" interoperability',
          ]
        : [`"${input.topic}"`, `"${input.topic}" review`];
      return { queries: base.slice(0, input.maxQueries) };
    })
    .bind(litsearchStart, async (_ctx, input) => {
      const open = active();
      if (open)
        throw fail(
          "LITSEARCH_RUN_ACTIVE",
          `A literature search is already running (${open.meta.id}).`,
        );
      const base = `${new Date().toISOString().slice(0, 10)}-${slug(input.topic)}`;
      let id = base;
      for (let n = 2; state.runs.has(id); n++) id = `${base}-${n}`;
      const run: MockRun = {
        step: 0,
        ...(input.topic.toLowerCase().includes("limit") ? { failAt: 10 } : {}),
        meta: {
          id,
          topic: input.topic,
          status: "running",
          queries: input.queries,
          ...(input.since !== undefined ? { since: input.since } : {}),
          ...(input.top !== undefined ? { top: input.top } : {}),
          created: new Date().toISOString().slice(0, 19),
          counts: {},
          droppedQueries: [],
          attempts: 0,
        },
      };
      state.runs.set(id, run);
      return begin(run);
    })
    .bind(litsearchResume, async (_ctx, input) => {
      const run = state.runs.get(input.runId);
      if (!run) throw fail("LITSEARCH_RUN_NOT_FOUND", `There is no run "${input.runId}".`);
      if (run.meta.status === "done" || run.meta.status === "running") {
        throw fail("LITSEARCH_RUN_NOT_RESUMABLE", `Run "${input.runId}" is ${run.meta.status}.`);
      }
      const open = active();
      if (open)
        throw fail(
          "LITSEARCH_RUN_ACTIVE",
          `A literature search is already running (${open.meta.id}).`,
        );
      delete run.failAt;
      return begin(run);
    })
    .bind(litsearchCancel, async (_ctx, input) => {
      const run = state.runs.get(input.runId);
      if (run?.meta.status !== "running") {
        throw fail("LITSEARCH_RUN_NOT_RUNNING", `Run "${input.runId}" is not running.`);
      }
      if (run.timer) clearTimeout(run.timer);
      run.meta = {
        ...run.meta,
        status: "cancelled",
        finished: new Date().toISOString().slice(0, 19),
      };
      changed(run.meta.id);
      return { ok: true as const };
    })
    .bind(litsearchRuns, async (_ctx, input) => {
      const all = [...state.runs.values()]
        .map((r) => {
          const { droppedQueries: _d, attempts: _a, error: _e, ...summary } = r.meta;
          return summary;
        })
        .sort((a, b) => b.created.localeCompare(a.created));
      const start = input.cursor ? Number(input.cursor) : 0;
      const page = all.slice(start, start + input.limit);
      const end = start + page.length;
      return { runs: page, ...(end < all.length ? { next: String(end) } : {}) };
    })
    .bind(litsearchExport, async (_ctx, input) => {
      const run = state.runs.get(input.runId);
      if (run?.meta.status !== "done") {
        throw fail("LITSEARCH_OUTPUT_MISSING", `Run "${input.runId}" has no results.`);
      }
      const file = {
        md: "papers.md",
        csv: "papers.csv",
        bib: "references.bib",
        summaries: "summaries.md",
      }[input.format];
      const content =
        input.format === "csv"
          ? `section,rank,score,title\n${MOCK_PAPERS.map((p) => `${p.section},${p.rank ?? ""},${p.score},"${p.title}"`).join("\n")}\n`
          : MOCK_PAPERS.map((p) => `${p.rank ?? "-"}. ${p.title}`).join("\n");
      return {
        path: `research/runs/${input.runId}/${file}`,
        filename: `${input.runId}-${file}`,
        content,
      };
    })
    .bind(litsearchReport, async (_ctx, input) => {
      const run = state.runs.get(input.runId);
      if (run?.meta.status !== "done") {
        throw fail("LITSEARCH_OUTPUT_MISSING", `Run "${input.runId}" has no results.`);
      }
      return {
        path: `research/runs/${input.runId}/report.html`,
        filename: `${input.runId}-report.html`,
        html: `<!doctype html><title>${run.meta.topic}</title><h1>${run.meta.topic}</h1>`,
      };
    })
    .bind(litsearchToInbox, async (_ctx, input) => {
      const run = state.runs.get(input.runId);
      if (!run) throw fail("LITSEARCH_RUN_NOT_FOUND", `There is no run "${input.runId}".`);
      const results: Array<{
        key: string;
        identifier: string;
        status: "added" | "duplicate" | "failed";
        citekey?: string;
        job?: string;
        reason?: string;
      }> = [];
      for (const key of input.keys) {
        const p = MOCK_PAPERS.find((x) => x.key === key);
        const identifier = p?.doi ?? (p?.arxiv ? `arXiv:${p.arxiv}` : undefined);
        if (!p || !identifier) {
          results.push({ key, identifier: key, status: "failed" as const, reason: "no DOI" });
          continue;
        }
        const out = (await registry.call(
          "items.add",
          { actor: "system" },
          {
            identifier,
            target: "inbox",
            projects: input.projects,
            why: `Literatursuche „${run.meta.topic}“: Score ${p.score.toFixed(1)}`,
          },
        )) as { citekey: string; job: string; duplicateOf?: string };
        results.push({
          key,
          identifier,
          status: out.duplicateOf ? ("duplicate" as const) : ("added" as const),
          citekey: out.duplicateOf ?? out.citekey,
          job: out.job,
        });
      }
      const count = (s: string) => results.filter((r) => r.status === s).length;
      return {
        results,
        added: count("added"),
        duplicates: count("duplicate"),
        failed: count("failed"),
      };
    })
    .bind(litsearchCompare, async (_ctx, input) => {
      const of = (id: string) => {
        const run = state.runs.get(id);
        if (!run) throw fail("LITSEARCH_RUN_NOT_FOUND", `There is no run "${id}".`);
        return (run.papers ?? MOCK_PAPERS).filter((p) => p.section !== "rejected").map(marked);
      };
      const before = of(input.a);
      const after = of(input.b);
      const same = (x: LitsearchPaper, y: LitsearchPaper) =>
        (x.doi && x.doi === y.doi) || x.title.toLowerCase() === y.title.toLowerCase();
      return {
        added: after.filter((p) => !before.some((o) => same(o, p))),
        dropped: before.filter((p) => !after.some((o) => same(o, p))),
        moved: after.flatMap((p) => {
          const old = before.find((o) => same(o, p));
          return old?.rank && p.rank && old.rank !== p.rank && old.section === p.section
            ? [{ paper: p, from: old.rank, to: p.rank }]
            : [];
        }),
      };
    })
    .bind(litsearchPreprints, async () => {
      const all = [...state.preprints.values()];
      return {
        tracked: all.filter((p) => p.status !== "published"),
        published: all.filter((p) => p.status === "published"),
        ...(state.lastCheck ? { lastCheck: state.lastCheck } : {}),
      };
    })
    .bind(litsearchPreprintsImport, async (_ctx, input) => {
      const id = "arxiv:2602.00001";
      const added = state.preprints.has(id) ? 0 : 1;
      state.preprints.set(id, {
        id,
        title: "A Second Preprint",
        doi: "10.48550/arxiv.2602.00001",
        arxiv: "2602.00001",
        status: "preprint",
        from: [`import:${input.path.split("/").pop()}`],
      });
      return { added };
    })
    .bind(litsearchPreprintsCheck, async () => {
      setTimeout(() => {
        const p = state.preprints.get("arxiv:2601.01234");
        if (p) {
          state.preprints.set(p.id, {
            ...p,
            status: "published",
            published: { doi: "10.1145/3722222", venue: "TOSEM", year: 2026 },
          });
        }
        state.lastCheck = new Date().toISOString().slice(0, 19);
        emit({ type: "change", path: "research/watches/preprints.json", external: false });
      }, stepMs);
      return { job: mockJobId() };
    })
    .bind(litsearchGet, async (_ctx, input) => {
      const run = state.runs.get(input.runId);
      if (!run) throw fail("LITSEARCH_RUN_NOT_FOUND", `There is no run "${input.runId}".`);
      return {
        run: run.meta,
        stages: stagesOf(run),
        papers:
          run.meta.status === "done"
            ? (run.papers ?? MOCK_PAPERS).map((p) => ({
                ...marked(p),
                ...(run.newKeys?.includes(p.key) ? { newInAlert: true } : {}),
              }))
            : [],
      };
    });
}
