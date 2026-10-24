import {
  type WebhookInfo,
  type WebhookKind,
  webhooksCreate,
  webhooksDelete,
  webhooksList,
  webhooksRotateSecret,
  webhooksTest,
} from "@citegeist/ops";
import { type FormEvent, useId, useState } from "react";
import type { z } from "zod";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Segmented } from "../components/ui/segmented";
import { ErrorState, Loading } from "../components/ui/states";
import { type MessageKey, useI18n } from "../i18n";
import { useOp, useOpMutation } from "../lib/hooks";
import { CopyButton, ErrorLine, Fact, FieldLabel, Section, useGuarded } from "./parts";

type Hook = z.output<typeof WebhookInfo>;
type TestResult = z.output<typeof webhooksTest.output>;

const NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;
const KINDS: readonly WebhookKind[] = ["inbound", "outbound", "both"];

function isUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

/** A secret is shown here once, right after it was created or rotated. */
function SecretNotice({
  name,
  secret,
  onDone,
}: {
  name: string;
  secret: string;
  onDone: () => void;
}) {
  const { t } = useI18n();
  return (
    <div
      data-testid="secret-notice"
      className="flex flex-col gap-2 border border-ink bg-sunken p-3"
    >
      <p className="font-medium">{t("webhooks.secret.title", { name })}</p>
      <code data-testid="secret-value" className="break-all font-mono text-[12px]">
        {secret}
      </code>
      <p className="text-sm text-muted">{t("webhooks.secret.once")}</p>
      <div className="flex gap-2">
        <CopyButton
          text={secret}
          label={t("webhooks.secret.copy")}
          copiedLabel={t("webhooks.secret.copied")}
        />
        <Button size="sm" variant="primary" onClick={onDone}>
          {t("webhooks.secret.done")}
        </Button>
      </div>
    </div>
  );
}

function testLine(
  result: TestResult,
  t: (key: MessageKey, vars?: Record<string, string | number>) => string,
): string {
  if (!result.ok) return t("webhooks.test.failed", { error: result.error ?? "" });
  return result.mode === "local"
    ? t("webhooks.test.local")
    : t("webhooks.test.remote", {
        status: result.status ?? 200,
        ms: Math.round(result.latencyMs ?? 0),
      });
}

type Mode = "idle" | "rotate" | "delete";

