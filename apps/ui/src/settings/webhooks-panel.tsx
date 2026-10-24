import {
  DEFAULT_HOOKS_PORT,
  settingsGet,
  settingsUpdate,
  type WebhookInfo,
  type WebhookKind,
  webhooksCreate,
  webhooksDelete,
  webhooksList,
  webhooksRotateSecret,
  webhooksSetAuth,
  webhooksSetInboundToken,
  webhooksSetMcpAccess,
  webhooksTest,
} from "@citegeist/ops";
import { type FormEvent, useEffect, useId, useState } from "react";
import type { z } from "zod";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Segmented } from "../components/ui/segmented";
import { ErrorState, Loading } from "../components/ui/states";
import { type MessageKey, useI18n } from "../i18n";
import { useOp, useOpMutation } from "../lib/hooks";
import { type AgentMessage, buildAgentMessage } from "./agent-message";
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

/** One secret or token that is shown here once. */
interface Revealed {
  label: string;
  value: string;
}

/** Secrets and tokens are shown here once, right after they were created or renewed. */
function SecretNotice({
  items,
  message,
  onDone,
}: {
  items: Revealed[];
  /** The text for the agent with the new tokens filled in. */
  message?: string;
  onDone: () => void;
}) {
  const { t } = useI18n();
  return (
    <div
      data-testid="secret-notice"
      className="flex flex-col gap-3 border border-ink bg-sunken p-3"
    >
      {items.map((item) => (
        <div key={item.label} className="flex flex-col gap-1">
          <p className="font-medium">{item.label}</p>
          <code data-testid="secret-value" className="break-all font-mono text-[12px]">
            {item.value}
          </code>
          <div>
            <CopyButton
              text={item.value}
              label={t("webhooks.secret.copy")}
              copiedLabel={t("webhooks.secret.copied")}
            />
          </div>
        </div>
      ))}
      <p className="text-sm text-muted">{t("webhooks.secret.once")}</p>
      {message ? (
        <div className="flex flex-col gap-2 border-t border-line pt-3">
          <p className="font-medium">{t("webhooks.agent.title")}</p>
          <MessageBlock text={message} testId="agent-message-fresh" />
          <p className="text-sm text-muted">{t("webhooks.agent.once")}</p>
        </div>
      ) : null}
      <div>
        <Button size="sm" variant="primary" onClick={onDone}>
          {t("webhooks.secret.done")}
        </Button>
      </div>
    </div>
  );
}

/** The tokens created in this session, kept only while the notice is open. */
interface FreshTokens {
  mcp?: string;
  inbound?: string;
}

type Reveal = (name: string, items: Revealed[], tokens?: FreshTokens) => void;

/** A ready-to-copy text in a code block with a copy button. */
function MessageBlock({ text, testId }: { text: string; testId: string }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-2">
      <pre
        data-testid={testId}
        className="max-h-72 overflow-auto whitespace-pre-wrap break-words border border-line bg-sunken p-2 font-mono text-[12px]"
      >
        {text}
      </pre>
      <div>
        <CopyButton
          text={text}
          label={t("webhooks.agent.copy")}
          copiedLabel={t("webhooks.secret.copied")}
        />
      </div>
    </div>
  );
}

