import { type settingsGet, settingsUpdate } from "@citegeist/ops";
import { ArrowDown, ArrowUp } from "lucide-react";
import { useState } from "react";
import type { z } from "zod";
import { Button } from "../components/ui/button";
import { Select } from "../components/ui/select";
import { type MessageKey, useI18n } from "../i18n";
import { useOpMutation } from "../lib/hooks";
import { describeError } from "../lib/utils";
import { usePausedText } from "../onboarding/parts";

type SettingsData = z.output<typeof settingsGet.output>;
type BackendInfo = SettingsData["backends"][number];

/** Tasks that can name their own backend. Mirrors TASK_NAMES of @citegeist/ai. */
export const ROUTED_TASKS = [
  "card.paraphrase",
  "card.verify",
  "metadata.fromFirstPage",
  "note.proposeLinks",
  "concept.describe",
  "concept.name",
  "matrix.fillCell",
  "litsearch.suggestQueries",
] as const;

const INHERIT = "__inherit__";

/**
 * The model panel of the settings: the default backend of all AI tasks, an optional backend per
 * task, and the order in which the other backends take over when one reaches its limit. Only
 * backends that are installed and logged in, or have a key, can be picked.
 */
export function RoutingPanel({ data }: { data: SettingsData }) {
  const { t } = useI18n();
  const pausedText = usePausedText();
  const update = useOpMutation(settingsUpdate);
  const [error, setError] = useState<string>();

  const routing = data.settings.ai.routing;
  const available = data.backends.filter((b) => b.available);
  const labelOf = (id: string) => data.backends.find((b) => b.id === id)?.label ?? id;

  const save = async (patch: { routing?: Record<string, string>; fallback?: string[] }) => {
    setError(undefined);
    try {
      await update.mutateAsync({ patch: { ai: patch } });
    } catch (err) {
      const { message, fix } = describeError(err);
      setError(fix ? `${message} ${fix}` : message);
    }
  };

  /** Options for a select: the available backends, plus the current value when it dropped out. */
  const optionsFor = (current: string | undefined) => {
    const options = available.map((b) => ({ value: b.id, label: b.label }));
    if (current && !available.some((b) => b.id === current)) {
      options.push({
        value: current,
        label: t("settings.routing.unavailable", { name: labelOf(current) }),
      });
    }
    return options;
  };

  const defaultId = routing["*"] ?? "";

  // Fallback list. Backends that are not available stay in the stored list, but out of sight.
  const stored = data.settings.ai.fallback ?? [];
  const candidates = available.filter((b) => b.id !== defaultId);
  const candidateIds = new Set(candidates.map((b) => b.id));
  const active = stored.filter((id) => candidateIds.has(id));
  const hidden = stored.filter((id) => !candidateIds.has(id));
  const inactive = candidates.filter((b) => !active.includes(b.id));
  const saveFallback = (nextActive: string[]) => save({ fallback: [...nextActive, ...hidden] });
  const move = (id: string, by: -1 | 1) => {
    const from = active.indexOf(id);
    const to = from + by;
    if (from < 0 || to < 0 || to >= active.length) return;
    const next = [...active];
    next.splice(from, 1);
    next.splice(to, 0, id);
    void saveFallback(next);
  };
  const rows = [
    ...active.flatMap((id) => {
      const b = candidates.find((c) => c.id === id);
      return b ? [{ backend: b, on: true }] : [];
    }),
    ...inactive.map((b) => ({ backend: b, on: false })),
  ];

  if (available.length === 0) {
    return <p className="text-sm text-muted">{t("settings.routing.none")}</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <span>{t("settings.routing.default")}</span>
        <Select
          label={t("settings.routing.default")}
          value={defaultId}
          options={optionsFor(defaultId)}
          onChange={(id) => void save({ routing: { ...routing, "*": id } })}
        />
      </div>

      <details className="group">
        <summary className="cursor-pointer text-sm text-muted hover:text-ink">
          {t("settings.routing.perTask")}
        </summary>
        <div className="mt-2 flex flex-col gap-2">
          {ROUTED_TASKS.map((task) => {
            const label = t(`task.${task}` as MessageKey);
            return (
              <div key={task} className="flex items-center justify-between gap-4">
                <span>{label}</span>
                <Select
                  label={label}
                  value={routing[task] ?? INHERIT}
                  options={[
                    { value: INHERIT, label: t("settings.routing.inherit") },
                    ...optionsFor(routing[task]),
                  ]}
                  onChange={(id) => {
                    const next = { ...routing };
                    if (id === INHERIT) delete next[task];
                    else next[task] = id;
                    void save({ routing: next });
                  }}
                />
              </div>
            );
          })}
        </div>
      </details>

      <div className="flex flex-col gap-2">
        <div>
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.1em]">
            {t("settings.fallback.title")}
          </h3>
          <p className="text-sm text-muted">{t("settings.fallback.desc")}</p>
        </div>
        {rows.length === 0 ? (
          <p className="text-sm text-muted">{t("settings.fallback.none")}</p>
        ) : (
          <ul aria-label={t("settings.fallback.list")} className="flex flex-col">
            {rows.map(({ backend, on }, i) => {
              const paused = pausedText(backend);
              return (
                <li
                  key={backend.id}
                  data-testid="fallback-row"
                  data-backend={backend.id}
                  className="flex items-center gap-3 border-b border-line-soft py-1.5 last:border-b-0"
                >
                  <label className="flex min-w-0 flex-1 items-center gap-2">
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={update.isPending}
                      onChange={(e) =>
                        void saveFallback(
                          e.target.checked
                            ? [...active, backend.id]
                            : active.filter((id) => id !== backend.id),
                        )
                      }
                    />
                    <span className={on ? "" : "text-muted"}>{backend.label}</span>
                    {paused ? <span className="truncate text-sm text-muted">{paused}</span> : null}
                  </label>
                  {on ? (
                    <div className="flex shrink-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t("settings.fallback.up", { name: backend.label })}
                        disabled={i === 0 || update.isPending}
                        onClick={() => move(backend.id, -1)}
                      >
                        <ArrowUp className="size-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t("settings.fallback.down", { name: backend.label })}
                        disabled={i === active.length - 1 || update.isPending}
                        onClick={() => move(backend.id, 1)}
                      >
                        <ArrowDown className="size-3.5" />
                      </Button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
