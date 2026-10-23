import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { pollConfig } from "../onboarding/parts";
import { SettingsScreen } from "./settings";
import { renderWithSettingsCore } from "./settings-test-utils";

beforeEach(() => localStorage.clear());

const backendRow = async (id: string) => {
  const rows = await screen.findAllByTestId("backend");
  const row = rows.find((r) => r.getAttribute("data-backend") === id);
  if (!row) throw new Error(`no row for ${id}`);
  return within(row);
};

describe("settings screen", () => {
  it("lists the backends with their status and a hint for what is missing", async () => {
    renderWithSettingsCore(<SettingsScreen />);
    expect(await screen.findByRole("heading", { level: 1, name: "Einstellungen" })).toBeVisible();
    const claude = await backendRow("claude-code-cli");
    expect(claude.getByText("Bereit")).toBeVisible();
    const codex = await backendRow("codex-exec");
    expect(codex.getByText("Nicht installiert")).toBeVisible();
    expect(codex.getByText(/npm install -g @openai\/codex/)).toBeVisible();
    const ollama = await backendRow("ollama");
    expect(ollama.getByText("Nicht erreichbar")).toBeVisible();
    expect(ollama.getByText("Starte Ollama und prüfe erneut.")).toBeVisible();
  });

  it("tests a backend and shows the latency", async () => {
    const user = userEvent.setup();
    const { calls } = renderWithSettingsCore(<SettingsScreen />);
    const claude = await backendRow("claude-code-cli");
    await user.click(claude.getByRole("button", { name: "Testen" }));
    expect(await claude.findByText("Funktioniert, Antwort nach 1.2 s")).toBeVisible();
    expect(calls.find((c) => c.name === "ai.testBackend")?.input).toEqual({
      backend: "claude-code-cli",
    });
  });

  it("shows the error and the fix when a test fails", async () => {
    const user = userEvent.setup();
    renderWithSettingsCore(<SettingsScreen />, {
      tests: {
        "codex-exec": {
          ok: false,
          error: {
            code: "AI_CLI_MISSING",
            message: "The `codex` command was not found on PATH.",
            fix: "Install the Codex CLI, then retry.",
          },
        },
      },
    });
    const codex = await backendRow("codex-exec");
    await user.click(codex.getByRole("button", { name: "Testen" }));
    expect(await codex.findByText(/The `codex` command was not found/)).toBeVisible();
    expect(codex.getByText("Install the Codex CLI, then retry.")).toBeVisible();
  });

  it("stores an API key without showing it again", async () => {
    const user = userEvent.setup();
    const { calls, state } = renderWithSettingsCore(<SettingsScreen />);
    const openai = await backendRow("openai");
    const field = openai.getByLabelText(/API-Schlüssel/);
    expect(field).toHaveAttribute("type", "password");
    await user.type(field, "sk-live-123456");
    await user.click(openai.getByRole("button", { name: "Schlüssel speichern" }));
    expect(await openai.findByText("Schlüssel liegt in der Keychain")).toBeVisible();
    expect(screen.queryByDisplayValue("sk-live-123456")).toBeNull();
    expect(state.apiKeys.openai).toBe(true);
    expect(calls.find((c) => c.name === "settings.update")?.input).toMatchObject({
      apiKey: { provider: "openai", key: "sk-live-123456" },
    });
    expect(openai.getByText("Bereit")).toBeVisible();

    await user.click(openai.getByRole("button", { name: "Schlüssel entfernen" }));
    await waitFor(() => expect(state.apiKeys.openai).toBe(false));
    expect(await openai.findByText("Kein Schlüssel")).toBeVisible();
  });

  it("changes the routing of a task and clears it again", async () => {
    const user = userEvent.setup();
    const { state } = renderWithSettingsCore(<SettingsScreen />);
    await user.click(await screen.findByRole("combobox", { name: "Zitate prüfen" }));
    await user.click(await screen.findByRole("option", { name: "Ollama" }));
    await waitFor(() =>
      expect(state.routing).toEqual({ "*": "claude-code-cli", "card.verify": "ollama" }),
    );
    await user.click(await screen.findByRole("combobox", { name: "Zitate prüfen" }));
    await user.click(await screen.findByRole("option", { name: "Standard" }));
    await waitFor(() => expect(state.routing).toEqual({ "*": "claude-code-cli" }));
  });

  it("switches the interface language and keeps it when the address changes", async () => {
    const user = userEvent.setup();
    const { state } = renderWithSettingsCore(<SettingsScreen />);
    await user.click(await screen.findByRole("button", { name: "English" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
    expect(state.uiLanguage).toBe("en");

    await user.type(screen.getByRole("textbox", { name: "Email address" }), "me@example.org");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Saved")).toBeVisible();
    expect(state.mailto).toBe("me@example.org");
    expect(state.uiLanguage).toBe("en");
  });

  it("reports an invalid contact address", async () => {
    const user = userEvent.setup();
    renderWithSettingsCore(<SettingsScreen />);
    await user.type(await screen.findByRole("textbox", { name: "E-Mail-Adresse" }), "nope");
    await user.click(screen.getByRole("button", { name: "Speichern" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("not an email address");
  });

  it("installs the worker, follows the progress and shows the engines", async () => {
    const user = userEvent.setup();
    renderWithSettingsCore(<SettingsScreen />, { setupPolls: 4 });
    pollConfig.ms = 40;
    const panel = await screen.findByTestId("worker-panel");
    expect(within(panel).getByTestId("worker-status")).toHaveTextContent("Nicht installiert");
    await user.click(within(panel).getByRole("button", { name: "Installieren" }));
    expect(await within(panel).findByRole("progressbar")).toBeVisible();
    expect(await within(panel).findByText("Installiere die Python-Umgebung")).toBeVisible();
    expect(await within(panel).findByText(/Engines: docling 2.0/)).toBeVisible();
    expect(within(panel).getByTestId("worker-status")).toHaveTextContent("Bereit");
    expect(within(panel).getByRole("button", { name: "Neu installieren" })).toBeEnabled();
  });

  it("shows a failed installation with its message", async () => {
    const user = userEvent.setup();
    renderWithSettingsCore(<SettingsScreen />, {
      setupError: { code: "WORKER_UV_MISSING", message: "The `uv` command was not found." },
    });
    const panel = await screen.findByTestId("worker-panel");
    await user.click(within(panel).getByRole("button", { name: "Installieren" }));
    expect(await within(panel).findByRole("alert")).toHaveTextContent("uv fehlt");
    expect(within(panel).getByRole("button", { name: "Installieren" })).toBeEnabled();
  });
});
