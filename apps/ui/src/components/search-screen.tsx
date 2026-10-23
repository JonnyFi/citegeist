import { searchQuery } from "@citegeist/ops";
import { Link } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useI18n } from "../i18n";
import { useOp } from "../lib/hooks";
import { Badge } from "./ui/badge";
import { EmptyState, ErrorState, Loading } from "./ui/states";

export function SearchScreen({ q }: { q: string }) {
  const { t } = useI18n();
  const query = q.trim();
  const results = useOp(searchQuery, { q: query, limit: 30 }, { enabled: query.length > 0 });

  return (
    <div className="mx-auto w-full max-w-3xl px-8 py-8">
      <h1 className="mb-6 font-serif text-2xl font-semibold">
        {query ? t("search.resultsFor", { q: query }) : t("search.title")}
      </h1>
      {query === "" ? (
        <EmptyState
          icon={<Search className="size-6" />}
          title={t("search.emptyTitle")}
          description={t("search.emptyDescription")}
        />
      ) : results.isPending ? (
        <Loading label={t("search.loading")} />
      ) : results.isError ? (
        <ErrorState error={results.error} />
      ) : results.data.hits.length === 0 ? (
        <EmptyState
          icon={<Search className="size-6" />}
          title={t("search.noneTitle")}
          description={t("search.noneDescription", { q: query })}
        />
      ) : (
        <ul className="flex flex-col divide-y divide-line/70">
          {results.data.hits.map((hit) => (
            <li key={`${hit.kind}:${hit.id}`} data-testid="hit" className="py-4">
              <div className="mb-1 flex items-center gap-2">
                <Badge>{t(`search.kind.${hit.kind}`)}</Badge>
                {hit.page ? (
                  <span className="text-xs text-muted">{t("search.page", { page: hit.page })}</span>
                ) : null}
              </div>
              {hit.citekey ? (
                <Link
                  to="/items/$citekey"
                  params={{ citekey: hit.citekey }}
                  className="font-serif text-lg font-medium hover:text-accent"
                >
                  {hit.title}
                </Link>
              ) : (
                <span className="font-serif text-lg font-medium">{hit.title}</span>
              )}
              <p className="mt-1 text-muted">{hit.snippet}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
