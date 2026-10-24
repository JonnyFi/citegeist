import type { ReactNode } from "react";
import { useI18n } from "../../i18n";
import { describeError } from "../../lib/utils";

/**
 * Empty and "no match" state: plain left-aligned text in a 640px measure, as the inbox board
 * shows it. No illustration, no centered block.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex max-w-[640px] flex-col items-start gap-2 px-8 py-6">
      {icon ? <div className="text-muted [&>svg]:size-5">{icon}</div> : null}
      <h2 className="font-serif text-[20px] font-medium leading-tight">{title}</h2>
      {description ? <p className="leading-[1.5] text-muted">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

/** Failure: a bordered notice in danger that says what happened and, when known, what to do. */
export function ErrorState({ error }: { error: unknown }) {
  const { t } = useI18n();
  const { message, fix } = describeError(error, t("common.error"));
  return (
    <div className="px-8 py-6">
      <div role="alert" className="max-w-[640px] border border-danger px-4 py-3">
        <p className="font-medium text-danger">{message}</p>
        {fix ? <p className="mt-1 text-muted">{fix}</p> : null}
      </div>
    </div>
  );
}

export function Loading({ label }: { label?: string }) {
  const { t } = useI18n();
  return (
    <div role="status" className="flex items-center gap-2 px-8 py-6 text-muted">
      <span aria-hidden="true" className="size-2 animate-pulse bg-ink" />
      {label ?? t("common.loading")}
    </div>
  );
}
