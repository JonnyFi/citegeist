import { Button } from "../components/ui/button";
import { useI18n } from "../i18n";
import { CopyButton } from "../settings/parts";

/** A shell command in a box with a copy button. */
export function CommandBlock({ command }: { command: string }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-2 border border-line bg-sunken py-1 pl-2.5 pr-1.5">
      <code className="min-w-0 flex-1 select-all break-all font-mono text-[12px]">{command}</code>
      <CopyButton text={command} label={t("onb.copy")} copiedLabel={t("onb.copied")} />
    </div>
  );
}

export const UV_BREW = "brew install uv";
export const UV_CURL = "curl -LsSf https://astral.sh/uv/install.sh | sh";

/** What to do when `uv` is not installed: two install commands and a button to look again. */
export function UvHelp({ onRecheck, busy }: { onRecheck: () => void; busy?: boolean }) {
  const { t } = useI18n();
  return (
    <div data-testid="uv-help" className="mt-3 flex flex-col gap-3 border-t border-line pt-3">
      <p className="font-medium">{t("onb.uv.title")}</p>
      <p className="text-sm">{t("onb.uv.desc")}</p>
      <div className="flex flex-col gap-1">
        <span className="text-sm text-muted">{t("onb.uv.brew")}</span>
        <CommandBlock command={UV_BREW} />
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-sm text-muted">{t("onb.uv.curl")}</span>
        <CommandBlock command={UV_CURL} />
      </div>
      <p className="text-sm text-muted">{t("onb.uv.reading")}</p>
      <div>
        <Button onClick={onRecheck} disabled={busy}>
          {t("onb.recheck")}
        </Button>
      </div>
    </div>
  );
}

interface AgentOption {
  id: string;
  name: "onb.agents.claude" | "onb.agents.codex" | "onb.agents.cursor";
  install: string;
  login: string;
}

/** Install and login commands of the agent CLIs citegeist runs. Same as install.sh prints. */
export const AGENT_OPTIONS: readonly AgentOption[] = [
  {
    id: "claude",
    name: "onb.agents.claude",
    install: "curl -fsSL https://claude.ai/install.sh | bash",
    login: "claude auth login",
  },
  {
    id: "codex",
    name: "onb.agents.codex",
    install: "npm install -g @openai/codex",
    login: "codex login",
  },
  {
    id: "cursor",
    name: "onb.agents.cursor",
    install: "curl https://cursor.com/install -fsS | bash",
    login: "agent login",
  },
];

export const OLLAMA_PULL = "ollama pull llama3.2";

/** Shown while no backend works: the options for AI access, with commands to copy. */
export function BackendHelp() {
  const { t } = useI18n();
  return (
    <div
      data-testid="backend-help"
      className="flex flex-col gap-3 border border-line bg-surface p-3"
    >
      <p className="font-medium">{t("onb.agents.title")}</p>
      <p className="text-sm">{t("onb.agents.desc")}</p>
      <ul className="flex flex-col gap-3">
        {AGENT_OPTIONS.map((option) => (
          <li key={option.id} className="flex flex-col gap-1">
            <span className="text-sm font-medium">{t(option.name)}</span>
            <span className="text-sm text-muted">{t("onb.agents.install")}</span>
            <CommandBlock command={option.install} />
            <span className="text-sm text-muted">{t("onb.agents.login")}</span>
            <CommandBlock command={option.login} />
          </li>
        ))}
        <li className="flex flex-col gap-1">
          <span className="text-sm font-medium">{t("onb.agents.key")}</span>
          <span className="text-sm">{t("onb.agents.keyDesc")}</span>
        </li>
        <li className="flex flex-col gap-1">
          <span className="text-sm font-medium">{t("onb.agents.ollama")}</span>
          <span className="text-sm">{t("onb.agents.ollamaDesc")}</span>
          <CommandBlock command={OLLAMA_PULL} />
        </li>
      </ul>
      <p className="text-sm text-muted">{t("onb.agents.optional")}</p>
    </div>
  );
}
