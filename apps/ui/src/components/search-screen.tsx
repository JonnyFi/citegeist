import { searchQuery } from "@citegeist/ops";
import { Link, useNavigate } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { highlightColor } from "../lib/cards";
import { useOp } from "../lib/hooks";
import { FOCUS_SEARCH_EVENT } from "../lib/search-focus";
import { SubBar } from "./layout";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { EmptyState, ErrorState, Loading } from "./ui/states";

export function SearchScreen({ q }: { q: string }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const query = q.trim();
  const results = useOp(searchQuery, { q: query, limit: 30 }, { enabled: query.length > 0 });
  const [value, setValue] = useState(q);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => setValue(q), [q]);
  useEffect(() => {
    ref.current?.focus();
    const focus = () => ref.current?.focus();
    window.addEventListener(FOCUS_SEARCH_EVENT, focus);
    return () => window.removeEventListener(FOCUS_SEARCH_EVENT, focus);
  }, []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next = value.trim();
    if (next) void navigate({ to: "/search", search: { q: next } });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <SubBar className="items-center">
        <search className="block flex-1">
          <form onSubmit={submit} className="flex items-center gap-4">
            <Input
              ref={ref}
              variant="line"
              type="search"
              aria-label={t("search.label")}
              placeholder={t("search.placeholder")}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="max-w-xl"
            />
            <Button type="submit" size="sm" variant="primary">
              {t("nav.search")}
            </Button>
          </form>
        </search>
      </SubBar>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-8 py-8">
          <h1 className="mb-6 font-serif text-[24px] font-medium leading-tight">
            {query ? t("search.resultsFor", { q: query }) : t("search.title")}
          </h1>
          {query === "" ? (
            <EmptyState
              icon={<Search />}
              title={t("search.emptyTitle")}
              description={t("search.emptyDescription")}
            />
          ) : results.isPending ? (
            <Loading label={t("search.loading")} />
          ) : results.isError ? (
            <ErrorState error={results.error} />
          ) : results.data.hits.length === 0 ? (
            <EmptyState
              icon={<Search />}
              title={t("search.noneTitle")}
              description={t("search.noneDescription", { q: query })}
            />
          ) : (
            <ul className="flex flex-col border-t border-line">
              {results.data.hits.map((hit) => (
                <li
                  key={`${hit.kind}:${hit.id}`}
                  data-testid="hit"
                  className="border-b border-line-soft py-4"
                >
                  <div className="mb-1 flex items-center gap-2">
                    <Badge>{t(`search.kind.${hit.kind}`)}</Badge>
                    {hit.color ? (
                      <span className="flex items-center gap-1.5 text-[12px] text-muted">
                        <span
                          aria-hidden="true"
                          className="size-2.5"
                          style={{ background: highlightColor(hit.color) }}
                        />
                        {t(`hl.color.${hit.color}`)}
                      </span>
                    ) : null}
                    {hit.page ? (
                      <span className="font-mono text-[12px] text-muted">
                        {t("search.page", { page: hit.page })}
                      </span>
                    ) : null}
                  </div>
                  {hit.citekey ? (
                    <Link
                      to="/items/$citekey"
                      params={{ citekey: hit.citekey }}
                      // a card opens in the reader at its passage
                      {...(hit.kind === "card"
                        ? { search: { tab: "read" as const, card: hit.id } }
                        : {})}
                      className="font-serif text-[18px] font-medium hover:underline"
                    >
                      {hit.title}
                    </Link>
                  ) : (
                    <span className="font-serif text-[18px] font-medium">{hit.title}</span>
                  )}
                  <p className="mt-1 text-muted">{hit.snippet}</p>
                  {hit.tags ? (
                    <p className="mt-1 font-mono text-[12px] text-muted">
                      {hit.tags.map((tag) => `#${tag}`).join(" ")}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
