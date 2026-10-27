import { itemsFindFulltext } from "@citegeist/ops";
import { Search } from "lucide-react";
import { useState } from "react";
import type { z } from "zod";
import { useI18n } from "../i18n";
import { useOpMutation } from "../lib/hooks";
import { cn, describeError } from "../lib/utils";
import { Button } from "./ui/button";

type Found = z.output<typeof itemsFindFulltext.output>;
type Attempt = Found["tried"][number];

export type FindFulltextState =
  | { phase: "idle" }
  | { phase: "searching" }
  | { phase: "done"; result: Found }
  | { phase: "error"; message: string };

/**
 * "Volltext erneut suchen": runs the full text lookup for this one item, on request. The state
 * lives with the caller because the result outlasts the button: a file that is found removes the
 * "PDF anhängen" block the button sits in.
 */
export function useFindFulltext(citekey: string): {
  state: FindFulltextState;
  search: () => void;
} {
  const find = useOpMutation(itemsFindFulltext);
  const { t } = useI18n();
  // the state belongs to one item: another citekey starts without the last result
  const [held, setHeld] = useState<{ citekey: string; state: FindFulltextState }>({
    citekey,
    state: { phase: "idle" },
  });
  const put = (state: FindFulltextState) => setHeld({ citekey, state });
  const search = () => {
    put({ phase: "searching" });
    find.mutate(
      { citekey },
      {
        onSuccess: (result) => put({ phase: "done", result }),
        onError: (err) =>
          put({
            phase: "error",
            message: t("fulltext.failed", { message: describeError(err).message }),
          }),
      },
    );
  };
  return { state: held.citekey === citekey ? held.state : { phase: "idle" }, search };
}

export function FindFulltextButton({
  state,
  onSearch,
}: {
  state: FindFulltextState;
  onSearch: () => void;
}) {
  const { t } = useI18n();
  const searching = state.phase === "searching";
  return (
    <Button disabled={searching} onClick={onSearch}>
      <Search className="size-3.5" />
      {searching ? t("fulltext.finding") : t("fulltext.find")}
    </Button>
  );
}

/** A host such as "repo.example.org" for an address, the name of the source for a step without one. */
function attemptLabel(a: Attempt): string {
  if (a.url) {
    try {
      return new URL(a.url).hostname;
    } catch {
      return a.url;
    }
  }
  return (
    { unpaywall: "Unpaywall", openalex: "OpenAlex", arxiv: "arXiv", publisher: "Verlagsseite" }[
      a.source
    ] ?? a.source
  );
}

/** Progress while the search runs; afterwards the result, with the hosts that were checked. */
export function FindFulltextResult({ state }: { state: FindFulltextState }) {
  const { t } = useI18n();
  if (state.phase === "idle") return null;
  if (state.phase === "searching") {
    return (
      <p role="status" className="text-[12px] text-muted">
        {t("fulltext.searching")}
      </p>
    );
  }
  if (state.phase === "error") {
    return (
      <p role="alert" className="text-[12px] text-danger">
        {state.message}
      </p>
    );
  }
  const { result } = state;
  if (result.alreadyHadFile) {
    return (
      <p role="status" className="text-[12px] text-muted">
        {t("fulltext.alreadyHad")}
      </p>
    );
  }
  // one line per host; the strongest outcome of its attempts wins
  const rank = { ok: 2, failed: 1, none: 0 } as const;
  const hosts = new Map<string, Attempt["outcome"]>();
  for (const a of result.tried) {
    const label = attemptLabel(a);
    const known = hosts.get(label);
    if (known === undefined || rank[a.outcome] > rank[known]) hosts.set(label, a.outcome);
  }
  return (
    <div role="status" className="flex flex-col gap-1 text-[12px]">
      <p className={cn("font-medium", result.found ? "text-ink" : "text-muted")}>
        {result.found ? t("fulltext.found") : t("fulltext.notFound")}
      </p>
      {result.found ? <p className="text-muted">{t("fulltext.foundText")}</p> : null}
      {hosts.size > 0 ? (
        <details className="text-muted">
          <summary className="cursor-pointer select-none hover:text-ink">
            {t("fulltext.tried", { n: hosts.size })}
          </summary>
          <ul className="mt-1 flex flex-col gap-0.5 font-mono text-[11px]">
            {[...hosts].map(([host, outcome]) => (
              <li key={host}>
                {host} <span aria-hidden="true">·</span> {t(`fulltext.outcome.${outcome}`)}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
