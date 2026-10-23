import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CitegeistBridge } from "../bridge";
import { I18nProvider } from "../i18n";
import { renderWithSettingsCore } from "../routes/settings-test-utils";
import { FirstRun, isOnboardingDone, OnboardingFlow, OnboardingGate } from "./onboarding";
import { pollConfig } from "./parts";

beforeEach(() => localStorage.clear());

const inApp = (ui: ReactNode) => <I18nProvider>{ui}</I18nProvider>;
const offline = (id: string) => ({
  id,
  kind: "subscription-cli" as const,
  label: id,
  available: false,
  detail: "not-installed",
});

function fakeBridge(): CitegeistBridge & {
  openLibrary: ReturnType<typeof vi.fn>;
  createLibrary: ReturnType<typeof vi.fn>;
} {
  return {
    connection: null,
    openLibrary: vi.fn(async () => true),
    createLibrary: vi.fn(async () => true),
    onNavigate: () => () => {},
    platform: "darwin",
  };
}

describe("first run without a library", () => {
  it("creates or opens a library through the bridge, in German", async () => {
    localStorage.setItem("citegeist.lang", "de");
    const user = userEvent.setup();
    const bridge = fakeBridge();
    render(inApp(<FirstRun bridge={bridge} fallback={<p>welcome</p>} />));
    expect(screen.getByRole("heading", { level: 1, name: "citegeist einrichten" })).toBeVisible();
    expect(screen.getByText("Schritt 1 von 3")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Neue Bibliothek" }));
    expect(bridge.createLibrary).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "Bibliothek öffnen" }));
    expect(bridge.openLibrary).toHaveBeenCalledOnce();
  });

  it("switches to English and remembers the choice", async () => {
    localStorage.setItem("citegeist.lang", "de");
    const user = userEvent.setup();
    render(inApp(<FirstRun bridge={fakeBridge()} fallback={<p>welcome</p>} />));
    await user.click(screen.getByRole("button", { name: "English" }));
    expect(screen.getByRole("heading", { level: 1, name: "Set up citegeist" })).toBeVisible();
    expect(screen.getByRole("button", { name: "New library" })).toBeVisible();
    expect(localStorage.getItem("citegeist.lang")).toBe("en");
  });

  it("skips to the welcome screen and does not come back", async () => {
    const user = userEvent.setup();
    const { unmount } = render(inApp(<FirstRun bridge={fakeBridge()} fallback={<p>welcome</p>} />));
    await user.click(screen.getByRole("button", { name: /Später einrichten|Set up later/ }));
    expect(screen.getByText("welcome")).toBeVisible();
    expect(isOnboardingDone()).toBe(true);
    unmount();
    render(inApp(<FirstRun bridge={fakeBridge()} fallback={<p>welcome</p>} />));
    expect(screen.getByText("welcome")).toBeVisible();
  });
});

describe("backend and worker steps", () => {
  it("picks a backend, tests it, installs the worker and finishes", async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    const { calls, state } = renderWithSettingsCore(<OnboardingFlow onDone={onDone} />, {
      routing: { "*": "ollama" },
    });
    expect(await screen.findByText("Schritt 2 von 3")).toBeVisible();
    const proceed = screen.getByRole("button", { name: "Weiter" });
    expect(proceed).toBeDisabled();

    const rows = await screen.findAllByTestId("backend");
    const claude = within(
      rows.find((r) => r.getAttribute("data-backend") === "claude-code-cli") as HTMLElement,
    );
    const codex = within(
      rows.find((r) => r.getAttribute("data-backend") === "codex-exec") as HTMLElement,
    );
    expect(codex.getByRole("button", { name: "Dieses Backend verwenden" })).toBeDisabled();

    await user.click(claude.getByRole("button", { name: "Dieses Backend verwenden" }));
    await waitFor(() => expect(state.routing["*"]).toBe("claude-code-cli"));
    expect(await claude.findByRole("button", { name: "Aktiv" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Weiter" })).toBeDisabled();

    await user.click(claude.getByRole("button", { name: "Testen" }));
    expect(await claude.findByText(/Funktioniert, Antwort nach/)).toBeVisible();
    await waitFor(() => expect(screen.getByRole("button", { name: "Weiter" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Weiter" }));

    expect(await screen.findByText("Schritt 3 von 3")).toBeVisible();
    expect(screen.getByRole("heading", { level: 2, name: "Konvertierung" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Später" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Installieren" }));
    expect(await screen.findByText(/Engines: docling/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Fertig" }));
    expect(onDone).toHaveBeenCalledOnce();
    expect(calls.map((c) => c.name)).toEqual(
      expect.arrayContaining(["ai.testBackend", "worker.setup"]),
    );
  });

  it("runs in English when the saved language is English and can go back", async () => {
    const user = userEvent.setup();
    renderWithSettingsCore(<OnboardingFlow onDone={() => {}} />, { uiLanguage: "en" });
    expect(await screen.findByText("Step 2 of 3")).toBeVisible();
    expect(screen.getByRole("heading", { level: 2, name: "AI backend" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Later" }));
    expect(await screen.findByText("Step 3 of 3")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByText("Step 2 of 3")).toBeVisible();
  });

  it("changes the language from the first screen of the flow", async () => {
    const user = userEvent.setup();
    const { state } = renderWithSettingsCore(<OnboardingFlow onDone={() => {}} />);
    await user.click(await screen.findByRole("button", { name: "English" }));
    expect(await screen.findByText("Step 2 of 3")).toBeVisible();
    expect(state.uiLanguage).toBe("en");
  });
});

describe("OnboardingGate", () => {
  it("shows the flow until it is finished, then the app", async () => {
    pollConfig.ms = 5;
    const user = userEvent.setup();
    renderWithSettingsCore(
      <OnboardingGate>
        <p>the app</p>
      </OnboardingGate>,
      { backends: [offline("claude-code-cli"), offline("codex-exec")] },
    );
    expect(await screen.findByText("Schritt 2 von 3")).toBeVisible();
    expect(screen.queryByText("the app")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Später" }));
    await user.click(await screen.findByRole("button", { name: "Später" }));
    expect(await screen.findByText("the app")).toBeVisible();
    expect(isOnboardingDone()).toBe(true);
  });

  it("shows the app at once when a backend works", async () => {
    renderWithSettingsCore(
      <OnboardingGate>
        <p>the app</p>
      </OnboardingGate>,
    );
    expect(await screen.findByText("the app")).toBeVisible();
    expect(screen.queryByText("Schritt 2 von 3")).toBeNull();
  });

  it("keeps the flow open when a backend starts to work in the middle of it", async () => {
    const user = userEvent.setup();
    const { state } = renderWithSettingsCore(
      <OnboardingGate>
        <p>the app</p>
      </OnboardingGate>,
      { backends: [offline("claude-code-cli")] },
    );
    expect(await screen.findByText("Schritt 2 von 3")).toBeVisible();
    const backend = state.backends[0];
    if (backend) backend.available = true;
    await user.click(screen.getByRole("button", { name: "Erneut prüfen" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Aktiv" })).toBeEnabled());
    expect(screen.getByText("Schritt 2 von 3")).toBeVisible();
    expect(screen.queryByText("the app")).toBeNull();
  });

  it("goes straight to the app once the setup was done", async () => {
    localStorage.setItem("citegeist.onboarding", "done");
    renderWithSettingsCore(
      <OnboardingGate>
        <p>the app</p>
      </OnboardingGate>,
    );
    expect(screen.getByText("the app")).toBeVisible();
  });
});
