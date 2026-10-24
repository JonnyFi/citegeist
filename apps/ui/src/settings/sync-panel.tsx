import {
  type SyncConflict,
  type SyncTransport,
  syncConfigure,
  syncNow,
  syncResolveConflict,
  syncStatus,
} from "@citegeist/ops";
import { type FormEvent, useId, useState } from "react";
import type { z } from "zod";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Segmented } from "../components/ui/segmented";
import { ErrorState, Loading } from "../components/ui/states";
import { type MessageKey, useI18n } from "../i18n";
import { useOp, useOpMutation } from "../lib/hooks";
import { ErrorLine, Fact, FieldLabel, Section, useGuarded } from "./parts";

type Status = z.output<typeof syncStatus.output>;
type NowResult = z.output<typeof syncNow.output>;
type Conflict = z.output<typeof SyncConflict>;

const TRANSPORTS: readonly SyncTransport[] = ["none", "icloud", "dropbox", "git"];

function kb(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

function when(at: string, lang: string): string {
  const date = new Date(at);
  return Number.isNaN(date.getTime())
    ? at
    : date.toLocaleString(lang, { dateStyle: "medium", timeStyle: "short" });
}

/** The state of the git side of the library: branch, head, unsaved files and the remote. */
function GitFacts({ status }: { status: Status }) {
  const { t, tn } = useI18n();
  const { git } = status;
  if (!git.initialised && !git.remote) return null;
  return (
    <dl data-testid="sync-git" className="border-t border-line-soft">
      {git.branch ? (
        <Fact label={t("sync.git.branch")} mono>
          {git.branch}
        </Fact>
      ) : null}
      {git.head ? (
        <Fact label={t("sync.git.head")} mono>
          {git.head}
        </Fact>
      ) : null}
      <Fact label={t("sync.git.uncommitted")}>
        {tn("sync.git.uncommitted.value", git.uncommitted)}
      </Fact>
      {git.remote ? (
        <Fact label={t("sync.git.remote")} mono>
          {git.remote.url}
          {git.remote.ahead ? `  ${t("sync.git.ahead", { n: git.remote.ahead })}` : ""}
          {git.remote.behind ? `  ${t("sync.git.behind", { n: git.remote.behind })}` : ""}
        </Fact>
      ) : null}
      <Fact label={t("sync.git.dir")}>{t(`sync.git.dir.${git.gitDir}` as MessageKey)}</Fact>
    </dl>
  );
}

function ConflictRow({ conflict, git }: { conflict: Conflict; git: boolean }) {
  const { t, lang } = useI18n();
  const resolve = useOpMutation(syncResolveConflict);
  const guard = useGuarded();
  const keep = (choice: "a" | "b" | "both") =>
    void guard.run(() =>
      resolve.mutateAsync({ path: conflict.path, copy: conflict.copy, keep: choice }),
    );
  return (
    <li
      data-testid="conflict"
      data-path={conflict.path}
      className="flex flex-col gap-2 border border-line bg-surface p-3"
    >
      <p className="break-all font-mono text-[12px]">{conflict.path}</p>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <p className="font-medium">{git ? t("sync.conflict.aGit") : t("sync.conflict.a")}</p>
          <p className="font-mono text-[12px] text-muted">
            {kb(conflict.a.size)} · {when(conflict.a.modified, lang)}
          </p>
        </div>
        <div>
          <p className="font-medium">
            {git ? t("sync.conflict.bGit") : t("sync.conflict.b", { copy: conflict.copy })}
          </p>
          <p className="font-mono text-[12px] text-muted">
            {kb(conflict.b.size)} · {when(conflict.b.modified, lang)}
          </p>
        </div>
      </div>
      {conflict.identical ? (
        <p className="text-sm text-muted">{t("sync.conflict.identical")}</p>
      ) : null}
      {conflict.diff ? (
        <details>
          <summary className="cursor-pointer text-sm text-muted">{t("sync.conflict.diff")}</summary>
          <pre className="mt-2 max-h-60 overflow-auto border border-line-soft bg-sunken p-2 font-mono text-[12px]">
            {conflict.diff}
          </pre>
        </details>
      ) : null}
      <div className="flex">
        <Button disabled={resolve.isPending} onClick={() => keep("a")}>
          {t("sync.conflict.keepA")}
        </Button>
        <Button disabled={resolve.isPending} onClick={() => keep("b")} className="border-l-0">
          {t("sync.conflict.keepB")}
        </Button>
        <Button disabled={resolve.isPending} onClick={() => keep("both")} className="border-l-0">
          {t("sync.conflict.keepBoth")}
        </Button>
      </div>
      <ErrorLine error={guard.error} />
    </li>
  );
}

function NowResultLine({ result }: { result: NowResult }) {
  const { tn } = useI18n();
  return (
    <div role="status" className="text-sm text-muted">
      <p>{result.message}</p>
      {result.commits.length > 0 ? <p>{tn("sync.result.commits", result.commits.length)}</p> : null}
      {result.downloaded.length > 0 ? (
        <p>{tn("sync.result.downloaded", result.downloaded.length)}</p>
      ) : null}
    </div>
  );
}

/** Sync section of the settings: one transport, the git remote, "Jetzt synchronisieren" and conflicts. */
export function SyncPanel() {
  const query = useOp(syncStatus, {});
  if (query.isPending) return <Loading />;
  if (query.isError) return <ErrorState error={query.error} />;
  return <SyncView data={query.data} />;
}

function SyncView({ data }: { data: Status }) {
  const { t, tn, lang } = useI18n();
  const configure = useOpMutation(syncConfigure);
  const now = useOpMutation(syncNow);
  const save = useGuarded();
  const sync = useGuarded();
  const [transport, setTransport] = useState<SyncTransport>(data.transport);
  const [remote, setRemote] = useState(data.git.remote?.url ?? "");
  const [interval, setIntervalText] = useState(String(data.intervalMinutes));
  const [versioning, setVersioning] = useState(data.versioning);
  const [saved, setSaved] = useState(false);
  const [result, setResult] = useState<NowResult>();
  const remoteId = useId();
  const intervalId = useId();

  // The form follows the stored state whenever that changes (a save, a sync, another window).
  const stored = `${data.transport}|${data.git.remote?.url ?? ""}|${data.intervalMinutes}|${data.versioning}`;
  const [seen, setSeen] = useState(stored);
  if (stored !== seen) {
    setSeen(stored);
    setTransport(data.transport);
    setRemote(data.git.remote?.url ?? "");
    setIntervalText(String(data.intervalMinutes));
    setVersioning(data.versioning);
  }

  const gitBlocked = data.location !== "local";
  const minutes = Number(interval);
  const intervalOk = Number.isInteger(minutes) && minutes >= 1 && minutes <= 1440;
  const dirty =
    transport !== data.transport ||
    remote.trim() !== (data.git.remote?.url ?? "") ||
    minutes !== data.intervalMinutes ||
    versioning !== data.versioning;
  const canSave =
    dirty && intervalOk && (transport !== "git" || remote.trim() !== "") && !configure.isPending;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaved(false);
    const done = await save.run(() =>
      configure.mutateAsync({
        transport,
        ...(transport === "git" ? { remote: remote.trim() } : {}),
        intervalMinutes: minutes,
        versioning,
      }),
    );
    if (done) setSaved(true);
  };

  const run = async () => {
    setResult(undefined);
    const done = await sync.run(() => now.mutateAsync({ downloadAll: false }));
    if (done) setResult(done);
  };

  const last = data.lastSync;
  return (
    <div className="flex flex-col gap-8">
      <Section id="sync-route" title={t("sync.title")} description={t("sync.desc")}>
        <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <FieldLabel>{t("sync.transport")}</FieldLabel>
            <div>
              <Segmented<SyncTransport>
                label={t("sync.transport")}
                value={transport}
                options={TRANSPORTS.map((value) => ({
                  value,
                  label: t(`sync.transport.${value}` as MessageKey),
                  disabled: value === "git" && gitBlocked,
                }))}
                onChange={setTransport}
              />
            </div>
            {gitBlocked ? <p className="text-sm text-muted">{t("sync.gitBlocked")}</p> : null}
          </div>
          <dl className="max-w-md border-t border-line-soft">
            <Fact label={t("sync.location")}>
              {t(`sync.location.${data.location}` as MessageKey)}
            </Fact>
          </dl>
          {transport === "git" ? (
            <div className="flex flex-col gap-1">
              <FieldLabel htmlFor={remoteId}>{t("sync.remote")}</FieldLabel>
              <Input
                id={remoteId}
                value={remote}
                placeholder="git@github.com:name/library.git"
                onChange={(e) => {
                  setRemote(e.target.value);
                  setSaved(false);
                }}
                className="max-w-md font-mono"
              />
            </div>
          ) : null}
          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor={intervalId}>{t("sync.interval")}</FieldLabel>
            <Input
              id={intervalId}
              inputMode="numeric"
              value={interval}
              onChange={(e) => {
                setIntervalText(e.target.value);
                setSaved(false);
              }}
              className="w-28"
            />
          </div>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={versioning}
              onChange={(e) => {
                setVersioning(e.target.checked);
                setSaved(false);
              }}
            />
            <span>{t("sync.versioning")}</span>
          </label>
          <div className="flex items-center gap-3">
            <Button type="submit" variant="primary" disabled={!canSave}>
              {t("sync.save")}
            </Button>
            {saved ? (
              <span role="status" className="text-sm text-muted">
                {t("sync.saved")}
              </span>
            ) : null}
          </div>
          <ErrorLine error={save.error} />
        </form>
      </Section>

      <Section id="sync-state" title={t("sync.status.title")}>
        <p data-testid="sync-last" className="text-sm text-muted">
          {last
            ? t(last.ok ? "sync.last.ok" : "sync.last.failed", {
                at: when(last.at, lang),
                message: last.message,
              })
            : t("sync.never")}
        </p>
        <GitFacts status={data} />
        {data.evicted.length > 0 ? (
          <p className="text-sm">{tn("sync.evicted", data.evicted.length)}</p>
        ) : null}
        <div className="flex items-center gap-3">
          <Button onClick={() => void run()} disabled={now.isPending || data.transport === "none"}>
            {now.isPending ? t("sync.syncing") : t("sync.now")}
          </Button>
        </div>
        {result ? <NowResultLine result={result} /> : null}
        <ErrorLine error={sync.error} />
      </Section>

      <Section id="sync-conflicts" title={t("sync.conflicts.title")}>
        {data.conflicts.length === 0 ? (
          <p className="text-muted">{t("sync.conflicts.none")}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {data.conflicts.map((c) => (
              <ConflictRow
                key={`${c.path}|${c.copy}`}
                conflict={c}
                git={data.transport === "git"}
              />
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