function ConnectorCard({
  hook,
  onSecret,
}: {
  hook: Hook;
  onSecret: (name: string, secret: string) => void;
}) {
  const { t, lang } = useI18n();
  const test = useOpMutation(webhooksTest);
  const rotate = useOpMutation(webhooksRotateSecret);
  const remove = useOpMutation(webhooksDelete);
  const guard = useGuarded();
  const [mode, setMode] = useState<Mode>("idle");
  const [grace, setGrace] = useState("60");
  const [result, setResult] = useState<TestResult>();
  const graceId = useId();
  const until = hook.previousSecretUntil
    ? new Date(hook.previousSecretUntil).toLocaleString(lang, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : undefined;
  const graceMinutes = Number(grace);
  const graceOk = Number.isInteger(graceMinutes) && graceMinutes >= 0 && graceMinutes <= 1440;

  const runTest = async () => {
    setResult(undefined);
    const out = await guard.run(() => test.mutateAsync({ name: hook.name }));
    if (out) setResult(out);
  };

  const runRotate = async (e: FormEvent) => {
    e.preventDefault();
    const out = await guard.run(() =>
      rotate.mutateAsync({ name: hook.name, graceMinutes: graceMinutes }),
    );
    if (out) {
      setMode("idle");
      onSecret(hook.name, out.secret);
    }
  };

  const runDelete = async () => {
    await guard.run(() => remove.mutateAsync({ name: hook.name }));
  };

  return (
    <li
      data-testid="connector"
      data-name={hook.name}
      className="flex flex-col gap-3 border border-line bg-surface p-3"
    >
      <div className="flex items-center gap-2">
        <span className="font-mono text-[13px] font-medium">{hook.name}</span>
        <Badge tone="outline">{t(`webhooks.kind.${hook.kind}` as MessageKey)}</Badge>
      </div>
      <dl>
        <Fact label={t("webhooks.inboundUrl")} mono>
          {hook.inboundUrl}
        </Fact>
        {hook.url ? (
          <Fact label={t("webhooks.outboundUrl")} mono>
            {hook.url}
          </Fact>
        ) : null}
        <Fact label={t("webhooks.actor")} mono>
          {hook.actor}
        </Fact>
        <Fact label={t("webhooks.secret")}>
          {hook.hasSecret ? t("webhooks.secret.stored") : t("webhooks.secret.missing")}
        </Fact>
      </dl>
      {until ? (
        <p className="text-sm text-muted">{t("webhooks.secret.previous", { until })}</p>
      ) : null}

      {mode === "rotate" ? (
        <form onSubmit={(e) => void runRotate(e)} className="flex items-end gap-2">
          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor={graceId}>{t("webhooks.rotate.grace")}</FieldLabel>
            <Input
              id={graceId}
              inputMode="numeric"
              value={grace}
              onChange={(e) => setGrace(e.target.value)}
              className="w-28"
            />
          </div>
          <Button type="submit" variant="primary" disabled={!graceOk || rotate.isPending}>
            {t("webhooks.rotate.confirm")}
          </Button>
          <Button onClick={() => setMode("idle")}>{t("common.cancel")}</Button>
        </form>
      ) : mode === "delete" ? (
        <div className="flex flex-wrap items-center gap-2">
          <span>{t("webhooks.delete.ask", { name: hook.name })}</span>
          <Button variant="primary" disabled={remove.isPending} onClick={() => void runDelete()}>
            {t("webhooks.delete.confirm")}
          </Button>
          <Button onClick={() => setMode("idle")}>{t("common.cancel")}</Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <CopyButton
            text={hook.inboundUrl}
            label={t("webhooks.address.copy")}
            copiedLabel={t("webhooks.secret.copied")}
          />
          <Button disabled={test.isPending} onClick={() => void runTest()}>
            {test.isPending ? t("webhooks.testing") : t("webhooks.test")}
          </Button>
          <Button onClick={() => setMode("rotate")}>{t("webhooks.rotate")}</Button>
          <Button onClick={() => setMode("delete")}>{t("webhooks.delete")}</Button>
        </div>
      )}
      {result ? (
        <p role="status" className={result.ok ? "text-sm text-muted" : "text-sm text-danger"}>
          {testLine(result, t)}
        </p>
      ) : null}
      <ErrorLine error={guard.error} />
    </li>
  );
}

function CreateForm({ onSecret }: { onSecret: (name: string, secret: string) => void }) {
  const { t } = useI18n();
  const create = useOpMutation(webhooksCreate);
  const guard = useGuarded();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<WebhookKind>("inbound");
  const [url, setUrl] = useState("");
  const [invalid, setInvalid] = useState<string>();
  const nameId = useId();
  const urlId = useId();
  const needsUrl = kind !== "inbound";

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setInvalid(undefined);
    if (!NAME.test(name)) {
      setInvalid(t("webhooks.create.nameInvalid"));
      return;
    }
    if (needsUrl && !isUrl(url.trim())) {
      setInvalid(t("webhooks.create.urlInvalid"));
      return;
    }
    const out = await guard.run(() =>
      create.mutateAsync({ name, kind, ...(needsUrl ? { url: url.trim() } : {}) }),
    );
    if (out) {
      setName("");
      setUrl("");
      onSecret(out.webhook.name, out.secret);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3 border border-line p-3">
      <h3 className="font-medium">{t("webhooks.create.title")}</h3>
      <div className="flex flex-col gap-1">
        <FieldLabel htmlFor={nameId}>{t("webhooks.create.name")}</FieldLabel>
        <Input
          id={nameId}
          value={name}
          placeholder="grok"
          onChange={(e) => setName(e.target.value)}
          className="max-w-xs font-mono"
        />
        <p className="text-sm text-muted">{t("webhooks.create.nameHint")}</p>
      </div>
      <div className="flex flex-col gap-1">
        <FieldLabel>{t("webhooks.create.kind")}</FieldLabel>
        <div>
          <Segmented<WebhookKind>
            label={t("webhooks.create.kind")}
            value={kind}
            options={KINDS.map((value) => ({
              value,
              label: t(`webhooks.kind.${value}` as MessageKey),
            }))}
            onChange={setKind}
          />
        </div>
      </div>
      {needsUrl ? (
        <div className="flex flex-col gap-1">
          <FieldLabel htmlFor={urlId}>{t("webhooks.create.url")}</FieldLabel>
          <Input
            id={urlId}
            value={url}
            placeholder="https://grok-bot.example.com/citegeist"
            onChange={(e) => setUrl(e.target.value)}
            className="max-w-md font-mono"
          />
        </div>
      ) : null}
      <div>
        <Button type="submit" variant="primary" disabled={create.isPending || name === ""}>
          {t("webhooks.create.submit")}
        </Button>
      </div>
      <ErrorLine error={invalid ?? guard.error} />
    </form>
  );
}

/** Webhooks section of the settings: connectors for external agents such as Grok. */
export function WebhooksPanel() {
  const { t } = useI18n();
  const query = useOp(webhooksList, {});
  const [secret, setSecret] = useState<{ name: string; secret: string }>();

  if (query.isPending) return <Loading />;
  if (query.isError) return <ErrorState error={query.error} />;
  const { publicBaseUrl, webhooks } = query.data;
  const reveal = (name: string, value: string) => setSecret({ name, secret: value });

  return (
    <div className="flex flex-col gap-8">
      <Section id="webhooks-list" title={t("webhooks.title")} description={t("webhooks.desc")}>
        <dl className="border-t border-line-soft">
          <Fact label={t("webhooks.publicUrl")} mono={Boolean(publicBaseUrl)}>
            {publicBaseUrl ?? t("webhooks.publicUrl.none")}
          </Fact>
        </dl>
        {secret ? (
          <SecretNotice
            name={secret.name}
            secret={secret.secret}
            onDone={() => setSecret(undefined)}
          />
        ) : null}
        {webhooks.length === 0 ? (
          <p className="text-muted">{t("webhooks.empty")}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {webhooks.map((hook) => (
              <ConnectorCard key={hook.name} hook={hook} onSecret={reveal} />
            ))}
          </ul>
        )}
        <CreateForm onSecret={reveal} />
      </Section>

      <Section id="webhooks-guide" title={t("webhooks.guide.title")}>
        <ol className="flex list-decimal flex-col gap-1.5 pl-5">
          <li>{t("webhooks.guide.step1")}</li>
          <li>{t("webhooks.guide.step2")}</li>
          <li>{t("webhooks.guide.step3")}</li>
          <li>{t("webhooks.guide.step4")}</li>
          <li>{t("webhooks.guide.step5")}</li>
        </ol>
        <p className="text-sm text-muted">{t("webhooks.guide.more")}</p>
      </Section>
    </div>
  );
}
