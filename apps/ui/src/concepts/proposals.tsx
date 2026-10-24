import {
  ConceptProposal,
  conceptsCreate,
  conceptsList,
  conceptsPropose,
  jobsGet,
} from "@citegeist/ops";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { ErrorState, Loading } from "../components/ui/states";
import { useI18n } from "../i18n";
import { useCore, useOp, useOpMutation } from "../lib/hooks";
import { describeError } from "../lib/utils";

const POLL_MS = 600;

const Result = z.object({ proposals: z.array(ConceptProposal) });

/** The proposals job: starts when the panel opens and lists what it found when it is done. */
export function Proposals({
  onClose,
  onOpen,
}: {
  onClose: () => void;
  onOpen: (id: string) => void;
}) {
  const { t, tn } = useI18n();
  const core = useCore();
  const [job, setJob] = useState<string>();
  const [failure, setFailure] = useState<unknown>();
  const [done, setDone] = useState<ReadonlyMap<string, string>>(new Map());
  const started = useRef(false);
  const create = useOpMutation(conceptsCreate);
  const concepts = useOp(conceptsList, { limit: 500 });

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    core.call(conceptsPropose, { limit: 30 }).then(
      (out) => setJob(out.job),
      (err: unknown) => setFailure(err),
    );
  }, [core]);

  const status = useOp(
    jobsGet,
    { job: job ?? "j_0000000000" },
    {
      enabled: job !== undefined,
      refetchInterval: (q) => {
        const s = q.state.data?.status;
        return s === "succeeded" || s === "failed" || s === "cancelled" ? false : POLL_MS;
      },
    },
  );

  const parsed =
    status.data?.status === "succeeded" ? Result.safeParse(status.data.result) : undefined;
  const failed =
    failure !== undefined || status.data?.status === "failed" || parsed?.success === false;

  return (
    <section
      aria-label={t("concepts.proposals.title")}
      className="flex max-w-[720px] flex-col gap-4 px-8 py-6"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-serif text-[20px] font-medium leading-tight">
          {t("concepts.proposals.title")}
        </h2>
        <Button size="sm" onClick={onClose}>
          {t("concepts.proposals.close")}
        </Button>
      </div>
      <p className="text-[12px] leading-[1.5] text-muted">{t("concepts.proposals.intro")}</p>
      {failure !== undefined ? <ErrorState error={failure} /> : null}
      {failed && failure === undefined ? (
        <p role="alert" className="text-danger">
          {t("concepts.proposals.failed")}
          {status.data?.error?.message ? ` ${status.data.error.message}` : ""}
        </p>
      ) : null}
      {!failed && parsed === undefined ? (
        <Loading label={t("concepts.proposals.searching")} />
      ) : null}
      {parsed?.success ? (
        parsed.data.proposals.length === 0 ? (
          <p className="text-muted">{t("concepts.proposals.none")}</p>
        ) : (
          <ul aria-label={t("concepts.proposals.list")} className="flex flex-col gap-2">
            {parsed.data.proposals.map((p) => {
              const key = `${p.origin}:${p.term}`;
              const existing = p.existing
                ? concepts.data?.concepts.find((c) => c.id === p.existing)
                : undefined;
              return (
                <li
                  key={key}
                  data-testid="proposal"
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 border border-line-faint px-3 py-2"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{p.term}</span>
                    <span className="flex flex-wrap items-center gap-x-2 text-[11px] text-muted">
                      <Badge>
                        {t(
                          p.origin === "definition"
                            ? "concepts.proposals.definition"
                            : "concepts.proposals.recurring",
                        )}
                      </Badge>
                      <span>{tn("concepts.sources", p.sources.length)}</span>
                      <span>{tn("concepts.cards", p.cards.length)}</span>
                      {p.aliases.length > 0 ? <span>{p.aliases.join(", ")}</span> : null}
                    </span>
                  </span>
                  {done.has(key) ? (
                    <span className="flex items-center gap-2">
                      <span className="text-[12px] text-muted">{t("concepts.proposals.done")}</span>
                      <Button size="sm" onClick={() => onOpen(done.get(key) ?? "")}>
                        {t("concepts.proposals.open")}
                      </Button>
                    </span>
                  ) : (
                    <Button
                      size="sm"
                      disabled={create.isPending}
                      aria-label={t("concepts.proposals.acceptLabel", { term: p.term })}
                      onClick={() =>
                        create.mutate(
                          { term: p.term, aliases: p.aliases, cards: p.cards },
                          {
                            onSuccess: (out) => setDone((d) => new Map(d).set(key, out.concept.id)),
                          },
                        )
                      }
                    >
                      {existing
                        ? t("concepts.proposals.extend", { title: existing.title })
                        : t("concepts.proposals.accept")}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )
      ) : null}
      {create.isError ? (
        <p role="alert" className="text-danger">
          {describeError(create.error, t("concepts.problem")).message}
        </p>
      ) : null}
    </section>
  );
}
