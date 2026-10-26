import { settingsGet, settingsUpdate } from "@citegeist/ops";
import { Library } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import type { CitegeistBridge } from "../bridge";
import { Button } from "../components/ui/button";
import { Segmented } from "../components/ui/segmented";
import { ErrorState, Loading } from "../components/ui/states";
import { type Lang, useI18n } from "../i18n";
import { useCore, useOp, useOpMutation } from "../lib/hooks";
import { BackendRow, useBackendTests, WorkerPanel } from "./parts";

const DONE_KEY = "citegeist.onboarding";
const STEPS = ["library", "backend", "worker"] as const;
type Step = (typeof STEPS)[number];
const LANGS = [
  { value: "de", label: "Deutsch" },
  { value: "en", label: "English" },
] as const;

export function isOnboardingDone(): boolean {
  try {
    return localStorage.getItem(DONE_KEY) === "done";
  } catch {
    return true;
  }
}

export function markOnboardingDone(): void {
  try {
    localStorage.setItem(DONE_KEY, "done");
  } catch {
    // storage unavailable, the setup shows again on the next start
  }
}

export function resetOnboarding(): void {
  try {
    localStorage.removeItem(DONE_KEY);
  } catch {
    // nothing stored
  }
}

function Frame({
  onLang,
  step,
  children,
}: {
  onLang: (lang: Lang) => void;
  step: Step;
  children: ReactNode;
}) {
  const { lang, t } = useI18n();
  return (
    <div className="drag-region flex h-full items-center justify-center overflow-y-auto px-6 py-10">
      <div className="no-drag flex w-full max-w-xl flex-col gap-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="font-serif text-2xl font-semibold">{t("onb.title")}</h1>
            <p className="text-muted">
              {t("onb.step", { n: STEPS.indexOf(step) + 1, total: STEPS.length })}
            </p>
          </div>
          <Segmented<Lang> label={t("lang.label")} value={lang} options={LANGS} onChange={onLang} />
        </div>
        <h2 className="font-serif text-lg font-semibold">{t(`onb.step.${step}`)}</h2>
        {children}
      </div>
    </div>
  );
}

/**
 * First step, shown while no library is open: create or open one. The window reloads once a
 * library is chosen, and the flow continues with the AI backend inside `OnboardingGate`.
 */
export function FirstRunLibrary({
  bridge,
  onSkip,
}: {
  bridge: CitegeistBridge;
  onSkip: () => void;
}) {
  const { t, setLang } = useI18n();
  return (
    <Frame onLang={setLang} step="library">
      <div className="flex items-start gap-3">
        <Library className="mt-0.5 size-5 shrink-0 text-muted" />
        <p>{t("onb.library.desc")}</p>
      </div>
      <div className="flex gap-2">
        <Button variant="primary" onClick={() => void bridge.createLibrary()}>
          {t("onb.library.create")}
        </Button>
        <Button onClick={() => void bridge.openLibrary()}>{t("onb.library.open")}</Button>
        <Button variant="ghost" onClick={onSkip}>
          {t("onb.library.later")}
        </Button>
      </div>
    </Frame>
  );
}

/** Shows `FirstRunLibrary` until the setup is done or skipped, then the fallback (the welcome screen). */
export function FirstRun({ bridge, fallback }: { bridge: CitegeistBridge; fallback: ReactNode }) {
  const [done, setDone] = useState(isOnboardingDone);
  if (done) return fallback;
  return (
    <FirstRunLibrary
      bridge={bridge}
      onSkip={() => {
        markOnboardingDone();
        setDone(true);
      }}
    />
  );
}

/** Steps two and three: pick a backend and test it, install the worker. Needs the core provider. */
export function OnboardingFlow({ onDone }: { onDone: () => void }) {
  const { t, setLang } = useI18n();
  const query = useOp(settingsGet, {});
  const update = useOpMutation(settingsUpdate);
  const { tests, run } = useBackendTests();
  const [step, setStep] = useState<Step>("backend");

  const onLang = (next: Lang) => {
    setLang(next);
    void update.mutateAsync({ patch: { uiLanguage: next } });
  };

  if (query.isPending) return <Loading />;
  if (query.isError) return <ErrorState error={query.error} />;
  const { settings, backends, worker } = query.data;
  const selected = settings.ai.routing["*"];
  const selectedOk = selected !== undefined && tests[selected]?.status === "ok";

  return (
    <Frame onLang={onLang} step={step}>
      {step === "backend" ? (
        <>
          <p>{t("onb.backend.desc")}</p>
          <ul className="flex flex-col gap-2">
            {backends.map((b) => (
              <BackendRow
                key={b.id}
                backend={b}
                test={tests[b.id]}
                onTest={() => void run(b.id)}
                selected={selected === b.id}
                onSelect={() =>
                  void update.mutateAsync({
                    patch: { ai: { routing: { ...settings.ai.routing, "*": b.id } } },
                  })
                }
              />
            ))}
          </ul>
          <div className="flex items-center justify-between">
            <Button variant="ghost" size="sm" onClick={() => void query.refetch()}>
              {t("backend.recheck")}
            </Button>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setStep("worker")}>
                {t("onb.later")}
              </Button>
              <Button variant="primary" disabled={!selectedOk} onClick={() => setStep("worker")}>
                {t("onb.continue")}
              </Button>
            </div>
          </div>
        </>
      ) : (
        <>
          <p>{t("onb.worker.desc")}</p>
          <WorkerPanel worker={worker} />
          <div className="flex items-center justify-between">
            <Button variant="ghost" onClick={() => setStep("backend")}>
              {t("onb.back")}
            </Button>
            <Button variant="primary" onClick={onDone}>
              {worker.ready ? t("onb.finish") : t("onb.later")}
            </Button>
          </div>
        </>
      )}
    </Frame>
  );
}

/**
 * Wraps the routed app. The backend and worker steps show while no AI backend works and the setup
 * was not finished or skipped before. The decision is made once per start, from the first answer
 * of `settings.get`, so the flow does not vanish when the user's own test makes a backend work.
 * The mock core (browser preview) skips the setup unless `force` is set.
 */
export function OnboardingGate({
  children,
  force = false,
}: {
  children: ReactNode;
  force?: boolean;
}) {
  const core = useCore();
  const [done, setDone] = useState(isOnboardingDone);
  const [needed, setNeeded] = useState<boolean | undefined>(undefined);
  const skip = done || (core.isMock && !force);
  const settings = useOp(settingsGet, {}, { enabled: !skip });

  useEffect(() => {
    if (skip || needed !== undefined) return;
    if (settings.data) setNeeded(!settings.data.backends.some((b) => b.available));
    else if (settings.isError) setNeeded(false);
  }, [skip, needed, settings.data, settings.isError]);

  if (skip) return children;
  if (needed === undefined) return <Loading />;
  if (!needed) return children;
  return (
    <OnboardingFlow
      onDone={() => {
        markOnboardingDone();
        setDone(true);
      }}
    />
  );
}
