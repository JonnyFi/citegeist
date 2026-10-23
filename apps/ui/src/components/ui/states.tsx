import { AlertTriangle } from "lucide-react";
import type { ReactNode } from "react";
import { describeError } from "../../lib/utils";

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
    <div className="mx-auto flex max-w-sm flex-col items-center gap-2 px-6 py-20 text-center">
      {icon ? <div className="text-muted">{icon}</div> : null}
      <h2 className="font-serif text-lg font-semibold">{title}</h2>
      {description ? <p className="text-muted">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ error }: { error: unknown }) {
  const { message, fix } = describeError(error);
  return (
    <div
      role="alert"
      className="mx-auto flex max-w-md flex-col items-center gap-2 px-6 py-20 text-center"
    >
      <AlertTriangle className="size-5 text-danger" />
      <p className="font-medium">{message}</p>
      {fix ? <p className="text-muted">{fix}</p> : null}
    </div>
  );
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <div role="status" className="px-6 py-20 text-center text-muted">
      {label}
    </div>
  );
}
