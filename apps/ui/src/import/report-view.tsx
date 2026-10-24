import type { ImportProblem, ImportReport, ImportResult } from "@citegeist/ops";
import type { z } from "zod";
import { Stamp } from "../components/ui/badge";
import { type MessageKey, useI18n } from "../i18n";
import { Section } from "../settings/parts";

type Report = z.output<typeof ImportReport>;
type Result = z.output<typeof ImportResult>;
type Problem = z.output<typeof ImportProblem>;

const COUNTS = [
  "items",
  "create",
  "merge",
  "skip",
  "attachments",
  "attachmentsMissing",
  "notes",
  "annotations",
  "annotationsSkipped",
  "collections",
  "tags",
  "projects",
] as const;

/** A grid of numbers with 1px rules between the cells; zeros are muted. */
function Numbers({
  cells,
}: {
  cells: ReadonlyArray<{ key: string; label: string; value: number }>;
}) {
  return (
    <dl className="grid grid-cols-2 gap-px border border-line bg-line-soft sm:grid-cols-4">
      {cells.map((c) => (
        <div key={c.key} data-testid={`count-${c.key}`} className="bg-surface px-3 py-2">
          <dd className={c.value === 0 ? "font-mono text-lg text-muted" : "font-mono text-lg"}>
            {c.value}
          </dd>
          <dt className="text-[12px] text-muted">{c.label}</dt>
        </div>
      ))}
    </dl>
  );
}

function ProblemList({ problems, total }: { problems: readonly Problem[]; total: number }) {
  const { t } = useI18n();
  if (total === 0) return <p className="text-muted">{t("import.problems.none")}</p>;
  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col">
        {problems.map((p) => (
          <li
            key={`${p.code}-${p.ref ?? ""}-${p.message}`}
            data-testid="problem"
            className="flex items-baseline gap-3 border-b border-line-soft py-1.5 last:border-b-0"
          >
            <Stamp tone={p.severity === "error" ? "danger" : "ink"}>
              {t(`import.severity.${p.severity}` as MessageKey)}
            </Stamp>
            <span className="min-w-0 flex-1">{p.message}</span>
            {p.ref ? <span className="font-mono text-[12px] text-muted">{p.ref}</span> : null}
          </li>
        ))}
      </ul>
      {total > problems.length ? (
        <p className="text-sm text-muted">
          {t("import.problems.more", { n: total - problems.length })}
        </p>
      ) : null}
    </div>
  );
}

/** Dry-run report: counts, duplicates, the first entries and the problems. */
export function ReportView({ report }: { report: Report }) {
  const { t } = useI18n();
  const duplicates = report.items.filter((i) => i.duplicateOf !== undefined);
  const dupCount = report.counts.merge + report.counts.skip;
  return (
    <div data-testid="import-report" className="flex flex-col gap-6">
      <Section id="import-report" title={t("import.report.title")}>
        <dl className="text-sm">
          <div className="flex gap-3">
            <dt className="w-32 shrink-0 text-muted">{t("import.report.source")}</dt>
            <dd className="min-w-0 break-all font-mono text-[12px]">{report.source}</dd>
          </div>
          <div className="flex gap-3">
            <dt className="w-32 shrink-0 text-muted">{t("import.report.provenance")}</dt>
            <dd className="font-mono text-[12px]">{report.provenance}</dd>
          </div>
        </dl>
        <Numbers
          cells={COUNTS.map((key) => ({
            key,
            label: t(`import.count.${key}` as MessageKey),
            value: report.counts[key],
          }))}
        />
      </Section>

      <Section id="import-dupes" title={`${t("import.dupes.title")} (${dupCount})`}>
        {duplicates.length === 0 ? (
          <p className="text-muted">{t("import.dupes.none")}</p>
        ) : (
          <ul className="flex flex-col">
            {duplicates.map((i) => (
              <li
                key={i.ref}
                data-testid="duplicate"
                className="flex items-baseline gap-3 border-b border-line-soft py-1.5 last:border-b-0"
              >
                <span className="min-w-0 flex-1">{i.title}</span>
                <span className="font-mono text-[12px] text-muted">
                  {t("import.dupes.of", { citekey: i.duplicateOf ?? "" })}
                </span>
                {i.reason ? (
                  <span className="text-[12px] text-muted">
                    {t(`import.reason.${i.reason}` as MessageKey)}
                  </span>
                ) : null}
                <Stamp>{t(`import.action.${i.action}` as MessageKey)}</Stamp>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section id="import-items" title={t("import.items.title")}>
        <ul className="flex flex-col">
          {report.items.map((i) => (
            <li
              key={i.ref}
              data-testid="import-entry"
              className="flex items-baseline gap-3 border-b border-line-soft py-1.5 last:border-b-0"
            >
              <span className="min-w-0 flex-1 truncate">{i.title}</span>
              <span className="font-mono text-[12px] text-muted">{i.citekey}</span>
              <span className="w-28 text-right text-[12px] text-muted">
                {t(`import.action.${i.action}` as MessageKey)}
              </span>
            </li>
          ))}
        </ul>
        {report.truncated ? <p className="text-sm text-muted">{t("import.truncated")}</p> : null}
      </Section>

      <Section
        id="import-problems"
        title={`${t("import.problems.title")} (${report.problemCount})`}
      >
        <ProblemList problems={report.problems} total={report.problemCount} />
      </Section>
    </div>
  );
}

/** Summary of a finished import job. */
export function ResultView({ result }: { result: Result }) {
  const { t } = useI18n();
  return (
    <div data-testid="import-result" className="flex flex-col gap-4">
      <Numbers
        cells={[
          { key: "created", label: t("import.result.created"), value: result.created.length },
          { key: "merged", label: t("import.result.merged"), value: result.merged.length },
          { key: "skipped", label: t("import.result.skipped"), value: result.skipped },
          { key: "attachments", label: t("import.result.attachments"), value: result.attachments },
          { key: "notes", label: t("import.result.notes"), value: result.notes },
          { key: "cards", label: t("import.result.cards"), value: result.cards },
          { key: "projects", label: t("import.result.projects"), value: result.projects.length },
        ]}
      />
      <p className="font-mono text-[12px] text-muted">{result.provenance}</p>
      <ProblemList problems={result.problems} total={result.problemCount} />
    </div>
  );
}
