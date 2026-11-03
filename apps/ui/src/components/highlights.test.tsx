import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { MockData } from "../mock/fixtures";
import { storeFor } from "../notes/mock";
import { createReflowFixtures, renderApp } from "../test-utils";

const READER = "/items/luhmann1984soziale?tab=read";
const PASSAGE =
  "beobachtet immer schon eine Operation, die sich an frueheren Operationen orientiert";

/** Selects text inside one block of the reflow document, as the user would with the mouse. */
async function select(blockId: string, text: string) {
  const node = document.getElementById(blockId)?.firstChild;
  if (!node) throw new Error(`block ${blockId} is not rendered`);
  const start = (node.textContent ?? "").indexOf(text);
  expect(start).toBeGreaterThanOrEqual(0);
  window.getSelection()?.setBaseAndExtent(node, start, node, start + text.length);
  await act(async () => {
    document.dispatchEvent(new Event("selectionchange"));
    await new Promise((r) => setTimeout(r, 200));
  });
}

async function openReader(data: MockData = createReflowFixtures(), options = {}) {
  const view = renderApp(READER, data, options);
  await screen.findByTestId("reflow-scroll");
  await screen.findAllByTestId("panel-card");
  return view;
}

const cardOf = (data: MockData, start: string) => {
  const card = data.cards.find((c) => c.body.quote.startsWith(start));
  if (!card) throw new Error(`fixture card '${start}' missing`);
  return card;
};

/** The reader's cards, two of them marked: yellow with a tag, green with another. */
function markedFixtures(): MockData {
  const data = createReflowFixtures();
  const a = cardOf(data, "Soziale Systeme bestehen");
  a.frontmatter = { ...a.frontmatter, color: "yellow", tags: ["Methode"] };
  const b = cardOf(data, "Es gibt selbstreferentielle");
  b.frontmatter = { ...b.frontmatter, color: "green", tags: ["Methode", "Theorie"] };
  const c = cardOf(data, "Doppelte Kontingenz");
  c.frontmatter = { ...c.frontmatter, color: "yellow", tags: [] };
  return data;
}

const rows = () => screen.getAllByTestId("panel-card");

