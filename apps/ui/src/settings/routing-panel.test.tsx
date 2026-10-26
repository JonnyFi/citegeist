import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { jobMessage } from "../components/job-status";
import { translator } from "../i18n";
import { formatUntil } from "../onboarding/parts";
import { SettingsScreen } from "../routes/settings";
import type { SettingsMockState } from "../routes/settings-mock";
import { renderWithSettingsCore } from "../routes/settings-test-utils";
import { ROUTED_TASKS } from "./routing-panel";

beforeEach(() => localStorage.clear());

type Backend = SettingsMockState["backends"][number];

const ready = (id: string, label: string, kind: Backend["kind"] = "subscription-cli"): Backend => ({
  id,
  kind,
  label,
  available: true,
  detail: "ready",
});

const THREE: Backend[] = [
  ready("claude-code-cli", "Claude Code CLI"),
  ready("codex-exec", "Codex CLI"),
  ready("cursor-cli", "Cursor CLI"),
  { id: "ollama", kind: "local", label: "Ollama", available: false, detail: "unreachable" },
];

const rows = async () =>
  (await screen.findAllByTestId("fallback-row")).map((r) => r.getAttribute("data-backend"));

describe("model panel: default and tasks", () => {
  it("offers only backends that are ready", async () => {
    const user = userEvent.setup();
    renderWithSettingsCore(<SettingsScreen />, {
      backends: [
        ready("claude-code-cli", "Claude Code CLI"),
        {
          id: "codex-exec",
          kind: "subscription-cli",
          label: "Codex CLI",
          available: false,
          detail: "logged-out",
        },
        ready("cursor-cli", "Cursor CLI"),
      ],
    });
    await user.click(await screen.findByRole("combobox", { name: "Standard für KI-Aufgaben" }));
    const options = (await screen.findAllByRole("option")).map((o) => o.textContent);
    expect(options).toEqual(["Claude Code CLI", "Cursor CLI"]);
  });

  it("writes the chosen default into the routing and keeps the task entries", async () => {
    const user = userEvent.setup();
    const { state, calls } = renderWithSettingsCore(<SettingsScreen />, {
      backends: THREE,
      routing: { "*": "claude-code-cli", "card.verify": "codex-exec" },
    });
    await user.click(await screen.findByRole("combobox", { name: "Standard für KI-Aufgaben" }));
    await user.click(await screen.findByRole("option", { name: "Cursor CLI" }));
    await waitFor(() =>
      expect(state.routing).toEqual({ "*": "cursor-cli", "card.verify": "codex-exec" }),
    );
    expect(calls.filter((c) => c.name === "settings.update").at(-1)?.input).toEqual({
      patch: { ai: { routing: { "*": "cursor-cli", "card.verify": "codex-exec" } } },
    });
  });

  it("shows a default that dropped out as unavailable instead of hiding it", async () => {
    renderWithSettingsCore(<SettingsScreen />, {
      routing: { "*": "codex-exec" },
      backends: [
        ready("claude-code-cli", "Claude Code CLI"),
        {
          id: "codex-exec",
          kind: "subscription-cli",
          label: "Codex CLI",
          available: false,
          detail: "logged-out",
        },
      ],
    });
    expect(
      await screen.findByRole("combobox", { name: "Standard für KI-Aufgaben" }),
    ).toHaveTextContent("Codex CLI (nicht verfügbar)");
  });

  it("keeps the per-task section closed and lists every task with a German label", async () => {
    const user = userEvent.setup();
    renderWithSettingsCore(<SettingsScreen />, { backends: THREE });
    const summary = await screen.findByText("Pro Aufgabe");
    expect(screen.getByRole("combobox", { name: "Zitate prüfen", hidden: true })).not.toBeVisible();
    await user.click(summary);
    const labels = [
      "Paraphrase und Art",
      "Zitate prüfen",
      "Metadaten von der ersten Seite",
      "Link-Vorschläge",
      "Begriffsbeschreibungen",
      "Begriffsnamen",
      "Literaturmatrix",
      "Suchanfragen für die Literatursuche",
    ];
    expect(ROUTED_TASKS).toHaveLength(labels.length);
    for (const label of labels) {
      expect(await screen.findByRole("combobox", { name: label })).toBeVisible();
    }
  });

  it("sets and clears the backend of a single task", async () => {
    const user = userEvent.setup();
    const { state } = renderWithSettingsCore(<SettingsScreen />, { backends: THREE });
    await user.click(await screen.findByText("Pro Aufgabe"));
    await user.click(await screen.findByRole("combobox", { name: "Literaturmatrix" }));
    await user.click(await screen.findByRole("option", { name: "Codex CLI" }));
    await waitFor(() =>
      expect(state.routing).toEqual({ "*": "claude-code-cli", "matrix.fillCell": "codex-exec" }),
    );
    await user.click(await screen.findByRole("combobox", { name: "Literaturmatrix" }));
    await user.click(await screen.findByRole("option", { name: "Standard" }));
    await waitFor(() => expect(state.routing).toEqual({ "*": "claude-code-cli" }));
  });

  it("says so when no backend is ready", async () => {
    renderWithSettingsCore(<SettingsScreen />, {
      backends: [{ ...ready("claude-code-cli", "Claude Code CLI"), available: false }],
    });
    expect(await screen.findByText(/Kein Backend ist bereit/)).toBeVisible();
  });
});

