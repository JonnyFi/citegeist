import { type Backlink, notesBacklinks } from "@citegeist/ops";
import { Link } from "@tanstack/react-router";
import { Badge } from "../components/ui/badge";
import { ErrorState } from "../components/ui/states";
import { type MessageKey, useI18n } from "../i18n";
import { useOp } from "../lib/hooks";

function BacklinkTitle({ link }: { link: Backlink }) {
  const className = "min-w-0 truncate font-medium hover:text-accent";
  if (link.kind === "note") {
    return (
      <Link to="/notes/$id" params={{ id: link.id }} className={className}>
        {link.title}
      </Link>
    );
  }
  if (link.kind === "item") {
    return (
      <Link
        to="/items/$citekey"
        params={{ citekey: link.citekey ?? link.id }}
        className={className}
      >
        {link.title}
      </Link>
    );
  }
  if (!link.citekey) return <span className="truncate">{link.title}</span>;
  return (
    <Link
      to="/items/$citekey"
      params={{ citekey: link.citekey }}
      search={{ tab: "read", card: link.id }}
      className={className}
    >
      {link.title}
    </Link>
  );
}

/** Everything that links to the open note, from the index. */
export function BacklinksPanel({ id }: { id: string }) {
  const { t, has } = useI18n();
  const backlinks = useOp(notesBacklinks, { id });

  return (
    <section aria-labelledby="backlinks-heading" className="mt-10">
      <h2
        id="backlinks-heading"
        className="mb-3 flex items-baseline gap-2 border-b border-line pb-1.5 text-xs font-medium uppercase tracking-wide text-muted"
      >
        {t("notes.backlinks")}
        {backlinks.data ? (
          <span className="tabular-nums">{backlinks.data.backlinks.length}</span>
        ) : null}
      </h2>
      {backlinks.isError ? (
        <ErrorState error={backlinks.error} />
      ) : backlinks.isPending ? (
        <p className="text-muted">{t("notes.backlinksLoading")}</p>
      ) : backlinks.data.backlinks.length === 0 ? (
        <p className="text-muted">{t("notes.backlinksEmpty")}</p>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="backlinks">
          {backlinks.data.backlinks.map((link) => {
            const relKey = `rel.${link.rel}`;
            return (
              <li
                key={`${link.kind}:${link.id}:${link.rel ?? ""}:${link.origin}`}
                className="flex items-center gap-2"
              >
                <Badge>{t(`search.kind.${link.kind}`)}</Badge>
                <BacklinkTitle link={link} />
                {link.rel ? (
                  <span className="text-xs text-muted">
                    {has(relKey) ? t(relKey as MessageKey) : link.rel}
                  </span>
                ) : null}
                {link.status === "proposed" ? (
                  <Badge tone="outline">{t("notes.backlinkProposed")}</Badge>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