describe("selection popover colours", () => {
  // protects=the popover is one row with Zitat (KI) first, then four colour dots; fails_when=a dot is missing or an inactive placeholder returns;
  // no_claim=says nothing about the look of the dots
  it("offers Zitat (KI) first and four colour dots, nothing else", async () => {
    await openReader();
    await select("bpara0002", PASSAGE);
    const bar = await screen.findByRole("toolbar", { name: "Aktionen für die Auswahl" });
    expect(
      within(bar)
        .getAllByRole("button")
        .map((b) => b.getAttribute("aria-label") ?? b.textContent),
    ).toEqual([
      "Zitat (KI)",
      "Gelb markieren (Taste 1)",
      "Grün markieren (Taste 2)",
      "Blau markieren (Taste 3)",
      "Rot markieren (Taste 4)",
    ]);
  });

  // protects=one click on a colour makes a card with that colour and without AI, and opens the note field;
  // fails_when=a job is started or the colour is lost; no_claim=how the marker is drawn (lib/cards.test.ts and the reader browser tests)
  it("marks the passage with one click, without AI", async () => {
    const user = userEvent.setup();
    const { calls, data } = await openReader();
    await select("bpara0002", PASSAGE);
    await user.click(await screen.findByTestId("selection-color-yellow"));

    const create = calls.find((c) => c.name === "cards.create");
    expect(create?.input).toMatchObject({
      citekey: "luhmann1984soziale",
      quote: PASSAGE,
      color: "yellow",
      ai: false,
    });
    await waitFor(() => expect(rows()).toHaveLength(4));
    const stored = data.cards.find((c) => c.body.quote === PASSAGE);
    expect(stored?.frontmatter.color).toBe("yellow");
    expect(stored?.body.paraphrase).toBeUndefined();
    expect(calls.some((c) => c.name === "jobs.get")).toBe(false);

    const editor = await screen.findByTestId("card-editor");
    expect(within(editor).queryByText("Die KI schreibt die Paraphrase.")).toBeNull();
    // the new card opens with the cursor in its note
    await waitFor(() =>
      expect(within(editor).getByRole("textbox", { name: "Notiz" })).toHaveFocus(),
    );
  });

  // protects=the note takes the cursor once, right after marking, and not again when the card is opened later;
  // fails_when=reopening the highlighted card moves the cursor into its note again; no_claim=focus after other ways of opening a card
  it("focuses the note only right after marking, not when the card is reopened", async () => {
    const user = userEvent.setup();
    await openReader();
    await select("bpara0002", PASSAGE);
    await user.click(await screen.findByTestId("selection-color-blue"));
    const editor = await screen.findByTestId("card-editor");
    await waitFor(() =>
      expect(within(editor).getByRole("textbox", { name: "Notiz" })).toHaveFocus(),
    );

    const rowOf = (text: RegExp) => {
      const row = rows().find((r) => text.test(r.textContent ?? ""));
      if (!row) throw new Error(`card row ${text} not found`);
      return row;
    };
    // open another card: the highlighted one closes
    await user.click(within(rowOf(/Doppelte Kontingenz/)).getByRole("button", { expanded: false }));
    await waitFor(() =>
      expect(
        within(rowOf(/Doppelte Kontingenz/)).getByRole("textbox", { name: "Notiz" }),
      ).toBeVisible(),
    );
    expect(
      within(rowOf(new RegExp(PASSAGE.slice(0, 20)))).queryByRole("textbox", { name: "Notiz" }),
    ).toBeNull();

    // open the highlighted card again: its note field appears, without the cursor
    await user.click(
      within(rowOf(new RegExp(PASSAGE.slice(0, 20)))).getByRole("button", { expanded: false }),
    );
    const again = await within(rowOf(new RegExp(PASSAGE.slice(0, 20)))).findByRole("textbox", {
      name: "Notiz",
    });
    expect(again).not.toHaveFocus();
  });

  // protects=the keys 1 to 4 choose the colour while text is selected; fails_when=a digit typed into a text field marks a passage;
  // no_claim=other keys
  it("takes the keys 1 to 4 while text is selected, but not inside a text field", async () => {
    const user = userEvent.setup();
    const { calls } = await openReader();
    await select("bpara0002", PASSAGE);
    await screen.findByTestId("selection-color-green");
    await user.keyboard("2");
    await waitFor(() =>
      expect(calls.find((c) => c.name === "cards.create")?.input).toMatchObject({ color: "green" }),
    );

    // the note field of the new card has the cursor: digits are text there
    const editor = await screen.findByTestId("card-editor");
    const note = within(editor).getByRole("textbox", { name: "Notiz" });
    await waitFor(() => expect(note).toHaveFocus());
    await select("bpara0003", "Es gibt selbstreferentielle Systeme.");
    await screen.findByTestId("selection-color-green");
    note.focus();
    await user.keyboard("3");
    expect(calls.filter((c) => c.name === "cards.create")).toHaveLength(1);
  });

  // protects=Zitat still asks the AI and sets no colour; fails_when=Zitat sends a colour or stops the AI job;
  // no_claim=the paraphrase text itself
  it("keeps Zitat as it was: an AI paraphrase and no colour", async () => {
    const user = userEvent.setup();
    const { calls, data } = await openReader();
    await select("bpara0002", PASSAGE);
    await user.click(await screen.findByRole("button", { name: "Zitat (KI)" }));
    const create = calls.find((c) => c.name === "cards.create");
    expect(create?.input).not.toHaveProperty("color");
    expect(create?.input).not.toHaveProperty("ai");
    await waitFor(() => expect(rows()).toHaveLength(4));
    expect(data.cards.find((c) => c.body.quote === PASSAGE)?.frontmatter.color).toBeUndefined();
  });
});

