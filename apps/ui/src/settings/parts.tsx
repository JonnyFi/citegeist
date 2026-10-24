import { type ReactNode, useCallback, useState } from "react";
import { Button } from "../components/ui/button";
import { describeError } from "../lib/utils";

/** Section with a rule on top and a serif heading, the block of the settings and import screens. */
export function Section({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description?: string | undefined;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3 border-t border-line pt-6">
      <div>
        <h2 id={id} className="font-serif text-lg font-semibold">
          {title}
        </h2>
        {description ? <p className="text-muted">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

/** Small uppercase label above a control. `htmlFor` ties it to the control. */
export function FieldLabel({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="text-[11px] font-semibold uppercase tracking-[0.1em]">
      {children}
    </label>
  );
}

/** Label and value pair in a definition list. The value is mono when it is technical. */
export function Fact({
  label,
  children,
  mono = false,
}: {
  label: string;
  children: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex gap-3 border-b border-line-soft py-1.5 last:border-b-0">
      <dt className="w-44 shrink-0 text-muted">{label}</dt>
      <dd className={mono ? "min-w-0 break-all font-mono text-[12px]" : "min-w-0"}>{children}</dd>
    </div>
  );
}

export function ErrorLine({ error }: { error: string | undefined }) {
  return error ? (
    <p role="alert" className="text-sm text-danger">
      {error}
    </p>
  ) : null;
}

/** Message and fix hint of a failed call as one line. */
export function errorText(err: unknown): string {
  const { message, fix } = describeError(err);
  return fix ? `${message} ${fix}` : message;
}

/** Runs async actions and keeps the last error as text. Starting a new action clears it. */
export function useGuarded() {
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const run = useCallback(async <T,>(action: () => Promise<T>): Promise<T | undefined> => {
    setError(undefined);
    setBusy(true);
    try {
      return await action();
    } catch (err) {
      setError(errorText(err));
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);
  return { error, setError, busy, run };
}

/** Copies a text to the clipboard and says so for two seconds. */
export function CopyButton({
  text,
  label,
  copiedLabel,
}: {
  text: string;
  label: string;
  copiedLabel: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="sm"
      onClick={() => {
        void navigator.clipboard
          ?.writeText(text)
          .then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          })
          .catch(() => {});
      }}
    >
      {copied ? copiedLabel : label}
    </Button>
  );
}

/** Progress bar of a job or a download, 4px high as in the job slot. */
export function Bar({ value, label }: { value: number; label: string }) {
  const percent = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className="h-1 w-full max-w-sm bg-line-soft"
    >
      <div className="h-full bg-ink" style={{ width: `${percent}%` }} />
    </div>
  );
}
