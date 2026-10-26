/** Short names of the AI backends for running text, such as the note of a job that moved on. */
const SHORT_NAMES: Record<string, string> = {
  "claude-code-cli": "Claude",
  "codex-exec": "Codex",
  "cursor-cli": "Cursor",
  ollama: "Ollama",
  openai: "OpenAI",
  anthropic: "Anthropic",
  openrouter: "OpenRouter",
  xai: "xAI",
};

export function backendShortName(id: string): string {
  return SHORT_NAMES[id] ?? id;
}