describe("editing a highlight", () => {
  // protects=tags and a note typed after marking end up in the card; fails_when=either is not saved;
  // no_claim=survives a restart (the core test reads the file)
  it("saves a note and tags typed right after marking", async () => {
    const user = userEvent.setup();
    const { calls, data } = await openReader();
    await select("bpara0002", PASSAGE);
    await user.click(await screen.findByTestId("selection-color-blue"));
    const editor = await screen.findByTestId("card-editor");
    const note = within(editor).getByRole("textbox", { name: "Notiz" });
    await waitFor(() => expect(note).toHaveFocus());
    await user.keyboard("Zentral fuer Kapitel 3");
    await user.click(within(editor).getByRole("textbox", { name: "Tags" }));
    await user.keyboard("Methode, Beobachtung{Enter}");
    await waitFor(() => {
      const stored = data.cards.find((c) => c.body.quote === PASSAGE);
      expect(stored?.body.note).toBe("Zentral fuer Kapitel 3");
      expect(stored?.frontmatter.tags).toEqual(["Methode", "Beobachtung"]);
    });
    expect(calls.filter((c) => c.name === "cards.update").length).toBeGreaterThanOrEqual(2);
  });

  // protects=colour changes and clears through the card editor; fails_when=null does not remove the colour;
  // no_claim=the colour of the kind
  it("changes the colour and clears it with a second click on the same dot", async () => {
    const user = userEvent.setup();
    const { calls, data } = await openReader(markedFixtures());
    const row = rows().find((r) => /Soziale Systeme bestehen/.test(r.textContent ?? ""));
    if (!row) throw new Error("card row not found");
    await user.click(within(row).getByRole("button", { expanded: false }));
    const editor = await screen.findByTestId("card-editor");

    await user.click(within(editor).getByRole("button", { name: "Farbe Rot" }));
    await waitFor(() =>
      expect(calls.find((c) => c.name === "cards.update")?.input).toMatchObject({
        patch: { color: "red" },
      }),
    );
    expect(cardOf(data, "Soziale Systeme bestehen").frontmatter.color).toBe("red");

    await user.click(within(editor).getByRole("button", { name: "Farbe Rot" }));
    await waitFor(() =>
      expect(calls.filter((c) => c.name === "cards.update")[1]?.input).toMatchObject({
        patch: { color: null },
      }),
    );
    expect(cardOf(data, "Soziale Systeme bestehen").frontmatter.color).toBeUndefined();
  });

  // protects=a highlight can be deleted from the card menu and the toast brings it back; fails_when=the card stays, or undo loses it;
  // no_claim=the library trash on disk (the core test reads it)
  it("deletes a card and restores it with Rückgängig", async () => {
    const user = userEvent.setup();
    const { calls, data } = await openReader(markedFixtures());
    const row = rows().find((r) => /Doppelte Kontingenz/.test(r.textContent ?? ""));
    if (!row) throw new Error("card row not found");
    await user.click(within(row).getByRole("button", { expanded: false }));
    const editor = await screen.findByTestId("card-editor");
    await user.click(within(editor).getByRole("button", { name: "Weitere Aktionen" }));
    await user.click(await screen.findByRole("menuitem", { name: "Löschen" }));

    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(calls.find((c) => c.name === "cards.delete")?.input).toMatchObject({
      id: expect.stringMatching(/^c_/),
    });
    expect(data.cards.some((c) => c.body.quote.startsWith("Doppelte Kontingenz"))).toBe(false);
    expect(
      document.querySelector("[data-highlight-id]")?.getAttribute("data-highlight-id"),
    ).not.toBe(null);

    await user.click(await screen.findByRole("button", { name: "Rückgängig" }));
    await waitFor(() => expect(rows()).toHaveLength(3));
    expect(calls.some((c) => c.name === "cards.restore")).toBe(true);
    expect(data.cards.some((c) => c.body.quote.startsWith("Doppelte Kontingenz"))).toBe(true);
  });
});