/** The text for the agent of one connector, with placeholders for tokens that are not known. */
function AgentSection({
  message,
  busy,
  hasInboundToken,
  onNewMcp,
  onNewInbound,
}: {
  message: AgentMessage;
  busy: boolean;
  hasInboundToken: boolean;
  onNewMcp: () => void;
  onNewInbound: () => void;
}) {
  const { t } = useI18n();
  return (
    <div data-testid="agent-section" className="flex flex-col gap-2 border-t border-line-soft pt-3">
      <p className="font-medium">{t("webhooks.agent.title")}</p>
      {message.ok ? (
        <>
          <p className="text-sm text-muted">{t("webhooks.agent.hint")}</p>
          <MessageBlock text={message.text} testId="agent-message" />
          {message.needsMcpToken || message.needsInboundToken ? (
            <>
              <p className="text-sm text-muted">{t("webhooks.agent.placeholders")}</p>
              <div className="flex flex-wrap gap-2">
                {message.needsMcpToken ? (
                  <Button size="sm" disabled={busy} onClick={onNewMcp}>
                    {t("webhooks.agent.newMcp")}
                  </Button>
                ) : null}
                {message.needsInboundToken ? (
                  <Button size="sm" disabled={busy} onClick={onNewInbound}>
                    {hasInboundToken
                      ? t("webhooks.agent.newInbound")
                      : t("webhooks.agent.createInbound")}
                  </Button>
                ) : null}
              </div>
            </>
          ) : null}
        </>
      ) : (
        <p role="status" className="text-sm text-danger">
          {t("webhooks.agent.noPublicUrl")}
        </p>
      )}
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

type Mode = "idle" | "rotate" | "delete" | "auth" | "token" | "mcp";
type McpChoice = "off" | "read" | "write";

const secretItem = (t: ReturnType<typeof useI18n>["t"], name: string, value: string): Revealed => ({
  label: t("webhooks.secret.title", { name }),
  value,
});

function agentMessage(hook: Hook, publicUrl: string | undefined, tokens?: FreshTokens) {
  return buildAgentMessage({
    name: hook.name,
    kind: hook.kind,
    ...(publicUrl ? { publicUrl } : {}),
    ...(hook.mcpScope ? { mcpScope: hook.mcpScope } : {}),
    ...(hook.mcpScope && tokens?.mcp ? { mcpToken: tokens.mcp } : {}),
    hasInboundToken: hook.hasInboundToken,
    ...(hook.hasInboundToken && tokens?.inbound ? { inboundToken: tokens.inbound } : {}),
  });
}

function ConnectorCard({
  hook,
  publicUrl,
  onReveal,
}: {
  hook: Hook;
  publicUrl?: string;
  onReveal: Reveal;
}) {
  const { t, lang } = useI18n();
  const test = useOpMutation(webhooksTest);
  const rotate = useOpMutation(webhooksRotateSecret);
  const remove = useOpMutation(webhooksDelete);
  const setAuth = useOpMutation(webhooksSetAuth);
  const setToken = useOpMutation(webhooksSetInboundToken);
  const setMcp = useOpMutation(webhooksSetMcpAccess);
  const guard = useGuarded();
  const [mode, setMode] = useState<Mode>("idle");
  const [grace, setGrace] = useState("60");
  const [authName, setAuthName] = useState(hook.authHeader ?? "Authorization");
  const [authValue, setAuthValue] = useState("");
  const [mcpScope, setMcpScope] = useState<"read" | "write">(hook.mcpScope ?? "write");
  const [result, setResult] = useState<TestResult>();
  const graceId = useId();
  const authNameId = useId();
  const authValueId = useId();
  const outbound = hook.kind !== "inbound";
  const mcpUrl = hook.inboundUrl.replace(/\/hooks\/[^/]+$/, "/mcp");
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
      onReveal(hook.name, [secretItem(t, hook.name, out.secret)]);
    }
  };

  const runDelete = async () => {
    await guard.run(() => remove.mutateAsync({ name: hook.name }));
  };

  const saveAuth = async (e: FormEvent) => {
    e.preventDefault();
    const out = await guard.run(() =>
      setAuth.mutateAsync({
        name: hook.name,
        authHeader: authName.trim(),
        authValue: authValue.trim(),
      }),
    );
    if (out) {
      setAuthValue("");
      setMode("idle");
    }
  };

  const removeAuth = async () => {
    const out = await guard.run(() => setAuth.mutateAsync({ name: hook.name }));
    if (out) setMode("idle");
  };

  const changeToken = async (enabled: boolean) => {
    const out = await guard.run(() => setToken.mutateAsync({ name: hook.name, enabled }));
    if (!out) return;
    setMode("idle");
    if (out.token) {
      onReveal(
        hook.name,
        [{ label: t("webhooks.token.title", { name: hook.name }), value: out.token }],
        { inbound: out.token },
      );
    }
  };

  const changeMcp = async (enabled: boolean, scope: "read" | "write" = mcpScope) => {
    const out = await guard.run(() => setMcp.mutateAsync({ name: hook.name, enabled, scope }));
    if (!out) return;
    setMode("idle");
    if (out.token) {
      onReveal(
        hook.name,
        [{ label: t("webhooks.mcp.tokenTitle", { name: hook.name }), value: out.token }],
        { mcp: out.token },
      );
    }
  };

  const mcpState = hook.mcpScope
    ? t(hook.mcpScope === "write" ? "webhooks.mcp.write" : "webhooks.mcp.read")
    : t("webhooks.off");

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
        {outbound ? (
          <Fact label={t("webhooks.auth")}>
            {hook.authHeader
              ? t("webhooks.auth.set", { header: hook.authHeader })
              : t("webhooks.auth.none")}
          </Fact>
        ) : null}
        <Fact label={t("webhooks.actor")} mono>
          {hook.actor}
        </Fact>
        <Fact label={t("webhooks.secret")}>
          {hook.hasSecret ? t("webhooks.secret.stored") : t("webhooks.secret.missing")}
        </Fact>
        <Fact label={t("webhooks.token")}>
          {hook.hasInboundToken ? t("webhooks.token.on") : t("webhooks.off")}
        </Fact>
        <Fact label={t("webhooks.mcp")}>{mcpState}</Fact>
        {hook.mcpScope ? (
          <Fact label={t("webhooks.mcp.url")} mono>
            {mcpUrl}
          </Fact>
        ) : null}
      </dl>
      {until ? (
        <p className="text-sm text-muted">{t("webhooks.secret.previous", { until })}</p>
      ) : null}
      <AgentSection
        message={agentMessage(hook, publicUrl)}
        busy={setMcp.isPending || setToken.isPending}
        hasInboundToken={hook.hasInboundToken}
        onNewMcp={() => void changeMcp(true, hook.mcpScope ?? mcpScope)}
        onNewInbound={() => void changeToken(true)}
      />

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
      ) : mode === "auth" ? (
        <form onSubmit={(e) => void saveAuth(e)} className="flex flex-col gap-2">
          <p className="text-sm text-muted">{t("webhooks.auth.hint")}</p>
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1">
              <FieldLabel htmlFor={authNameId}>{t("webhooks.auth.name")}</FieldLabel>
              <Input
                id={authNameId}
                value={authName}
                onChange={(e) => setAuthName(e.target.value)}
                className="w-48 font-mono"
              />
            </div>
            <div className="flex flex-col gap-1">
              <FieldLabel htmlFor={authValueId}>{t("webhooks.auth.value")}</FieldLabel>
              <Input
                id={authValueId}
                type="password"
                autoComplete="off"
                value={authValue}
                placeholder={hook.hasAuthValue ? t("webhooks.auth.valueKept") : "Bearer crsr_..."}
                onChange={(e) => setAuthValue(e.target.value)}
                className="w-72 font-mono"
              />
            </div>
            <Button
              type="submit"
              variant="primary"
              disabled={setAuth.isPending || authName.trim() === "" || authValue.trim() === ""}
            >
              {t("webhooks.auth.save")}
            </Button>
            {hook.authHeader ? (
              <Button disabled={setAuth.isPending} onClick={() => void removeAuth()}>
                {t("webhooks.auth.remove")}
              </Button>
            ) : null}
            <Button onClick={() => setMode("idle")}>{t("common.cancel")}</Button>
          </div>
        </form>
      ) : mode === "token" ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted">{t("webhooks.token.hint")}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              disabled={setToken.isPending}
              onClick={() => void changeToken(true)}
            >
              {hook.hasInboundToken ? t("webhooks.token.renew") : t("webhooks.token.create")}
            </Button>
            {hook.hasInboundToken ? (
              <Button disabled={setToken.isPending} onClick={() => void changeToken(false)}>
                {t("webhooks.token.disable")}
              </Button>
            ) : null}
            <Button onClick={() => setMode("idle")}>{t("common.cancel")}</Button>
          </div>
        </div>
      ) : mode === "mcp" ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted">{t("webhooks.mcp.hint")}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Segmented<"read" | "write">
              label={t("webhooks.mcp")}
              value={mcpScope}
              options={[
                { value: "read", label: t("webhooks.mcp.read") },
                { value: "write", label: t("webhooks.mcp.write") },
              ]}
              onChange={setMcpScope}
            />
            <Button
              variant="primary"
              disabled={setMcp.isPending}
              onClick={() => void changeMcp(true)}
            >
              {hook.mcpScope ? t("webhooks.mcp.renew") : t("webhooks.mcp.create")}
            </Button>
            {hook.mcpScope ? (
              <Button disabled={setMcp.isPending} onClick={() => void changeMcp(false)}>
                {t("webhooks.mcp.revoke")}
              </Button>
            ) : null}
            <Button onClick={() => setMode("idle")}>{t("common.cancel")}</Button>
          </div>
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
          {outbound ? (
            <Button onClick={() => setMode("auth")}>{t("webhooks.auth.edit")}</Button>
          ) : null}
          <Button onClick={() => setMode("token")}>{t("webhooks.token.edit")}</Button>
          <Button onClick={() => setMode("mcp")}>{t("webhooks.mcp.edit")}</Button>
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

