import { searchQuery } from "@citegeist/ops";
import { Link } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useOp } from "../lib/hooks";
import { Badge } from "./ui/badge";
import { EmptyState, ErrorState, Loading } from "./ui/states";

const KIND_LABELS = { item: "Item", card: "Card", note: "Note", block: "Text" } as const;

export function SearchScreen({ q }: { q: string }) {
  const query = q.trim();
  const results = useOp(searchQuery, { q: query, limit: 30 }, { enabled: query.length > 0 });

  return (
    <div className="mx-auto w-full max-w-3xl px-8 py-8">
      <h1 className="mb-6 font-serif text-2xl font-semibold">
        {query ? <>Results for &ldquo;{query}&rdquo;</> : "Search"}
      </h1>
      {query === "" ? (
        <EmptyState
          icon={<Search className="size-6" />}
          title="Search your library"
          description="Find items, quote cards, notes and passages from full texts."
        />
      ) : results.isPending ? (
        <Loading label="Searching" />
      ) : results.isError ? (
        <ErrorState error={results.error} />
      ) : results.data.hits.length === 0 ? (
        <EmptyState
          icon={<Search className="size-6" />}
          title="Nothing found"
          description={`No hits for "${query}". Try fewer or different words.`}
        />
      ) : (
        <ul className="flex flex-col divide-y divide-line/70">
          {results.data.hits.map((hit) => (
            <li key={`${hit.kind}:${hit.id}`} data-testid="hit" className="py-4">
              <div className="mb-1 flex items-center gap-2">
                <Badge>{KIND_LABELS[hit.kind]}</Badge>
                {hit.page ? <span className="text-xs text-muted">p. {hit.page}</span> : null}
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
