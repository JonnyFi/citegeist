import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";

export interface ToastInput {
  message: string;
  /** Label of the one action, such as "Undo". */
  actionLabel?: string;
  onAction?: () => void | Promise<void>;
  /** Milliseconds until it disappears. Default 8000. */
  durationMs?: number;
}

interface ToastItem extends ToastInput {
  id: number;
}

interface ToastApi {
  show(toast: ToastInput): void;
}

const ToastContext = createContext<ToastApi | null>(null);

const NOOP: ToastApi = { show: () => {} };

/** Short messages at the bottom left, each with at most one action. */
export function useToast(): ToastApi {
  return useContext(ToastContext) ?? NOOP;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const next = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      show(toast) {
        const id = next.current++;
        setToasts((list) => [...list, { ...toast, id }]);
        setTimeout(() => dismiss(id), toast.durationMs ?? 8000);
      },
    }),
    [dismiss],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed bottom-4 left-4 z-50 flex flex-col gap-2"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="status"
            className="pointer-events-auto flex items-center gap-4 border border-ink bg-ink px-3 py-2 text-[13px] text-bg"
          >
            <span>{toast.message}</span>
            {toast.actionLabel && toast.onAction ? (
              <button
                type="button"
                className="border-0 bg-transparent p-0 text-[13px] font-medium underline underline-offset-2 hover:no-underline"
                onClick={() => {
                  dismiss(toast.id);
                  void toast.onAction?.();
                }}
              >
                {toast.actionLabel}
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
