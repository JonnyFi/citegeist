import { useEffect, useState } from "react";
import { useI18n } from "../i18n";
import { cn } from "../lib/utils";
import { useChatFocusRequest } from "./context";
import { Conversation } from "./conversation";
import { ResearchJobs } from "./research";

type Tab = "chat" | "research";

/**
 * The agent chat as one self-contained panel for a column of about 360 px: conversation and
 * research jobs behind a small switch. The shell mounts it and needs no other chat code.
 */
export function ChatPanel({ className }: { className?: string }) {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>("chat");
  const [opened, setOpened] = useState<string | null>(null);
  const focusRequested = useChatFocusRequest();

  // a card sent from the card menu belongs in the conversation
  useEffect(() => {
    if (focusRequested) setTab("chat");
  }, [focusRequested]);

  return (
    <section
      aria-label={t("chat.panelLabel")}
      data-testid="chat-panel"
      className={cn("flex h-full min-h-0 w-full min-w-0 flex-col bg-surface", className)}
    >
      <div role="tablist" aria-label={t("chat.tabs")} className="flex h-11 border-b border-line">
        {(["chat", "research"] as const).map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`chat-tab-${id}`}
            aria-selected={tab === id}
            aria-controls={`chat-tabpanel-${id}`}
            onClick={() => setTab(id)}
            className={cn(
              "flex flex-1 items-center justify-center text-[11px] font-semibold uppercase tracking-[0.1em]",
              id === "research" && "border-l border-line",
              tab === id ? "bg-ink text-bg" : "text-muted hover:text-ink",
            )}
          >
            {t(`chat.tab.${id}`)}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id="chat-tabpanel-chat"
        aria-labelledby="chat-tab-chat"
        hidden={tab !== "chat"}
        className="flex min-h-0 flex-1 flex-col [&[hidden]]:hidden"
      >
        <Conversation openSession={opened} />
      </div>
      <div
        role="tabpanel"
        id="chat-tabpanel-research"
        aria-labelledby="chat-tab-research"
        hidden={tab !== "research"}
        className="flex min-h-0 flex-1 flex-col [&[hidden]]:hidden"
      >
        <ResearchJobs
          onOpenSession={(id) => {
            setOpened(id);
            setTab("chat");
          }}
        />
      </div>
    </section>
  );
}
