import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithSettingsCore } from "../routes/settings-test-utils";
import { OnboardingFlow } from "./onboarding";
import { pollConfig } from "./parts";

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("citegeist.lang", "en");
});

const offline = (id: string) => ({
  id,
  kind: "subscription-cli" as const,
  label: id,
  available: false,
  detail: "not-installed",
});

describe("uv is missing", () => {
  it("explains both install commands, copies them and checks again", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    pollConfig.ms = 5;
    const { state } = renderWithSettingsCore(<OnboardingFlow onDone={() => {}} />, {
      worker: { ready: false, engines: {}, detail: "uv-missing" },
    });
    const help = await screen.findByTestId("uv-help");
    expect(within(help).getByText("brew install uv")).toBeVisible();
    expect(within(help).getByText("curl -LsSf https://astral.sh/uv/install.sh | sh")).toBeVisible();
    expect(within(help).getByText(/you can still add and read PDFs/)).toBeVisible();
    expect(screen.getByTestId("worker-status")).toHaveTextContent("uv missing");
    expect(screen.getByRole("button", { name: "Install" })).toBeDisabled();

    await user.click(within(help).getAllByRole("button", { name: "Copy" })[0] as HTMLElement);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("brew install uv"));

    state.worker = { ready: false, engines: {}, detail: "not-installed" };
    await user.click(within(help).getByRole("button", { name: "Check again" }));
    await waitFor(() => expect(screen.queryByTestId("uv-help")).toBeNull());
    expect(screen.getByRole("button", { name: "Install" })).toBeEnabled();
  });
});

describe("no AI backend", () => {
  it("lists the agent CLIs with install and login commands, the API key and Ollama", async () => {
    renderWithSettingsCore(<OnboardingFlow onDone={() => {}} />, {
      backends: [offline("claude-code-cli"), offline("codex-exec")],
    });
    const help = await screen.findByTestId("backend-help");
    for (const command of [
      "curl -fsSL https://claude.ai/install.sh | bash",
      "claude auth login",
      "npm install -g @openai/codex",
      "codex login",
      "agent login",
      "ollama pull llama3.2",
    ]) {
      expect(within(help).getByText(command)).toBeVisible();
    }
    expect(within(help).getByText("API key")).toBeVisible();
    expect(within(help).getByText("Ollama")).toBeVisible();
  });

  it("stays away while a backend works", async () => {
    renderWithSettingsCore(<OnboardingFlow onDone={() => {}} />, {
      routing: { "*": "codex-exec" },
    });
    await screen.findAllByTestId("backend");
    expect(screen.queryByTestId("backend-help")).toBeNull();
  });
});
