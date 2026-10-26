import { linksCreate } from "@citegeist/ops";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { createReflowFixtures, renderApp } from "../test-utils";

const READER = "/items/luhmann1984soziale?tab=read";
const HABERMAS = "habermas1981theorie";

async function openReader(options = {}) {
  const view = renderApp(READER, createReflowFixtures(), options);
  await screen.findByTestId("reflow-scroll");
  await screen.findAllByTestId("panel-card");
  return view;
}

/** Opens the first card of the column and returns its editor. */
async function openFirstCard(user: ReturnType<typeof userEvent.setup>) {
  const row = screen.getAllByTestId("panel-card")[0] as HTMLElement;
  await user.click(within(row).getByRole("button", { expanded: false }));
  return screen.findByTestId("card-editor");
}

describe("card without connections", () => {
  it("shows no connection line and no suggestion, and keeps its action bar to one extra cell", async () => {
    const user = userEvent.setup();
    await openReader();
    expect(screen.queryByTestId("card-connections")).toBeNull();
    expect(screen.queryByTestId("card-suggestion")).toBeNull();
    const editor = await openFirstCard(user);
    expect(within(editor).queryByTestId("card-connections")).toBeNull();
    expect(within(editor).queryByRole("button", { name: "Verbinden" })).toBeNull();
    expect(within(editor).queryByRole("button", { name: "An den Agent" })).toBeNull();
    // the two quote actions stay where they were; the menu is the third cell of the same bar
    const more = within(editor).getByRole("button", { name: "Weitere Aktionen" });
    expect(more.parentElement).toContainElement(
      within(editor).getByRole("button", { name: "Wörtlich zitieren" }),
    );
  });
});

describe("Verbinden", () => {
  it("connects a card with a source as a contradiction and shows it in one line", async () => {
    const user = userEvent.setup();
    const { calls, data } = await openReader();
    const cardId = data.cards[0]?.frontmatter.id as string;
    const editor = await openFirstCard(user);

    await user.click(within(editor).getByRole("button", { name: "Weitere Aktionen" }));
    await user.click(await screen.findByRole("menuitem", { name: "Verbinden" }));

    const search = await screen.findByRole("combobox", { name: "Verbinden mit" });
    await user.type(search, "Habermas");
    await user.click(
      await screen.findByRole("option", { name: /Theorie des kommunikativen Handelns/ }),
    );

    await user.click(screen.getByRole("combobox", { name: "Beziehung" }));
    await user.click(await screen.findByRole("option", { name: "widerspricht" }));
    await user.type(screen.getByLabelText("Warum"), "Habermas setzt auf Verständigung");
    await user.click(screen.getByRole("button", { name: "Verbinden", hidden: false }));

    await waitFor(() =>
      expect(calls.find((c) => c.name === "links.create")?.input).toEqual({
        from: cardId,
        link: { to: `[[${HABERMAS}]]`, rel: "opposes", why: "Habermas setzt auf Verständigung" },
      }),
    );
    const line = await within(editor).findByTestId("card-connections");
    expect(line).toHaveTextContent("widerspricht · Habermas 1981");
    expect(screen.queryByRole("dialog", { name: "Karte verbinden" })).toBeNull();

    // the reader can take the connection away again
    await user.click(within(line).getByRole("button", { expanded: false }));
    await user.click(
      within(line).getByRole("button", { name: "Verbindung zu Habermas 1981 entfernen" }),
    );
    await waitFor(() => expect(within(editor).queryByTestId("card-connections")).toBeNull());
    expect(calls.find((c) => c.name === "links.remove")?.input).toEqual({
      from: cardId,
      to: `[[${HABERMAS}]]`,
      rel: "opposes",
    });
  });

  it("folds several connections into one line with their number", async () => {
    const user = userEvent.setup();
    const { core, data } = await openReader();
    const cardId = data.cards[0]?.frontmatter.id as string;
    await core.call(linksCreate, {
      from: cardId,
      link: { to: `[[${HABERMAS}]]`, rel: "opposes" },
    });
    await core.call(linksCreate, {
      from: cardId,
      link: { to: "[[latour2005reassembling]]", rel: "related" },
    });
    const line = await screen.findByTestId("card-connections");
    expect(line).toHaveTextContent("2 Verbindungen");
    await user.click(within(line).getByRole("button", { expanded: false }));
    expect(within(line).getByText("Habermas 1981")).toBeVisible();
    expect(within(line).getByText("Latour 2005")).toBeVisible();
  });

  it("shows the connection in the Connections tab of the target and of the source", async () => {
    const user = userEvent.setup();
    const { core, data } = await openReader();
    const cardId = data.cards[0]?.frontmatter.id as string;
    await core.call(linksCreate, {
      from: cardId,
      link: { to: `[[${HABERMAS}]]`, rel: "opposes", why: "Gegenposition" },
    });
    await user.click(await screen.findByRole("tab", { name: "Verbindungen" }));
    const panel = await screen.findByTestId("connections");
    const fromCards = await within(panel).findByTestId("card-links");
    expect(within(fromCards).getByText("widerspricht")).toBeVisible();
    expect(within(fromCards).getByText("Habermas 1981")).toBeVisible();
    expect(within(fromCards).getByText("Gegenposition")).toBeVisible();
  });
});

