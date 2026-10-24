import { settingsGet, settingsUpdate } from "@citegeist/ops";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { AlertsSection } from "../alerts";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Segmented } from "../components/ui/segmented";
import { Select } from "../components/ui/select";
import { ErrorState, Loading } from "../components/ui/states";
import { type Lang, type MessageKey, useI18n } from "../i18n";
import { useOp, useOpMutation } from "../lib/hooks";
import { describeError } from "../lib/utils";
import { BackendRow, pollConfig, useBackendTests, WorkerPanel } from "../onboarding/parts";
import { Section } from "../settings/parts";
import { SourcesPanel } from "../settings/sources-panel";
import { SyncPanel } from "../settings/sync-panel";
import { WebhooksPanel } from "../settings/webhooks-panel";
import { ChatPanel, ConnectorPanel, QuickInsertPanel, SemanticPanel } from "./settings-extras";

/** Tasks the routing can name besides the default. Mirrors TASKS of @citegeist/ai. */
export const ROUTED_TASKS = ["card.paraphrase", "card.verify", "metadata.fromFirstPage"] as const;

const INHERIT = "__inherit__";

function ContactForm({ current }: { current: string }) {
  const { t } = useI18n();
  const update = useOpMutation(settingsUpdate);
  const [value, setValue] = useState(current);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => setValue(current), [current]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaved(false);
    setError(undefined);
    try {
      await update.mutateAsync({ patch: { mailto: value.trim() } });
      setSaved(true);
    } catch (err) {
      const { message, fix } = describeError(err);
      setError(fix ? `${message} ${fix}` : message);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-2">
      <div className="flex gap-2">
        <Input
          type="text"
          inputMode="email"
          aria-label={t("settings.contact.label")}
          placeholder="name@example.org"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setSaved(false);
          }}
          className="max-w-sm"
        />
        <Button type="submit" disabled={update.isPending || value.trim() === current}>
          {t("settings.contact.save")}
        </Button>
      </div>
      {saved ? (
        <p role="status" className="text-sm text-muted">
          {t("settings.contact.saved")}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </form>
  );
}

function SettingsFrame({
  section,
  onSection,
  children,
}: {
  section: SettingsSection;
  onSection: (section: SettingsSection) => void;
  children: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-8">
      <h1 className="font-serif text-2xl font-semibold">{t("settings.title")}</h1>
      <Segmented<SettingsSection>
        label={t("settings.tab.label")}
        variant="tabs"
        value={section}
        options={SETTINGS_SECTIONS.map((value) => ({
          value,
          label: t(`settings.tab.${value}` as MessageKey),
        }))}
        onChange={onSection}
        className="h-9 border-b border-line-soft"
      />
      {children}
    </div>
  );
}

export const SETTINGS_SECTIONS = ["general", "sync", "alerts", "webhooks"] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

/**
 * The settings screen. "General" holds language, backends with test, routing, contact addresses,
 * chat agent, semantic search, connector and worker; sync and webhooks have their own section.
 */