function CreateForm({ onReveal }: { onReveal: Reveal }) {
  const { t } = useI18n();
  const create = useOpMutation(webhooksCreate);
  const guard = useGuarded();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<WebhookKind>("inbound");
  const [url, setUrl] = useState("");
  const [authName, setAuthName] = useState("");
  const [authValue, setAuthValue] = useState("");
  const [inboundToken, setInboundToken] = useState(false);
  const [mcp, setMcp] = useState<McpChoice>("off");
  const [invalid, setInvalid] = useState<string>();
  const nameId = useId();
  const urlId = useId();
  const authNameId = useId();
  const authValueId = useId();
  const tokenId = useId();
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
    const withAuth = needsUrl && (authName.trim() !== "" || authValue.trim() !== "");
    if (withAuth && (authName.trim() === "" || authValue.trim() === "")) {
      setInvalid(t("webhooks.create.authIncomplete"));
      return;
    }
    const out = await guard.run(() =>
      create.mutateAsync({
        name,
        kind,
        ...(needsUrl ? { url: url.trim() } : {}),
        ...(withAuth ? { authHeader: authName.trim(), authValue: authValue.trim() } : {}),
        ...(inboundToken ? { inboundToken: true } : {}),
        ...(mcp !== "off" ? { mcp } : {}),
      }),
    );
    if (out) {
      setName("");
      setUrl("");
      setAuthName("");
      setAuthValue("");
      setInboundToken(false);
      setMcp("off");
      const items = [secretItem(t, out.webhook.name, out.secret)];
      const tokens: FreshTokens = {};
      if (out.inboundToken) {
        items.push({ label: t("webhooks.token.title", { name }), value: out.inboundToken });
        tokens.inbound = out.inboundToken;
      }
      if (out.mcpToken) {
        items.push({ label: t("webhooks.mcp.tokenTitle", { name }), value: out.mcpToken });
        tokens.mcp = out.mcpToken;
      }
      onReveal(out.webhook.name, items, tokens);
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
        <>
          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor={urlId}>{t("webhooks.create.url")}</FieldLabel>
            <Input
              id={urlId}
              value={url}
              placeholder="https://api2.cursor.sh/automations/webhook/<routine-id>"
              onChange={(e) => setUrl(e.target.value)}
              className="max-w-md font-mono"
            />
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1">
              <FieldLabel htmlFor={authNameId}>{t("webhooks.auth.name")}</FieldLabel>
              <Input
                id={authNameId}
                value={authName}
                placeholder="Authorization"
                onChange={(e) => setAuthName(e.target.value)}
                className="w-48 font-mono"
              />
            </div>
            <div className="flex flex-col gap-1">
              <FieldLabel htmlFor={authValueId}>{t("webhooks.auth.value")}</FieldLabel>
              <Input
                id={authValueId}
                type="password"
                autoComplete="off"
                value={authValue}
                placeholder="Bearer crsr_..."
                onChange={(e) => setAuthValue(e.target.value)}
                className="w-72 font-mono"
              />
            </div>
          </div>
          <p className="text-sm text-muted">{t("webhooks.auth.hint")}</p>
        </>
      ) : null}
      <div className="flex items-center gap-2">
        <input
          id={tokenId}
          type="checkbox"
          checked={inboundToken}
          onChange={(e) => setInboundToken(e.target.checked)}
        />
        <label htmlFor={tokenId}>{t("webhooks.create.token")}</label>
      </div>
      <div className="flex flex-col gap-1">
        <FieldLabel>{t("webhooks.mcp")}</FieldLabel>
        <div>
          <Segmented<McpChoice>
            label={t("webhooks.mcp")}
            value={mcp}
            options={[
              { value: "off", label: t("webhooks.off") },
              { value: "read", label: t("webhooks.mcp.read") },
              { value: "write", label: t("webhooks.mcp.write") },
            ]}
            onChange={setMcp}
          />
        </div>
      </div>
      <div>
        <Button type="submit" variant="primary" disabled={create.isPending || name === ""}>
          {t("webhooks.create.submit")}
        </Button>
      </div>
      <ErrorLine error={invalid ?? guard.error} />
    </form>
  );
}