describe("model panel: fallback list", () => {
  it("lists the other ready backends, the active ones first and in their order", async () => {
    renderWithSettingsCore(<SettingsScreen />, {
      backends: THREE,
      fallback: ["cursor-cli", "claude-code-cli"],
    });
    // The default backend does not appear as its own fallback; Codex is off.
    expect(await rows()).toEqual(["cursor-cli", "codex-exec"]);
    const list = screen.getByRole("list", { name: "Reihenfolge der Ausweichziele" });
    expect(within(list).getByRole("checkbox", { name: "Cursor CLI" })).toBeChecked();
    expect(within(list).getByRole("checkbox", { name: "Codex CLI" })).not.toBeChecked();
    expect(within(list).queryByRole("button", { name: "Codex CLI nach oben" })).toBeNull();
  });

  it("switches an entry on at the end and off again, keeping unavailable ids", async () => {
    const user = userEvent.setup();
    const { state } = renderWithSettingsCore(<SettingsScreen />, {
      backends: THREE,
      fallback: ["cursor-cli", "ollama"],
    });
    await user.click(await screen.findByRole("checkbox", { name: "Codex CLI" }));
    await waitFor(() => expect(state.fallback).toEqual(["cursor-cli", "codex-exec", "ollama"]));
    await user.click(await screen.findByRole("checkbox", { name: "Cursor CLI" }));
    await waitFor(() => expect(state.fallback).toEqual(["codex-exec", "ollama"]));
    expect(await rows()).toEqual(["codex-exec", "cursor-cli"]);
  });

  it("moves an entry up and down", async () => {
    const user = userEvent.setup();
    const { state } = renderWithSettingsCore(<SettingsScreen />, {
      backends: THREE,
      fallback: ["cursor-cli", "codex-exec"],
    });
    expect(await screen.findByRole("button", { name: "Cursor CLI nach oben" })).toBeDisabled();
    await user.click(await screen.findByRole("button", { name: "Codex CLI nach oben" }));
    await waitFor(() => expect(state.fallback).toEqual(["codex-exec", "cursor-cli"]));
    expect(await rows()).toEqual(["codex-exec", "cursor-cli"]);
    expect(screen.getByRole("button", { name: "Cursor CLI nach unten" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Codex CLI nach unten" }));
    await waitFor(() => expect(state.fallback).toEqual(["cursor-cli", "codex-exec"]));
  });

  it("follows a change of the default: the old default becomes a candidate", async () => {
    const user = userEvent.setup();
    renderWithSettingsCore(<SettingsScreen />, { backends: THREE, fallback: ["cursor-cli"] });
    expect(await rows()).toEqual(["cursor-cli", "codex-exec"]);
    await user.click(await screen.findByRole("combobox", { name: "Standard für KI-Aufgaben" }));
    await user.click(await screen.findByRole("option", { name: "Cursor CLI" }));
    await waitFor(async () => expect(await rows()).toEqual(["claude-code-cli", "codex-exec"]));
  });

  it("says so when there is no other backend", async () => {
    renderWithSettingsCore(<SettingsScreen />, { backends: [THREE[0] as Backend] });
    expect(
      await screen.findByText("Es gibt kein weiteres Backend, das einspringen kann."),
    ).toBeVisible();
  });
});

describe("model panel: paused backends", () => {
  const until = new Date(Date.now() + 90 * 60_000).toISOString();

  it("shows the pause in the fallback list and in the backend list", async () => {
    renderWithSettingsCore(<SettingsScreen />, {
      backends: THREE.map((b) =>
        b.id === "cursor-cli" ? { ...b, paused: { kind: "limit" as const, until } } : b,
      ),
      fallback: ["cursor-cli"],
    });
    const row = (await screen.findAllByTestId("fallback-row"))[0] as HTMLElement;
    expect(row).toHaveTextContent(/Pausiert bis .+, Limit erreicht/);
    const backend = (await screen.findAllByTestId("backend")).find(
      (r) => r.getAttribute("data-backend") === "cursor-cli",
    ) as HTMLElement;
    expect(within(backend).getByTestId("backend-paused")).toHaveTextContent(
      /Pausiert bis .+, Limit erreicht/,
    );
  });

  it("formats a pause today as a time and a later pause with the weekday", () => {
    const now = new Date("2026-10-27T10:00:00");
    expect(formatUntil("2026-10-27T14:30:00", "de", now)).toBe("14:30");
    expect(formatUntil("2026-10-29T09:05:00", "de", now)).toMatch(/^Do\.? 09:05$/);
    expect(formatUntil("2026-10-29T09:05:00", "en", now)).toMatch(/^Thu 09:05/);
  });
});

describe("job note for a backend switch", () => {
  it("reads as a sentence in both languages and leaves other messages alone", () => {
    const note = "ai-fallback:claude-code-cli:cursor-cli:limit";
    expect(jobMessage(translator("de").t, note)).toBe("weiter mit Cursor, Claude-Limit erreicht");
    expect(jobMessage(translator("en").t, note)).toBe(
      "continuing with Cursor, Claude limit reached",
    );
    expect(jobMessage(translator("de").t, "ai-fallback:codex-exec:cursor-cli:auth")).toBe(
      "weiter mit Cursor, Codex nicht angemeldet",
    );
    expect(jobMessage(translator("de").t, "resumed after restart")).toBe("resumed after restart");
  });
});
