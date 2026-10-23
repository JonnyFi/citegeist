import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { createReflowFixtures, renderApp } from "../test-utils";
import { publishChatSelection } from "./context";

afterEach(() => publishChatSelection(null));

async function openPanel(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Chat öffnen oder schließen" }));
  return screen.findByTestId("chat-panel");
}

const composer = () => screen.getByRole("textbox", { name: "Nachricht an den Agent" });

describe("chat panel", () => {
  it("opens from the shell, lists the agents and shows the empty state", async () => {
    const user = userEvent.setup();
    renderApp("/");
    expect(screen.queryByTestId("chat-panel")).not.toBeInTheDocument();
    const panel = await openPanel(user);
    expect(within(panel).getByText("Frag den Agent")).toBeVisible();

    await user.click(await within(panel).findByRole("combobox", { name: "Agent" }));
    expect(await screen.findByRole("option", { name: "Claude Code" })).toBeVisible();
    expect(screen.getByRole("option", { name: "Codex (nicht bereit)" })).toBeVisible();
    expect(screen.getByRole("option", { name: "Cursor" })).toBeVisible();
    await user.click(screen.getByRole("option", { name: "Cursor" }));
    await user.type(composer(), "Hallo");
    await user.click(screen.getByRole("button", { name: "Senden" }));
    await waitFor(() => expect(screen.getAllByTestId("chat-turn")).toHaveLength(1));
  });

  it("starts the session with the open source and sends the message with its context", async () => {
    const user = userEvent.setup();
    const { calls } = renderApp("/items/luhmann1984soziale");
    const panel = await openPanel(user);
    expect(within(panel).getByTestId("chat-chip-item")).toHaveTextContent(
      "Quelle luhmann1984soziale",
    );

    await user.type(composer(), "Was sagt Luhmann zu Kommunikation?");
    await user.click(within(panel).getByRole("button", { name: "Senden" }));

    await waitFor(() => expect(calls.find((c) => c.name === "chat.send")).toBeDefined());
    expect(calls.find((c) => c.name === "chat.start")?.input).toEqual({
      backend: "claude-code",
      item: "luhmann1984soziale",
    });
    expect(calls.find((c) => c.name === "chat.send")?.input).toMatchObject({
      message: "Was sagt Luhmann zu Kommunikation?",
      context: { item: "luhmann1984soziale" },
    });
    // The question is shown at once; the composer is empty again.
    const transcript = await within(panel).findByRole("list", { name: "Verlauf des Gesprächs" });
    expect(within(transcript).getByText("Was sagt Luhmann zu Kommunikation?")).toBeVisible();
    expect(composer()).toHaveValue("");
  });

  it("streams the answer with a tool line and clickable citations, and marks an unknown one", async () => {
    const user = userEvent.setup();
    const { history, data } = renderApp("/items/luhmann1984soziale", createReflowFixtures());
    const panel = await openPanel(user);
    await user.type(composer(), "Fass das zusammen");
    await user.click(within(panel).getByRole("button", { name: "Senden" }));

    const tool = await within(panel).findByTestId("chat-tool");
    expect(tool).toHaveTextContent("search");

    const card = data.cards[0]?.frontmatter.id ?? "";
    const cardLink = await within(panel).findByRole("link", {
      name: /Luhmann 1984, S\. .* öffnen/,
    });
    const sourceLink = within(panel).getByRole("link", { name: "Luhmann 1984 öffnen" });
    expect(sourceLink).toHaveAttribute(
      "href",
      expect.stringContaining("/items/luhmann1984soziale"),
    );
    // A citation that matches nothing stored is marked, not linked.
    expect(await within(panel).findByText("Erfunden 2020")).toHaveClass("text-danger");
    expect(within(panel).queryByRole("link", { name: /Erfunden/ })).not.toBeInTheDocument();
    // The stream is complete when the working indicator is gone.
    await waitFor(() =>
      expect(within(panel).queryByText("Der Agent arbeitet")).not.toBeInTheDocument(),
    );

    await user.click(cardLink);
    await waitFor(() => expect(history.location.search).toMatch(/tab=read/));
    expect(history.location.search).toContain(`card=${card}`);
  });

  it("offers an undo for the files an agent turn changed", async () => {
    const user = userEvent.setup();
    const { calls } = renderApp("/");
    const panel = await openPanel(user);
    await user.type(composer(), "Bitte notiere diese Verbindung");
    await user.click(within(panel).getByRole("button", { name: "Senden" }));

    const edits = await within(panel).findByTestId("chat-edits");
    expect(edits).toHaveTextContent("1 Datei geändert");
    expect(edits).toHaveTextContent("notes/chat-1.md");
    const undo = within(edits).getByRole("button", { name: /Änderungen dieses Zuges rückgängig/ });
    await user.click(undo);

    expect(await within(panel).findByText("Zurückgenommen")).toBeVisible();
    expect(calls.find((c) => c.name === "chat.revertTurn")?.input).toMatchObject({ turn: 1 });
    expect(within(panel).queryByRole("button", { name: /rückgängig/ })).not.toBeInTheDocument();
  });

  it("lets the user take context chips out and adds the marked passage", async () => {
    const user = userEvent.setup();
    const { calls } = renderApp("/items/luhmann1984soziale");
    const panel = await openPanel(user);
    act(() =>
      publishChatSelection({
        citekey: "luhmann1984soziale",
        text: "Kommunikation ...",
        page: "31",
      }),
    );
    expect(await within(panel).findByTestId("chat-chip-selection")).toHaveTextContent(
      "Markierung, S. 31",
    );

    await user.click(
      within(panel).getByRole("button", { name: /Quelle luhmann1984soziale aus dem Kontext/ }),
    );
    expect(within(panel).queryByTestId("chat-chip-item")).not.toBeInTheDocument();

    await user.type(composer(), "Erkläre die Stelle");
    await user.click(within(panel).getByRole("button", { name: "Senden" }));
    await waitFor(() => expect(calls.find((c) => c.name === "chat.send")).toBeDefined());
    expect(calls.find((c) => c.name === "chat.send")?.input).toMatchObject({
      context: { selection: { citekey: "luhmann1984soziale", page: "31" } },
    });
    const sent = calls.find((c) => c.name === "chat.send")?.input as { context: object };
    expect(sent.context).not.toHaveProperty("item");
  });

  it("stops a running turn", async () => {
    const user = userEvent.setup();
    const { calls } = renderApp("/", undefined, { aiDelayMs: 3000 });
    const panel = await openPanel(user);
    await user.type(composer(), "Lange Frage");
    await user.click(within(panel).getByRole("button", { name: "Senden" }));
    await user.click(await within(panel).findByRole("button", { name: "Stoppen" }));
    expect(await within(panel).findByText("Abgebrochen")).toBeVisible();
    expect(calls.some((c) => c.name === "chat.cancel")).toBe(true);
    expect(within(panel).queryByRole("button", { name: "Stoppen" })).not.toBeInTheDocument();
  });

  it("saves the transcript and reopens earlier conversations", async () => {
    const user = userEvent.setup();
    renderApp("/");
    const panel = await openPanel(user);
    await user.type(composer(), "Erste Frage");
    await user.click(within(panel).getByRole("button", { name: "Senden" }));
    await waitFor(() =>
      expect(within(panel).queryByText("Der Agent arbeitet")).not.toBeInTheDocument(),
    );
    expect(await within(panel).findByTestId("chat-answer")).toBeVisible();

    await user.click(within(panel).getByRole("button", { name: "Gespräch als Datei sichern" }));
    expect(await within(panel).findByText(/Gesichert in chats\/.*erste-frage\.md/)).toBeVisible();

    await user.click(within(panel).getByRole("button", { name: "Neues Gespräch beginnen" }));
    expect(await within(panel).findByText("Frag den Agent")).toBeVisible();
    await user.click(await within(panel).findByRole("combobox", { name: "Gespräche" }));
    await user.click(await screen.findByRole("option", { name: "Erste Frage" }));
    expect(await within(panel).findByTestId("chat-turn")).toBeVisible();
  });

  it("speaks English", async () => {
    const user = userEvent.setup();
    renderApp("/", undefined, { lang: "en" });
    await user.click(await screen.findByRole("button", { name: "Open or close the chat" }));
    const panel = await screen.findByTestId("chat-panel");
    expect(within(panel).getByText("Ask the agent")).toBeVisible();
    expect(within(panel).getByRole("tab", { name: "Research" })).toBeVisible();
  });
});

