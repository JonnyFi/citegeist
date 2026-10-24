import { conceptsCreate, conceptsDescribe, conceptsMerge, conceptsUpdate } from "@citegeist/ops";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { de } from "../i18n/de";
import { en } from "../i18n/en";
import { createFixtures } from "../mock/fixtures";
import { renderApp } from "../test-utils";

const RAG = "Retrieval-augmented generation";

describe("concept list", () => {
  it("opens from the sidebar and lists the concepts with counts", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await user.click(await screen.findByRole("link", { name: "Begriffe" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Begriffe" })).toBeVisible();
    const rows = await screen.findAllByTestId("concept-row");
    expect(rows.map((r) => r.textContent)).toEqual([`${RAG}1 Quelle2 Karten`]);
    expect(screen.getByText("Wähle einen Begriff")).toBeVisible();
  });

  it("filters by title or alias and says so when nothing matches", async () => {
    const user = userEvent.setup();
    renderApp("/concepts");
    await screen.findAllByTestId("concept-row");
    const filter = screen.getByRole("searchbox", { name: "Begriffe filtern" });
    await user.type(filter, "rag");
    expect(await screen.findAllByTestId("concept-row")).toHaveLength(1);
    await user.clear(filter);
    await user.type(filter, "gibtesnicht");
    expect(await screen.findByText("Kein Begriff passt zum Filter.")).toBeVisible();
  });

  it("speaks English when the UI does", async () => {
    renderApp("/concepts", createFixtures(), { lang: "en" });
    expect(await screen.findByRole("heading", { level: 1, name: "Concepts" })).toBeVisible();
    expect(await screen.findByText("1 source")).toBeVisible();
    expect(screen.getByRole("button", { name: "New concept" })).toBeVisible();
  });

  it("has a German and an English string for every concept key", () => {
    const keys = Object.keys(de).filter((k) => k.startsWith("concepts.") || k === "nav.concepts");
    expect(keys.length).toBeGreaterThan(40);
    for (const key of keys) {
      expect(en[key as keyof typeof en], key).toBeTruthy();
      expect(de[key as keyof typeof de], key).toBeTruthy();
    }
  });
});

describe("concept page", () => {
  async function openRag() {
    const user = userEvent.setup();
    const view = renderApp("/concepts");
    await user.click(await screen.findByRole("link", { name: new RegExp(RAG) }));
    await screen.findByRole("textbox", { name: "Name des Begriffs" });
    return { user, ...view };
  }

  it("shows the name, the aliases and, per source, the entry with its quotes and pages", async () => {
    await openRag();
    expect(screen.getByRole("textbox", { name: "Name des Begriffs" })).toHaveValue(RAG);
    const aliases = screen.getByRole("list", { name: "Aliase" });
    expect(within(aliases).getByText("RAG")).toBeVisible();

    const source = await screen.findByTestId("concept-source");
    expect(
      within(source).getByRole("link", { name: /Quelle öffnen: Retrieval-Augmented Generation/ }),
    ).toBeVisible();
    expect(within(source).getByText("Definiert")).toBeVisible();
    expect(within(source).getByText(/Lewis et al\. fassen RAG/)).toBeVisible();
    const evidence = within(source).getByRole("list", { name: "Belegstellen" });
    expect(within(evidence).getByText("S. 2")).toBeVisible();
    expect(within(evidence).getByText(/We build RAG models/)).toBeVisible();
    expect(within(evidence).getByRole("link", { name: "Karte öffnen, S. 2" })).toHaveAttribute(
      "href",
      expect.stringContaining("card="),
    );
  });

  it("renames, adds and removes aliases", async () => {
    const { user, calls } = await openRag();
    const alias = screen.getByRole("textbox", { name: "Alias hinzufügen" });
    await user.type(alias, "Abrufgestützte Generierung");
    await user.click(screen.getByRole("button", { name: "Hinzufügen" }));
    expect(await screen.findByText("Abrufgestützte Generierung")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Alias entfernen: RAG" }));
    await waitFor(() => expect(screen.queryByText("RAG", { selector: "li" })).toBeNull());

    const title = screen.getByRole("textbox", { name: "Name des Begriffs" });
    await user.clear(title);
    await user.type(title, "RAG-Verfahren");
    await user.tab();
    await waitFor(() => {
      const ops = calls
        .filter((c) => c.name === conceptsUpdate.name)
        .flatMap((c) => (c.input as { ops: Array<{ op: string }> }).ops.map((o) => o.op));
      expect(ops).toEqual(["addAlias", "removeAlias", "rename"]);
    });
    // the old name stays reachable as an alias
    expect(await screen.findByText(RAG, { selector: "li" })).toBeVisible();
  });

  it("writes the entry of a source that has none and reports the outcome", async () => {
    const user = userEvent.setup();
    const { calls } = renderApp("/concepts");
    await screen.findAllByTestId("concept-row");
    // a second concept whose only source has no entry yet
    await user.click(screen.getByRole("button", { name: "Neuer Begriff" }));
    await user.type(await screen.findByLabelText("Begriff"), "Selbstreferenz");
    await user.click(screen.getByRole("button", { name: "Begriff anlegen" }));
    expect(await screen.findByRole("textbox", { name: "Name des Begriffs" })).toHaveValue(
      "Selbstreferenz",
    );
    const source = await screen.findByTestId("concept-source");
    expect(within(source).getByText("Für diese Quelle gibt es noch keinen Eintrag.")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Einträge schreiben" }));
    expect(await within(source).findByText("Definiert")).toBeVisible();
    expect(await screen.findByText("1 geschrieben, 0 ohne Beleg, 0 fehlgeschlagen")).toBeVisible();
    expect(calls.filter((c) => c.name === conceptsDescribe.name)).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Einträge schreiben" })).toBeDisabled();
  });

  it("lists the cards of a source and removes one", async () => {
    const { user, calls } = await openRag();
    const source = await screen.findByTestId("concept-source");
    await user.click(within(source).getByText("Karten dieser Quelle (2)"));
    const cards = within(source).getAllByTestId("concept-card");
    expect(cards).toHaveLength(2);
    await user.click(
      within(cards[1] as HTMLElement).getByRole("button", {
        name: /Karte aus dem Begriff entfernen/,
      }),
    );
    await waitFor(() => expect(within(source).getByText("Karten dieser Quelle (1)")).toBeVisible());
    expect(
      calls.some(
        (c) =>
          c.name === conceptsUpdate.name &&
          (c.input as { ops: Array<{ op: string }> }).ops[0]?.op === "removeCards",
      ),
    ).toBe(true);
    // the cards changed after the entry was written
    expect(await within(source).findByText("veraltet")).toBeVisible();
  });
});

describe("creating and merging", () => {
  it("extends the concept that already has the name instead of making a twin", async () => {
    const user = userEvent.setup();
    const { calls } = renderApp("/concepts");
    await screen.findAllByTestId("concept-row");
    await user.click(screen.getByRole("button", { name: "Neuer Begriff" }));
    await user.type(await screen.findByLabelText("Begriff"), "rag");
    await user.click(screen.getByRole("button", { name: "Begriff anlegen" }));
    expect(
      await screen.findByText(
        `Der Name gehört schon zu „${RAG}“. Aliase und Karten wurden dort ergänzt.`,
      ),
    ).toBeVisible();
    expect(await screen.findByTestId("concept-row")).toBeVisible();
    expect(screen.getAllByTestId("concept-row")).toHaveLength(1);
    const created = calls.filter((c) => c.name === conceptsCreate.name);
    expect(created).toHaveLength(1);
  });

  it("absorbs another concept: aliases and cards move over and the other one disappears", async () => {
    const user = userEvent.setup();
    const { calls } = renderApp("/concepts");
    await screen.findAllByTestId("concept-row");
    await user.click(screen.getByRole("button", { name: "Neuer Begriff" }));
    await user.type(await screen.findByLabelText("Begriff"), "Selbstreferenz");
    await user.click(screen.getByRole("button", { name: "Begriff anlegen" }));
    await screen.findByDisplayValue("Selbstreferenz");

    await user.click(screen.getByRole("combobox", { name: "Anderen Begriff aufnehmen" }));
    await user.click(await screen.findByRole("option", { name: RAG }));
    await user.click(screen.getByRole("button", { name: "Aufnehmen" }));

    const aliases = await screen.findByRole("list", { name: "Aliase" });
    await waitFor(() => {
      expect(within(aliases).getByText(RAG)).toBeVisible();
      expect(within(aliases).getByText("RAG")).toBeVisible();
    });
    await waitFor(() => expect(screen.getAllByTestId("concept-row")).toHaveLength(1));
    expect(calls.filter((c) => c.name === conceptsMerge.name)).toHaveLength(1);
    expect(await screen.findAllByTestId("concept-source")).toHaveLength(2);
  });
});

describe("proposals", () => {
  it("proposes terms from definition cards and creates a concept on request", async () => {
    const user = userEvent.setup();
    renderApp("/concepts");
    await screen.findAllByTestId("concept-row");
    await user.click(screen.getByRole("button", { name: "Vorschläge suchen" }));
    const list = await screen.findByRole("list", { name: "Vorgeschlagene Begriffe" });
    const proposal = within(list).getByTestId("proposal");
    expect(within(proposal).getByText("Selbstreferenz")).toBeVisible();
    expect(within(proposal).getByText("aus Definition")).toBeVisible();

    await user.click(
      within(proposal).getByRole("button", { name: "Begriff anlegen: Selbstreferenz" }),
    );
    expect(await within(proposal).findByText("übernommen")).toBeVisible();
    await waitFor(() => expect(screen.getAllByTestId("concept-row")).toHaveLength(2));

    await user.click(within(proposal).getByRole("button", { name: "Öffnen" }));
    expect(await screen.findByDisplayValue("Selbstreferenz")).toBeVisible();
  });
});

describe("concept link on cards", () => {
  it("shows the concepts a card belongs to and opens the page", async () => {
    const user = userEvent.setup();
    renderApp("/items/lewis2020retrieval");
    const links = await screen.findAllByTestId("card-concepts");
    expect(links.length).toBeGreaterThanOrEqual(1);
    const link = within(links[0] as HTMLElement).getByRole("link", {
      name: `Begriff öffnen: ${RAG}`,
    });
    await user.click(link);
    expect(await screen.findByRole("textbox", { name: "Name des Begriffs" })).toHaveValue(RAG);
  });

  it("stays away from cards that belong to no concept", async () => {
    renderApp("/items/luhmann1984soziale");
    await screen.findAllByTestId("card");
    await waitFor(() => expect(screen.queryByTestId("card-concepts")).toBeNull());
  });
});
