import { type settingsGet, settingsUpdate } from "@citegeist/ops";
import { type FormEvent, useEffect, useId, useState } from "react";
import type { z } from "zod";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { useI18n } from "../i18n";
import { useOpMutation } from "../lib/hooks";
import { ErrorLine, FieldLabel, useGuarded } from "./parts";

type SettingsData = z.output<typeof settingsGet.output>;

/** The NCBI key slot in the Keychain, next to the AI provider keys. */
export const NCBI_KEY = "ncbi";

/** Address for Unpaywall and the `tool` name and API key for NCBI E-utilities. */
export function SourcesPanel({ data }: { data: SettingsData }) {
  const { t } = useI18n();
  const update = useOpMutation(settingsUpdate);
  const { settings } = data;
  const [unpaywall, setUnpaywall] = useState(settings.unpaywallEmail ?? "");
  const [tool, setTool] = useState(settings.ncbiTool ?? "");
  const [key, setKey] = useState("");
  const [saved, setSaved] = useState(false);
  const form = useGuarded();
  const keyForm = useGuarded();
  const unpaywallId = useId();
  const toolId = useId();
  const keyStored = settings.ai.apiKeys[NCBI_KEY] === true;
  useEffect(() => setUnpaywall(settings.unpaywallEmail ?? ""), [settings.unpaywallEmail]);
  useEffect(() => setTool(settings.ncbiTool ?? ""), [settings.ncbiTool]);

  const dirty =
    unpaywall.trim() !== (settings.unpaywallEmail ?? "") ||
    tool.trim() !== (settings.ncbiTool ?? "");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaved(false);
    const done = await form.run(() =>
      update.mutateAsync({ patch: { unpaywallEmail: unpaywall.trim(), ncbiTool: tool.trim() } }),
    );
    if (done) setSaved(true);
  };

  const saveKey = async (e: FormEvent) => {
    e.preventDefault();
    if (!key.trim()) return;
    const done = await keyForm.run(() =>
      update.mutateAsync({ patch: {}, apiKey: { provider: NCBI_KEY, key: key.trim() } }),
    );
    if (done) setKey("");
  };

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <FieldLabel htmlFor={unpaywallId}>{t("settings.sources.unpaywall")}</FieldLabel>
          <Input
            id={unpaywallId}
            type="text"
            inputMode="email"
            placeholder="name@example.org"
            value={unpaywall}
            onChange={(e) => {
              setUnpaywall(e.target.value);
              setSaved(false);
            }}
            className="max-w-sm"
          />
        </div>
        <div className="flex flex-col gap-1">
          <FieldLabel htmlFor={toolId}>{t("settings.sources.tool")}</FieldLabel>
          <Input
            id={toolId}
            type="text"
            placeholder="citegeist"
            value={tool}
            onChange={(e) => {
              setTool(e.target.value);
              setSaved(false);
            }}
            className="max-w-sm"
          />
          <p className="text-sm text-muted">{t("settings.sources.toolHint")}</p>
        </div>
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={form.busy || !dirty}>
            {t("settings.sources.save")}
          </Button>
          {saved ? (
            <span role="status" className="text-sm text-muted">
              {t("settings.contact.saved")}
            </span>
          ) : null}
        </div>
        <ErrorLine error={form.error} />
      </form>

      <div className="flex flex-col gap-1">
        <FieldLabel>{t("settings.sources.key")}</FieldLabel>
        {keyStored ? (
          <div className="flex items-center gap-3 text-sm text-muted">
            {t("settings.sources.keyStored")}
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                void keyForm.run(() =>
                  update.mutateAsync({
                    patch: { ai: { routing: settings.ai.routing, apiKeys: { [NCBI_KEY]: false } } },
                  }),
                )
              }
            >
              {t("settings.sources.keyRemove")}
            </Button>
          </div>
        ) : (
          <form onSubmit={(e) => void saveKey(e)} className="flex gap-2">
            <Input
              type="password"
              autoComplete="off"
              aria-label={t("settings.sources.key")}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              className="max-w-sm"
            />
            <Button type="submit" disabled={!key.trim() || keyForm.busy}>
              {t("settings.sources.keySave")}
            </Button>
          </form>
        )}
        <ErrorLine error={keyForm.error} />
      </div>
    </div>
  );
}
