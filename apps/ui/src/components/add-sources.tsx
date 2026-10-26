import { itemsList } from "@citegeist/ops";
import { useMemo, useState } from "react";
import { useI18n } from "../i18n";
import { useOp } from "../lib/hooks";
import { cn } from "../lib/utils";
import { useProjectMembership } from "./project-membership";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

/**
 * Search over the library to put sources into a project: title, author or citekey, several at
 * once. Sources the project has already are not listed.
 */
export function AddSources({ slug, onClose }: { slug: string; onClose: () => void }) {
  const { t } = useI18n();
  const library = useOp(itemsList, { inbox: false, limit: 500 });
  const inProject = useOp(itemsList, { inbox: false, project: slug, limit: 500 });
  const change = useProjectMembership();
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const available = useMemo(() => {
    const have = new Set((inProject.data?.items ?? []).map((i) => i.citekey));
    return (library.data?.items ?? []).filter((i) => !have.has(i.citekey));
  }, [library.data, inProject.data]);
  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    return available.filter(
      (i) =>
        q === "" ||
        [i.title, i.authors ?? "", i.citekey].some((field) => field.toLowerCase().includes(q)),
    );
  }, [available, query]);

  // a pick stays when the search narrows the list to something else
  const chosen = available.filter((i) => picked.has(i.citekey)).map((i) => i.citekey);
  const toggle = (citekey: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (!next.delete(citekey)) next.add(citekey);
      return next;
    });

  return (
    <section
      aria-label={t("membership.addSources")}
      className="flex flex-col gap-3 border-b border-line bg-sunken px-8 py-4"
    >
      <div className="flex items-center gap-3">
        <Input
          autoFocus
          aria-label={t("membership.search")}
          placeholder={t("membership.searchPlaceholder")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="max-w-[420px] bg-bg"
        />
        <span className="flex-1" />
        <Button
          variant="primary"
          size="sm"
          disabled={busy || chosen.length === 0}
          onClick={async () => {
            setBusy(true);
            const ok = await change("add", slug, chosen);
            setBusy(false);
            if (ok) {
              setPicked(new Set());
              onClose();
            }
          }}
        >
          {t("membership.addSelected", { n: chosen.length })}
        </Button>
        <Button variant="ghost" size="sm" onClick={onClose}>
          {t("membership.close")}
        </Button>
      </div>
      {candidates.length === 0 && !library.isPending ? (
        <p className="text-muted">{t("membership.noMatch")}</p>
      ) : (
        <ul className="max-h-[280px] overflow-y-auto border border-line bg-bg">
          {candidates.map((item) => (
            <li key={item.citekey} className="border-b border-line-soft last:border-b-0">
              <label
                className={cn(
                  "flex cursor-pointer items-baseline gap-3 px-3 py-2",
                  picked.has(item.citekey) && "bg-sunken",
                )}
              >
                <input
                  type="checkbox"
                  className="size-3.5 shrink-0 self-center"
                  aria-label={t("membership.selectRow", { title: item.title })}
                  checked={picked.has(item.citekey)}
                  onChange={() => toggle(item.citekey)}
                />
                <span className="min-w-0 truncate font-medium">{item.title}</span>
                <span className="shrink-0 text-muted">
                  {[item.authors, item.year].filter(Boolean).join(", ")}
                </span>
                <span className="ml-auto shrink-0 font-mono text-[11px] text-muted">
                  {item.citekey}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