/** Fixed port and public address: where a tunnel points and what the callbacks say. */
function ReachSection({ list }: { list: z.output<typeof webhooksList.output> }) {
  const { t } = useI18n();
  const settings = useOp(settingsGet, {});
  const update = useOpMutation(settingsUpdate);
  const guard = useGuarded();
  const stored = settings.data?.settings.webhooks;
  const port = stored?.port ?? DEFAULT_HOOKS_PORT;
  const [portText, setPortText] = useState(String(port));
  const [urlText, setUrlText] = useState(stored?.publicUrl ?? "");
  const [invalid, setInvalid] = useState<string>();
  const portId = useId();
  const urlId = useId();
  useEffect(() => setPortText(String(port)), [port]);
  useEffect(() => setUrlText(stored?.publicUrl ?? ""), [stored?.publicUrl]);

  const { listener, publicBaseUrl, publicBaseUrlSource, webhooks } = list;
  const needsPublic =
    !publicBaseUrl && webhooks.some((h) => h.kind === "outbound" || h.kind === "both");

  const savePort = async (e: FormEvent) => {
    e.preventDefault();
    setInvalid(undefined);
    const next = Number(portText);
    if (!Number.isInteger(next) || next < 1024 || next > 65535) {
      setInvalid(t("webhooks.port.invalid"));
      return;
    }
    await guard.run(() => update.mutateAsync({ patch: { webhooks: { port: next } } }));
  };
  const saveUrl = async (e: FormEvent) => {
    e.preventDefault();
    setInvalid(undefined);
    await guard.run(() =>
      update.mutateAsync({ patch: { webhooks: { publicUrl: urlText.trim() } } }),
    );
  };

  let status: string;
  if (listener.state === "listening")
    status = t("webhooks.listener.on", { port: listener.port ?? port });
  else if (listener.state === "error") status = "";
  else status = t("webhooks.listener.off", { port });

  return (
    <div className="flex flex-col gap-3">
      <dl className="border-t border-line-soft">
        <Fact label={t("webhooks.listener")}>{status}</Fact>
        <Fact label={t("webhooks.publicUrl")} mono={Boolean(publicBaseUrl)}>
          {publicBaseUrl ?? t("webhooks.publicUrl.none")}
        </Fact>
      </dl>
      {listener.state === "error" ? (
        <p role="alert" className="text-sm text-danger">
          {listener.code === "HOOKS_PORT_IN_USE"
            ? t("webhooks.listener.inUse", { port: listener.port ?? port })
            : t("webhooks.listener.failed", { detail: listener.detail ?? "" })}
        </p>
      ) : null}
      {needsPublic ? (
        <p role="status" className="text-sm text-danger">
          {t("webhooks.publicUrl.needed")}
        </p>
      ) : null}
      <form onSubmit={(e) => void savePort(e)} className="flex items-end gap-2">
        <div className="flex flex-col gap-1">
          <FieldLabel htmlFor={portId}>{t("webhooks.port")}</FieldLabel>
          <Input
            id={portId}
            inputMode="numeric"
            value={portText}
            onChange={(e) => setPortText(e.target.value)}
            className="w-28"
          />
        </div>
        <Button type="submit" disabled={update.isPending || portText.trim() === String(port)}>
          {t("webhooks.port.save")}
        </Button>
      </form>
      <p className="text-sm text-muted">{t("webhooks.port.hint", { port })}</p>
      <form onSubmit={(e) => void saveUrl(e)} className="flex items-end gap-2">
        <div className="flex flex-col gap-1">
          <FieldLabel htmlFor={urlId}>{t("webhooks.publicUrl.field")}</FieldLabel>
          <Input
            id={urlId}
            value={urlText}
            placeholder="https://mac.tailnet-name.ts.net"
            onChange={(e) => setUrlText(e.target.value)}
            className="w-96 max-w-full font-mono"
          />
        </div>
        <Button
          type="submit"
          disabled={update.isPending || urlText.trim() === (stored?.publicUrl ?? "")}
        >
          {t("webhooks.publicUrl.save")}
        </Button>
      </form>
      {publicBaseUrlSource === "env" ? (
        <p className="text-sm text-muted">{t("webhooks.publicUrl.env")}</p>
      ) : null}
      <ErrorLine error={invalid ?? guard.error} />
    </div>
  );
}