describe("suggestion line", () => {
  async function withSuggestion() {
    const user = userEvent.setup();
    const view = await openReader();
    const cardId = view.data.cards[0]?.frontmatter.id as string;
    await view.core.call(linksCreate, {
      from: cardId,
      link: {
        to: `[[${HABERMAS}]]`,
        rel: "opposes",
        why: "Die Karte nennt Habermas.",
        status: "proposed",
      },
    });
    const line = await screen.findByTestId("card-suggestion");
    return { user, line, ...view };
  }

  it("is one subtle line that expands to accept or dismiss", async () => {
    const { user, line } = await withSuggestion();
    expect(line).toHaveTextContent("Vorschlag: widerspricht Habermas 1981");
    expect(within(line).queryByRole("button", { name: "Übernehmen" })).toBeNull();
    await user.click(within(line).getByRole("button", { expanded: false }));
    expect(within(line).getByText("Die Karte nennt Habermas.")).toBeVisible();
    expect(within(line).getByRole("button", { name: "Übernehmen" })).toBeVisible();
    expect(within(line).getByRole("button", { name: "Verwerfen" })).toBeVisible();
  });

  it("turns into a connection when accepted", async () => {
    const { user, line, calls } = await withSuggestion();
    await user.click(within(line).getByRole("button", { expanded: false }));
    await user.click(within(line).getByRole("button", { name: "Übernehmen" }));
    await waitFor(() => expect(screen.queryByTestId("card-suggestion")).toBeNull());
    expect(calls.find((c) => c.name === "links.decide")?.input).toMatchObject({
      accept: [0],
      reject: [],
    });
    expect(await screen.findByTestId("card-connections")).toHaveTextContent(
      "widerspricht · Habermas 1981",
    );
  });

  it("disappears when dismissed, and leaves no connection", async () => {
    const { user, line, calls } = await withSuggestion();
    await user.click(within(line).getByRole("button", { expanded: false }));
    await user.click(within(line).getByRole("button", { name: "Verwerfen" }));
    await waitFor(() => expect(screen.queryByTestId("card-suggestion")).toBeNull());
    expect(calls.find((c) => c.name === "links.decide")?.input).toMatchObject({
      accept: [],
      reject: [0],
    });
    expect(screen.queryByTestId("card-connections")).toBeNull();
  });
});

describe("An den Agent", () => {
  it("puts the card into the chat as a context chip and focuses the composer", async () => {
    const user = userEvent.setup();
    await openReader();
    const editor = await openFirstCard(user);
    await user.click(within(editor).getByRole("button", { name: "Weitere Aktionen" }));
    await user.click(await screen.findByRole("menuitem", { name: "An den Agent" }));

    const chip = await screen.findByTestId("chat-chip-selection");
    expect(chip).toHaveTextContent("Karte, S. 31");
    await waitFor(() => expect(screen.getByRole("textbox", { name: /Nachricht/ })).toHaveFocus());
  });
});
