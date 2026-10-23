import { inboxAccept, inboxReject, itemsGet, itemsList } from "@citegeist/ops";
import { useQueries } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Bot, Check, Inbox, User, X } from "lucide-react";
import { useState } from "react";
import { type Translator, useI18n } from "../i18n";
import { useCore, useOp, useOpMutation } from "../lib/hooks";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { EmptyState, ErrorState, Loading } from "./ui/states";

/** Who added an item: "human", "system" or "agent:<name>". */
export function actorLabel({ t }: Translator, by: string): string {
  if (by === "human") return t("actor.human");
  if (by === "system") return t("actor.system");
  return by.replace(/^agent:/, "");
}

/** Items that agents added, with who added them and why. Single and bulk accept or reject. */
export function InboxScreen() {
  const i18n = useI18n();
  const { t, tn } = i18n;
  const core = useCore();
  const list = useOp(itemsList, { inbox: true, limit: 200 });
  const accept = useOpMutation(inboxAccept);
  const reject = useOpMutation(inboxReject);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  const items = list.data?.items ?? [];
  // items.list carries only the inbox flag; who and why come from the item itself
  const details = useQueries({
    queries: items.map((item) => ({
      queryKey: ["op", itemsGet.name, { citekey: item.citekey }],
      queryFn: () => core.call(itemsGet, { citekey: item.citekey }),
    })),
  });

  const chosen = items.filter((i) => selected.has(i.citekey)).map((i) => i.citekey);
  const allChosen = items.length > 0 && chosen.length === items.length;
  const busy = accept.isPending || reject.isPending;
  const failure = accept.error ?? reject.error;

  const toggle = (citekey: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(citekey)) next.add(citekey);
      return next;
    });

  const run = (kind: "accept" | "reject", citekeys: string[]) => {
    if (citekeys.length === 0) return;
    const done = () =>
      setSelected((prev) => new Set([...prev].filter((k) => !citekeys.includes(k))));
    (kind === "accept" ? accept : reject).mutate({ citekeys }, { onSuccess: done });
  };

  return (
    <div className="mx-auto w-full max-w-4xl px-8 py-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <h1 className="font-serif text-2xl font-semibold">{t("nav.inbox")}</h1>
        {items.length > 0 ? (
          <span className="text-muted">{tn("inbox.count", items.length)}</span>
        ) : null}
      </header>

      {list.isPending ? (
        <Loading label={t("items.loading")} />
      ) : list.isError ? (
        <ErrorState error={list.error} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Inbox className="size-6" />}
          title={t("inbox.emptyTitle")}
          description={t("inbox.emptyDescription")}
        />
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-3 border-b border-line pb-3">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={allChosen}
                onChange={() =>
                  setSelected(allChosen ? new Set() : new Set(items.map((i) => i.citekey)))
                }
              />
              {t("inbox.selectAll")}
            </label>
            <Button
              size="sm"
              variant="primary"
              disabled={busy || chosen.length === 0}
              onClick={() => run("accept", chosen)}
            >
              {t("inbox.acceptSelected", { n: chosen.length })}
            </Button>
            <Button
              size="sm"
              disabled={busy || chosen.length === 0}
              onClick={() => run("reject", chosen)}
            >
              {t("inbox.rejectSelected", { n: chosen.length })}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              className="ml-auto"
              onClick={() =>
                run(
                  "accept",
                  items.map((i) => i.citekey),
                )
              }
            >
              {t("inbox.acceptAll")}
            </Button>
          </div>
          {failure ? (
            <p role="alert" className="mb-3 text-danger">
              {failure.message}
            </p>
          ) : null}
          <ul className="flex flex-col divide-y divide-line/70">
            {items.map((item, index) => {
              const inbox = details[index]?.data?.frontmatter.inbox;
              return (
                <li key={item.citekey} data-testid="inbox-row" className="flex gap-3 py-4">
                  <input
                    type="checkbox"
                    className="mt-1.5 self-start"
                    aria-label={t("inbox.select", { title: item.title })}
                    checked={selected.has(item.citekey)}
                    onChange={() => toggle(item.citekey)}
                  />
                  <div className="min-w-0 flex-1">
                    <Link
                      to="/items/$citekey"
                      params={{ citekey: item.citekey }}
                      className="font-serif text-[15px] font-medium hover:text-accent"
                    >
                      {item.title}
                    </Link>
                    <div className="mt-0.5 text-muted">
                      {[item.authors, item.year].filter(Boolean).join(", ")}
                      <span className="ml-2 font-mono text-xs">{item.citekey}</span>
                    </div>
                    {inbox ? (
                      <div className="mt-2 flex flex-wrap items-start gap-2">
                        <Badge tone="outline" className="gap-1">
                          {inbox.by === "human" ? (
                            <User className="size-3" />
                          ) : (
                            <Bot className="size-3" />
                          )}
                          {t("inbox.addedBy", { who: actorLabel(i18n, inbox.by) })}
                        </Badge>
                        {inbox.why ? (
                          <p className="rounded-md bg-accent-soft px-2.5 py-1 text-accent">
                            {inbox.why}
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-start gap-1.5">
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={busy}
                      aria-label={t("inbox.acceptOne", { title: item.title })}
                      onClick={() => run("accept", [item.citekey])}
                    >
                      <Check className="size-3.5" />
                      {t("inbox.accept")}
                    </Button>
                    <Button
                      size="sm"
                      disabled={busy}
                      aria-label={t("inbox.rejectOne", { title: item.title })}
                      onClick={() => run("reject", [item.citekey])}
                    >
                      <X className="size-3.5" />
                      {t("inbox.reject")}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
