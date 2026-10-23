import { cardsList, itemsGet } from "@citegeist/ops";
import { Link } from "@tanstack/react-router";
import { ExternalLink, FileText, Quote } from "lucide-react";
import { creatorName, statusLabel, typeLabel } from "../lib/format";
import { useOp } from "../lib/hooks";
import { CardList } from "./card-list";
import { Prose } from "./prose";
import { Badge } from "./ui/badge";
import { EmptyState, ErrorState, Loading } from "./ui/states";

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-10">
      <h2 className="mb-3 flex items-baseline gap-2 border-b border-line pb-1.5 text-xs font-medium uppercase tracking-wide text-muted">
        {title}
        {count !== undefined ? <span className="tabular-nums">{count}</span> : null}
      </h2>
      {children}
    </section>
  );
}

/** One item: metadata, literature note and its quote cards. */
export function ItemView({ citekey }: { citekey: string }) {
  const item = useOp(itemsGet, { citekey });
  const cards = useOp(cardsList, { citekey, limit: 200 });

  if (item.isPending) return <Loading label="Loading item" />;
  if (item.isError) return <ErrorState error={item.error} />;

  const { frontmatter: fm, note } = item.data;
  const authors = (fm.author ?? []).map(creatorName);
  const meta: Array<[string, string | undefined]> = [
    ["Type", typeLabel(fm.type)],
    ["Published in", fm["container-title"]],
    ["Publisher", fm.publisher],
    ["Volume", fm.volume],
    ["Issue", fm.issue],
    ["Pages", fm.page],
    ["DOI", fm.DOI],
    ["ISBN", fm.ISBN],
    ["Language", fm.language],
    ["Citekey", fm.citekey],
  ];

  return (
    <article className="mx-auto w-full max-w-3xl px-8 py-10">
      <header>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Badge tone={fm.status === "reading" ? "accent" : "neutral"}>
            {statusLabel(fm.status)}
          </Badge>
          {fm.inbox ? <Badge tone="outline">Inbox</Badge> : null}
          {fm.projects.map((slug) => (
            <Link key={slug} to="/projects/$slug" params={{ slug }}>
              <Badge tone="outline" className="hover:text-ink">
                {slug}
              </Badge>
            </Link>
          ))}
        </div>
        <h1 className="font-serif text-3xl font-semibold leading-tight">{fm.title}</h1>
        {fm.subtitle ? <p className="mt-1 font-serif text-lg text-muted">{fm.subtitle}</p> : null}
        <p className="mt-3 text-base">
          {authors.length > 0 ? authors.join("; ") : "Unknown author"}
          {fm.issued !== undefined ? (
            <span className="text-muted"> ({String(fm.issued)})</span>
          ) : null}
        </p>
        {fm.inbox?.why ? (
          <p className="mt-3 rounded-md bg-accent-soft px-3 py-2 text-accent">
            Suggested by {fm.inbox.by}: {fm.inbox.why}
          </p>
        ) : null}
      </header>

      {fm.abstract ? (
        <Section title="Abstract">
          <p className="prose-read">{fm.abstract}</p>
        </Section>
      ) : null}

      <Section title="Metadata">
        <dl className="grid grid-cols-[8rem_1fr] gap-x-4 gap-y-1.5">
          {meta
            .filter((row): row is [string, string] => Boolean(row[1]))
            .map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-muted">{label}</dt>
                <dd className="min-w-0 break-words">{value}</dd>
              </div>
            ))}
          {fm.URL ? (
            <div className="contents">
              <dt className="text-muted">URL</dt>
              <dd className="min-w-0 break-all">
                <a
                  href={fm.URL}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-accent"
                >
                  {fm.URL}
                  <ExternalLink className="size-3" />
                </a>
              </dd>
            </div>
          ) : null}
          {fm.tags.length > 0 ? (
            <div className="contents">
              <dt className="text-muted">Tags</dt>
              <dd className="flex flex-wrap gap-1.5">
                {fm.tags.map((t) => (
                  <Badge key={t}>{t}</Badge>
                ))}
              </dd>
            </div>
          ) : null}
        </dl>
        {fm.sources.length > 0 ? (
          <ul className="mt-3 flex flex-col gap-1">
            {fm.sources.map((s) => (
              <li key={s.hash} className="flex items-center gap-2 text-muted">
                <FileText className="size-3.5" />
                {s.filename}
                {s.pages ? <span>({s.pages} pages)</span> : null}
              </li>
            ))}
          </ul>
        ) : null}
      </Section>

      <Section title="Literature note">
        {note.trim() ? (
          <Prose text={note} />
        ) : (
          <p className="text-muted">No literature note yet.</p>
        )}
      </Section>

      <Section title="Cards" count={cards.data?.cards.length ?? item.data.cards}>
        {cards.isPending ? (
          <Loading label="Loading cards" />
        ) : cards.isError ? (
          <ErrorState error={cards.error} />
        ) : cards.data.cards.length === 0 ? (
          <EmptyState
            icon={<Quote className="size-5" />}
            title="No cards yet"
            description="Highlight a passage while reading to save it as a quote card."
          />
        ) : (
          <CardList cards={cards.data.cards} />
        )}
      </Section>
    </article>
  );
}