describe("research jobs", () => {
  it("starts a job, shows its progress and links to the inbox where the finds wait", async () => {
    const user = userEvent.setup();
    const { calls, data } = renderApp("/projects/phd-proposal");
    const panel = await openPanel(user);
    await user.click(within(panel).getByRole("tab", { name: "Recherche" }));
    expect(await within(panel).findByText("Noch keine Recherche")).toBeVisible();

    await user.type(
      within(panel).getByRole("textbox", { name: "Thema der Recherche" }),
      "Plattformkritik und Ranking",
    );
    await user.click(within(panel).getByRole("button", { name: "Recherche starten" }));

    const job = await within(panel).findByTestId("research-job");
    expect(job).toHaveTextContent("Plattformkritik und Ranking");
    expect(calls.find((c) => c.name === "research.start")?.input).toMatchObject({
      prompt: "Plattformkritik und Ranking",
      maxItems: 10,
      project: "phd-proposal",
    });
    await waitFor(() => expect(within(job).getByText("fertig")).toBeVisible(), { timeout: 5000 });
    expect(within(job).getByText("3 Quellen in der Inbox")).toBeVisible();
    expect(data.items.get("rieder2020engines")?.frontmatter.inbox).toMatchObject({
      by: "agent:claude-code",
    });

    await user.click(within(job).getByRole("link", { name: "Zur Inbox" }));
    expect(await screen.findAllByTestId("inbox-row")).toHaveLength(6);
  });

  it("opens the transcript of a finished job in the chat tab", async () => {
    const user = userEvent.setup();
    renderApp("/");
    const panel = await openPanel(user);
    await user.click(within(panel).getByRole("tab", { name: "Recherche" }));
    await user.type(
      within(panel).getByRole("textbox", { name: "Thema der Recherche" }),
      "Systemtheorie",
    );
    await user.click(within(panel).getByRole("button", { name: "Recherche starten" }));
    const job = await within(panel).findByTestId("research-job");
    await waitFor(() => expect(within(job).getByText("fertig")).toBeVisible(), { timeout: 5000 });

    await user.click(within(job).getByRole("button", { name: "Verlauf ansehen" }));
    expect(await within(panel).findAllByTestId("chat-tool")).toHaveLength(3);
    expect(within(panel).getByRole("tab", { name: "Chat" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});
