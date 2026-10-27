import {
  inboxAccept,
  inboxReject,
  itemsList,
  projectsAddItems,
  projectsList,
} from "@citegeist/ops";
import { Link } from "@tanstack/react-router";
import { Inbox } from "lucide-react";
import { useState } from "react";
import { useI18n } from "../i18n";
import { useCore, useOp, useOpMutation } from "../lib/hooks";
import { cn } from "../lib/utils";
import { FulltextMarker } from "./fulltext-marker";
import { HeaderSlot, SubBar } from "./layout";
import { Button, ButtonGroup } from "./ui/button";
import { Provenance } from "./ui/provenance";
import { Select } from "./ui/select";
import { EmptyState, ErrorState, Loading } from "./ui/states";

/** Items that agents added, with who added them and why. Single and bulk accept or reject. */
export function InboxScreen() {
  const i18n = useI18n();
  const { t, tn } = i18n;
  const list = useOp(itemsList, { inbox: true, limit: 200 });
  const core = useCore();
  const projects = useOp(projectsList, {});
  const accept = useOpMutation(inboxAccept);
  const reject = useOpMutation(inboxReject);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  // "none" is a choice too: without one, the project that all waiting items came with is offered
  const [project, setProject] = useState<string | undefined>(undefined);

  const items = list.data?.items ?? [];
  const chosen = items.filter((i) => selected.has(i.citekey)).map((i) => i.citekey);
  const allChosen = items.length > 0 && chosen.length === items.length;
  const busy = accept.isPending || reject.isPending;
  const [joinError, setJoinError] = useState<string | null>(null);
  const failure = accept.error ?? reject.error;

  const shared = items
    .map((i) => i.projects ?? [])
    .reduce<string[] | undefined>(
      (common, own) => (common ? common.filter((p) => own.includes(p)) : own),
      undefined,
    );
  const targetProject = project ?? (shared?.length === 1 ? shared[0] : undefined) ?? "none";
  const projectTitle = (slug: string) =>
    projects.data?.projects.find((p) => p.slug === slug)?.title ?? slug;

  const toggle = (citekey: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(citekey)) next.add(citekey);
      return next;
    });

  const run = (kind: "accept" | "reject", citekeys: string[]) => {
    if (citekeys.length === 0) return;
    setJoinError(null);
    const done = () =>
      setSelected((prev) => new Set([...prev].filter((k) => !citekeys.includes(k))));
    if (kind === "reject") {
      reject.mutate({ citekeys }, { onSuccess: done });
      return;
    }
    // the project goes first, so that an item that cannot join it stays in the inbox
    const join =
      targetProject === "none"
        ? Promise.resolve()
        : core.call(projectsAddItems, { slug: targetProject, citekeys }).then(() => undefined);
    join.then(
      () => accept.mutate({ citekeys }, { onSuccess: done }),
      (err) => setJoinError(err instanceof Error ? err.message : String(err)),
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <HeaderSlot>
        <h1 className="text-[13px] font-medium">{t("nav.inbox")}</h1>
        {items.length > 0 ? (
          <span className="font-mono text-[12px] text-muted">
            {tn("inbox.count", items.length)}
          </span>
        ) : null}
      </HeaderSlot>

      {list.isPending ? (
        <Loading label={t("items.loading")} />
      ) : list.isError ? (
        <ErrorState error={list.error} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Inbox />}
          title={t("inbox.emptyTitle")}
          description={t("inbox.emptyDescription")}
        />
      ) : (
        <>
          <SubBar className="items-center">
            <div className="flex items-center gap-4 text-[12px]">
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  className="size-3.5"
                  checked={allChosen}
                  onChange={() =>
                    setSelected(allChosen ? new Set() : new Set(items.map((i) => i.citekey)))
                  }
                />
                {t("inbox.selectAll")}
              </label>
              {chosen.length > 0 ? (
                <span className="text-muted">{tn("inbox.selectedCount", chosen.length)}</span>
              ) : null}
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 text-[12px]">
                <span className="text-muted">{t("membership.inboxProject")}</span>
                <Select
                  label={t("membership.inboxProject")}
                  value={targetProject}
                  active={targetProject !== "none"}
                  onChange={setProject}
                  options={[
                    { value: "none", label: t("membership.noProject") },
                    ...(projects.data?.projects ?? []).map((p) => ({
                      value: p.slug,
                      label: p.title,
                    })),
                  ]}
                />
              </div>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  run(
                    "accept",
                    items.map((i) => i.citekey),
                  )
                }
              >
                {t("inbox.acceptAll")}
              </Button>
              <ButtonGroup>
                <Button
                  variant="primary"
                  disabled={busy || chosen.length === 0}
                  onClick={() => run("accept", chosen)}
                >
                  {t("inbox.acceptSelected", { n: chosen.length })}
                </Button>
                <Button
                  disabled={busy || chosen.length === 0}
                  onClick={() => run("reject", chosen)}
                >
                  {t("inbox.rejectSelected", { n: chosen.length })}
                </Button>
              </ButtonGroup>
            </div>
          </SubBar>
          {failure || joinError ? (
            <p role="alert" className="border-b border-line px-8 py-2 text-danger">
              {joinError ?? failure?.message}
            </p>
          ) : null}
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {items.map((item) => {
              const inbox = item.inboxBy ? { by: item.inboxBy, why: item.inboxWhy } : undefined;
              const on = selected.has(item.citekey);
              return (
                <li
                  key={item.citekey}
                  data-testid="inbox-row"
                  className={cn(
                    "grid grid-cols-[24px_minmax(0,1fr)_auto] gap-4 border-b border-line px-8 py-5",
                    on && "bg-sunken",
                  )}
                >
                  <input
                    type="checkbox"
                    className="mt-1 size-3.5 self-start"
                    aria-label={t("inbox.select", { title: item.title })}
                    checked={on}
                    onChange={() => toggle(item.citekey)}
                  />
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <Link
                      to="/items/$citekey"
                      params={{ citekey: item.citekey }}
                      className="font-serif text-[20px] font-medium leading-tight hover:underline"
                    >
                      {item.title}
                    </Link>
                    <div className="text-muted">
                      {[item.authors, item.year].filter(Boolean).join(", ")}
                      <span className="ml-2 font-mono text-[12px]">{item.citekey}</span>
                      {item.fulltext === "missing" && !item.incomplete ? (
                        <span className="ml-3">
                          <FulltextMarker item={item} />
                        </span>
                      ) : null}
                    </div>
                    {item.projects ? (
                      <p className="text-[12px] text-muted">
                        {t("membership.inProject", {
                          project: item.projects.map(projectTitle).join(", "),
                        })}
                      </p>
                    ) : null}
                    {inbox ? (
                      <Provenance who={inbox.by === "human" ? t("actor.human") : inbox.by}>
                        {t("inbox.addedByLead")}
                      </Provenance>
                    ) : null}
                    {inbox?.why ? (
                      <p className="mt-1 max-w-[640px] leading-[1.5]">{inbox.why}</p>
                    ) : null}
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <ButtonGroup>
                      <Button
                        disabled={busy}
                        aria-label={t("inbox.acceptOne", { title: item.title })}
                        onClick={() => run("accept", [item.citekey])}
                      >
                        {t("inbox.accept")}
                      </Button>
                      <Button
                        disabled={busy}
                        aria-label={t("inbox.rejectOne", { title: item.title })}
                        onClick={() => run("reject", [item.citekey])}
                      >
                        {t("inbox.reject")}
                      </Button>
                    </ButtonGroup>
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