function hasTokens(tokens: FreshTokens): boolean {
  return tokens.mcp !== undefined || tokens.inbound !== undefined;
}

/** Webhooks section of the settings: connectors for external agents such as Grok. */
export function WebhooksPanel() {
  const { t } = useI18n();
  const query = useOp(webhooksList, {});
  const [revealed, setRevealed] = useState<{
    name: string;
    items: Revealed[];
    tokens: FreshTokens;
  }>();

  if (query.isPending) return <Loading />;
  if (query.isError) return <ErrorState error={query.error} />;
  const { webhooks } = query.data;
  const reveal: Reveal = (name, items, tokens = {}) =>
    setRevealed((prev) => ({
      name,
      items,
      tokens: prev?.name === name ? { ...prev.tokens, ...tokens } : tokens,
    }));
  const { publicBaseUrl } = query.data;
  const freshHook = revealed ? webhooks.find((h) => h.name === revealed.name) : undefined;
  const freshMessage =
    freshHook && revealed && hasTokens(revealed.tokens)
      ? agentMessage(freshHook, publicBaseUrl, revealed.tokens)
      : undefined;

  return (
    <div className="flex flex-col gap-8">
      <Section id="webhooks-list" title={t("webhooks.title")} description={t("webhooks.desc")}>
        <ReachSection list={query.data} />
        {revealed ? (
          <SecretNotice
            items={revealed.items}
            {...(freshMessage?.ok ? { message: freshMessage.text } : {})}
            onDone={() => setRevealed(undefined)}
          />
        ) : null}
        {webhooks.length === 0 ? (
          <p className="text-muted">{t("webhooks.empty")}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {webhooks.map((hook) => (
              <ConnectorCard
                key={hook.name}
                hook={hook}
                {...(publicBaseUrl ? { publicUrl: publicBaseUrl } : {})}
                onReveal={reveal}
              />
            ))}
          </ul>
        )}
        <CreateForm onReveal={reveal} />
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