describe("deleting a card with connections", () => {
  const TARGET = "Doppelte Kontingenz";

  /** Notes around the card: one mentions it in its text, one links to it, and the card links out. */
  function connectedFixtures(): { data: MockData; id: string } {
    const data = markedFixtures();
    const id = cardOf(data, TARGET).frontmatter.id;
    const store = storeFor(data);
    const stamp = { at: "2026-10-06T09:00:00.000Z", by: "human" } as const;
    const base = { tags: [], projects: [], created: stamp, modified: stamp };
    const link = (to: string, from?: string) => ({
      to: `[[${to}]]`,
      rel: "supports" as const,
      by: "human",
      status: "accepted" as const,
      ...(from ? { from, evidence: `[[${from}]]` } : {}),
    });
    store.set("n_mention", {
      slug: "erwaehnung",
      body: `Siehe [[${id}]] für die doppelte Kontingenz.`,
      frontmatter: { ...base, id: "n_mention", type: "permanent", title: "Erwähnung", links: [] },
    });
    store.set("n_linked", {
      slug: "verknuepft",
      body: "Kein Wiki-Link im Text.",
      frontmatter: {
        ...base,
        id: "n_linked",
        type: "permanent",
        title: "Verknüpft",
        links: [link(id)],
      },
    });
    store.set("n_lit", {
      slug: "lit",
      body: "Item: [[luhmann1984soziale]]",
      frontmatter: {
        ...base,
        id: "n_lit",
        type: "literature",
        title: "Lesenotizen",
        links: [link("luhmann1984soziale", id)],
      },
    });
    return { data, id };
  }

  async function chooseDelete(user: ReturnType<typeof userEvent.setup>) {
    const row = rows().find((r) => new RegExp(TARGET).test(r.textContent ?? ""));
    if (!row) throw new Error("card row not found");
    await user.click(within(row).getByRole("button", { expanded: false }));
    const editor = await screen.findByTestId("card-editor");
    await user.click(within(editor).getByRole("button", { name: "Weitere Aktionen" }));
    await user.click(await screen.findByRole("menuitem", { name: "Löschen" }));
  }

  // protects=a card with connections asks first and names what is connected and what goes with it;
  // fails_when=the card is deleted without a question, or the counts or the note on mentions are wrong; no_claim=the wording in English
  it("warns with the counts before deleting, and Abbrechen keeps the card", async () => {
    const user = userEvent.setup();
    const { data } = connectedFixtures();
    const { calls } = await openReader(data);
    await chooseDelete(user);

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Diese Karte ist mit 2 Notizen und 2 Links verbunden.");
    expect(dialog).toHaveTextContent("Die Verbindungen werden mit entfernt.");
    expect(dialog).toHaveTextContent("Erwähnungen im Text bleiben als Text stehen.");
    // the first call was refused, no forced call yet
    expect(calls.filter((c) => c.name === "cards.delete")).toHaveLength(1);

    await user.click(within(dialog).getByRole("button", { name: "Abbrechen" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(rows()).toHaveLength(3);
    expect(calls.filter((c) => c.name === "cards.delete")).toHaveLength(1);
    expect(storeFor(data).get("n_linked")?.frontmatter.links).toHaveLength(1);
  });

  // protects=confirming deletes with force, removes the links and leaves the note text; Rückgängig brings card and links back;
  // fails_when=force is not sent, a link survives, the text changes, or undo loses a link; no_claim=the core (its own tests cover disk)
  it("deletes with force after Löschen and restores the links with Rückgängig", async () => {
    const user = userEvent.setup();
    const { data, id } = connectedFixtures();
    const { calls } = await openReader(data);
    await chooseDelete(user);

    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Löschen" }));

    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(calls.filter((c) => c.name === "cards.delete").map((c) => c.input)).toEqual([
      { id },
      { id, force: true },
    ]);
    const store = storeFor(data);
    expect(store.get("n_linked")?.frontmatter.links).toEqual([]);
    expect(store.get("n_lit")?.frontmatter.links).toEqual([]);
    expect(store.get("n_mention")?.body).toBe(`Siehe [[${id}]] für die doppelte Kontingenz.`);

    await user.click(await screen.findByRole("button", { name: "Rückgängig" }));
    await waitFor(() => expect(rows()).toHaveLength(3));
    expect(store.get("n_linked")?.frontmatter.links).toHaveLength(1);
    expect(store.get("n_lit")?.frontmatter.links).toHaveLength(1);
  });
});

describe("card panel filters", () => {
  // protects=the colour chips and the tag menu narrow the panel, alone and together; fails_when=a filter is ignored or does not combine;
  // no_claim=the highlights in the text stay as they are
  it("filters by colour, by tag and by both, and resets", async () => {
    const user = userEvent.setup();
    await openReader(markedFixtures());
    expect(rows()).toHaveLength(3);

    await user.click(screen.getByRole("button", { name: "Grün" }));
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toHaveTextContent("Es gibt selbstreferentielle Systeme");

    await user.click(screen.getByRole("button", { name: "Grün" }));
    await user.click(screen.getByRole("button", { name: "Gelb" }));
    expect(rows()).toHaveLength(2);

    await user.click(screen.getByRole("combobox", { name: "Schlagwort" }));
    await user.click(await screen.findByRole("option", { name: "Methode" }));
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toHaveTextContent("Soziale Systeme bestehen");

    await user.click(screen.getByRole("button", { name: "Gelb" }));
    expect(rows()).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: "Filter zurücksetzen" }));
    expect(rows()).toHaveLength(3);
  });

  // protects=a library without colours and tags shows no filter bar; fails_when=the bar clutters the plain panel;
  // no_claim=nothing about libraries that have some
  it("shows no filter bar while no card has a colour or a tag", async () => {
    const data = createReflowFixtures();
    for (const c of data.cards) c.frontmatter = { ...c.frontmatter, tags: [], color: undefined };
    await openReader(data);
    expect(screen.queryByRole("button", { name: "Gelb" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Schlagwort" })).toBeNull();
  });
});

describe("search", () => {
  // protects=a tag finds its cards, and the hit shows colour and tags and opens the reader at the card;
  // fails_when=the tag is not searched, or the hit loses colour, tags or the card link; no_claim=ranking
  it("finds a card by its tag, shows colour and tags and links to the card", async () => {
    renderApp("/search?q=Theorie", markedFixtures());
    const hits = await screen.findAllByTestId("hit");
    // the item that mentions the word is a hit too; the card is the one with a colour
    const hit = hits.find((h) => h.textContent?.includes("Karte"));
    if (!hit) throw new Error("no card hit");
    expect(hit).toHaveTextContent("Grün");
    expect(hit).toHaveTextContent("#Methode #Theorie");
    const link = within(hit).getByRole("link");
    expect(link.getAttribute("href")).toMatch(/tab=read/);
    expect(link.getAttribute("href")).toMatch(/card=c_/);
  });
});