export function SettingsScreen({
  section: shown,
  onSection,
}: {
  section?: SettingsSection;
  onSection?: (section: SettingsSection) => void;
} = {}) {
  const { t, setLang } = useI18n();
  const [local, setLocal] = useState<SettingsSection>("general");
  const section = shown ?? local;
  const pick = (next: SettingsSection) => {
    setLocal(next);
    onSection?.(next);
  };
  // While the model downloads, the progress is read again.
  const query = useOp(
    settingsGet,
    {},
    {
      refetchInterval: (q) =>
        q.state.data?.semantic?.state === "downloading" ||
        q.state.data?.semantic?.rerank === "loading"
          ? pollConfig.ms
          : false,
    },
  );
  const update = useOpMutation(settingsUpdate);
  const { tests, run } = useBackendTests();

  if (section !== "general") {
    return (
      <SettingsFrame section={section} onSection={pick}>
        {section === "sync" ? (
          <SyncPanel />
        ) : section === "alerts" ? (
          <AlertsSection />
        ) : (
          <WebhooksPanel />
        )}
      </SettingsFrame>
    );
  }
  if (query.isPending) return <Loading />;
  if (query.isError) return <ErrorState error={query.error} />;
  const { settings, backends, worker } = query.data;
  const hasQuickInsert = typeof window !== "undefined" && Boolean(window.citegeist?.quickInsert);
  const routing = settings.ai.routing;

  const setRouting = (next: Record<string, string>) =>
    update.mutateAsync({ patch: { ai: { routing: next } } });

  const backendOptions = backends.map((b) => ({ value: b.id, label: b.label }));
  const taskOptions = [{ value: INHERIT, label: t("settings.routing.inherit") }, ...backendOptions];

  return (
    <SettingsFrame section={section} onSection={pick}>
      <Section
        id="settings-language"
        title={t("settings.language.title")}
        description={t("settings.language.desc")}
      >
        <div>
          <Segmented<Lang>
            label={t("settings.language.title")}
            value={settings.uiLanguage}
            options={[
              { value: "de", label: "Deutsch" },
              { value: "en", label: "English" },
            ]}
            onChange={(lang) => {
              setLang(lang);
              void update.mutateAsync({ patch: { uiLanguage: lang } });
            }}
          />
        </div>
      </Section>

      <Section
        id="settings-backends"
        title={t("settings.backends.title")}
        description={t("settings.backends.desc")}
      >
        <ul className="flex flex-col gap-2">
          {backends.map((b) => (
            <BackendRow
              key={b.id}
              backend={b}
              test={tests[b.id]}
              onTest={() => void run(b.id)}
              keyStored={settings.ai.apiKeys[b.id] === true}
              onSaveKey={(key) =>
                update.mutateAsync({ patch: {}, apiKey: { provider: b.id, key } })
              }
              onRemoveKey={() =>
                update.mutateAsync({
                  patch: { ai: { routing, apiKeys: { [b.id]: false } } },
                })
              }
            />
          ))}
        </ul>
        <div>
          <Button variant="ghost" size="sm" onClick={() => void query.refetch()}>
            {t("backend.recheck")}
          </Button>
        </div>
      </Section>

      <Section
        id="settings-routing"
        title={t("settings.routing.title")}
        description={t("settings.routing.desc")}
      >
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-4">
            <span>{t("settings.routing.default")}</span>
            <Select
              label={t("settings.routing.default")}
              value={routing["*"] ?? ""}
              options={backendOptions}
              onChange={(id) => void setRouting({ ...routing, "*": id })}
            />
          </div>
          {ROUTED_TASKS.map((task) => {
            const label = t(`task.${task}` as MessageKey);
            return (
              <div key={task} className="flex items-center justify-between gap-4">
                <span>{label}</span>
                <Select
                  label={label}
                  value={routing[task] ?? INHERIT}
                  options={taskOptions}
                  onChange={(id) => {
                    const next = { ...routing };
                    if (id === INHERIT) delete next[task];
                    else next[task] = id;
                    void setRouting(next);
                  }}
                />
              </div>
            );
          })}
        </div>
      </Section>

      <Section
        id="settings-contact"
        title={t("settings.contact.title")}
        description={t("settings.contact.desc")}
      >
        <ContactForm current={settings.mailto ?? ""} />
      </Section>

      <Section
        id="settings-sources"
        title={t("settings.sources.title")}
        description={t("settings.sources.desc")}
      >
        <SourcesPanel data={query.data} />
      </Section>

      <Section
        id="settings-chat"
        title={t("settings.chat.title")}
        description={t("settings.chat.desc")}
      >
        <ChatPanel data={query.data} />
      </Section>

      <Section
        id="settings-semantic"
        title={t("settings.semantic.title")}
        description={t("settings.semantic.desc")}
      >
        <SemanticPanel data={query.data} />
      </Section>

      <Section
        id="settings-connector"
        title={t("settings.connector.title")}
        description={t("settings.connector.desc")}
      >
        <ConnectorPanel data={query.data} />
      </Section>

      {hasQuickInsert ? (
        <Section
          id="settings-quick-insert"
          title={t("settings.quickInsert.title")}
          description={t("settings.quickInsert.desc")}
        >
          <QuickInsertPanel />
        </Section>
      ) : null}

      <Section
        id="settings-worker"
        title={t("settings.worker.title")}
        description={t("settings.worker.desc")}
      >
        <WorkerPanel worker={worker} />
      </Section>
    </SettingsFrame>
  );
}
