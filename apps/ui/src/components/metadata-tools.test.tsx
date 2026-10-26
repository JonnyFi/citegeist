import { ItemFrontmatter } from "@citegeist/schema";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { createFixtures, type MockData } from "../mock/fixtures";
import { renderApp } from "../test-utils";

const THIN = "anonndarray";

/** An item that arrived by its web page: no author, no year, a placeholder citekey. */
function withThinItem(extra: Record<string, unknown> = {}): MockData {
  const data = createFixtures();
  data.items.set(THIN, {
    note: "",
    frontmatter: ItemFrontmatter.parse({
      id: "01JB8Z3QK7ABCDEFGH",
      citekey: THIN,
      type: "webpage",
      title: "Array programming with NumPy",
      URL: "https://example.org/numpy",
      provenance: { title: "web@2026-10-23", URL: "web@2026-10-23" },
      created: { at: "2026-10-23T12:00:00.000Z", by: "human" },
      ...extra,
    }),
  });
  return data;
}

describe("hint on an item without author or year", () => {
  it("shows the hint with its three actions and no duplicate fetch button", async () => {
    renderApp(`/items/${THIN}`, withThinItem());
    const hint = await screen.findByRole("note", { name: "Metadaten unvollständig" });
    expect(within(hint).getByText(/Autor oder Jahr fehlen/)).toBeVisible();
    expect(within(hint).getByRole("button", { name: "Kennung hinzufügen" })).toBeVisible();
    expect(within(hint).getByRole("button", { name: "Metadaten neu abrufen" })).toBeVisible();
    expect(within(hint).getByRole("button", { name: "Metadaten bearbeiten" })).toBeVisible();
    expect(screen.getAllByRole("button", { name: "Metadaten neu abrufen" })).toHaveLength(1);
  });

  it("is absent on an item that has author and year, which gets the actions in the metadata block", async () => {
    renderApp("/items/luhmann1984soziale");
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByRole("note", { name: "Metadaten unvollständig" })).toBeNull();
    expect(screen.getByRole("button", { name: "Metadaten bearbeiten" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Kennung hinzufügen" })).toBeVisible();
    expect(screen.getAllByRole("button", { name: "Metadaten neu abrufen" })).toHaveLength(1);
  });

  it("marks the item in the library list", async () => {
    renderApp("/", withThinItem());
    const row = (await screen.findAllByTestId("item-row")).find((r) =>
      r.textContent?.includes(THIN),
    ) as HTMLElement;
    expect(within(row).getByText("Metadaten fehlen")).toBeVisible();
    const complete = (await screen.findAllByTestId("item-row")).find((r) =>
      r.textContent?.includes("luhmann1984soziale"),
    ) as HTMLElement;
    expect(within(complete).queryByText("Metadaten fehlen")).toBeNull();
  });

  it("fetches the metadata again from the hint", async () => {
    const user = userEvent.setup();
    const { calls } = renderApp(`/items/${THIN}`, withThinItem());
    await user.click(await screen.findByRole("button", { name: "Metadaten neu abrufen" }));
    expect(await screen.findByRole("status")).toHaveTextContent(/Aktualisiert: abstract/);
    expect(calls.find((c) => c.name === "items.resolve")?.input).toEqual({ citekey: THIN });
  });
});

describe("Metadaten bearbeiten", () => {
  async function openEditor(data = withThinItem()) {
    const user = userEvent.setup();
    const view = renderApp(`/items/${THIN}`, data);
    await user.click(await screen.findByRole("button", { name: "Metadaten bearbeiten" }));
    const form = await screen.findByRole("form", { name: "Metadaten bearbeiten" });
    return { user, view, form };
  }

  it("saves only the changed fields through items.update and offers the rename", async () => {
    const { user, view, form } = await openEditor();
    const authors = within(form).getByRole("group", { name: "Autorinnen und Autoren" });
    await user.click(within(authors).getByRole("button", { name: "Person hinzufügen" }));
    await user.type(within(authors).getByLabelText("Nachname 1"), "Harris");
    await user.type(within(authors).getByLabelText("Vorname 1"), "Charles R.");
    await user.type(within(form).getByLabelText(/^Erschienen JJJJ/), "2020");
    await user.selectOptions(within(form).getByLabelText("Typ"), "article-journal");
    await user.type(
      within(form).getByLabelText("DOI"),
      "https://doi.org/10.1038/S41586-020-2649-2",
    );
    await user.click(within(form).getByRole("button", { name: "Speichern" }));

    const call = view.calls.find((c) => c.name === "items.update");
    expect(call?.input).toEqual({
      citekey: THIN,
      patch: {
        type: "article-journal",
        author: [{ family: "Harris", given: "Charles R." }],
        issued: 2020,
        DOI: "10.1038/s41586-020-2649-2",
      },
    });
    expect(await screen.findByRole("status")).toHaveTextContent(
      /Gespeichert: type, author, issued, DOI/,
    );
    // the item is not renamed behind the person's back
    expect(view.data.items.has(THIN)).toBe(true);
    const offer = await screen.findByRole("note", { name: "Umbenennen" });
    expect(within(offer).getByText(/Der Citekey anonndarray ist ein Platzhalter/)).toBeVisible();
    expect(within(offer).getByText(/harris2020array/)).toBeVisible();

    await user.click(within(offer).getByRole("button", { name: "Umbenennen" }));
    await waitFor(() => expect(view.history.location.pathname).toBe("/items/harris2020array"));
    expect(view.data.items.has("harris2020array")).toBe(true);
    expect(view.data.items.has(THIN)).toBe(false);
  });

  it("keeps the placeholder when the person declines", async () => {
    const { user, view, form } = await openEditor();
    await user.type(within(form).getByLabelText(/^Erschienen JJJJ/), "2020");
    const authors = within(form).getByRole("group", { name: "Autorinnen und Autoren" });
    await user.click(within(authors).getByRole("button", { name: "Person hinzufügen" }));
    await user.type(within(authors).getByLabelText("Nachname 1"), "Harris");
    await user.click(within(form).getByRole("button", { name: "Speichern" }));
    const offer = await screen.findByRole("note", { name: "Umbenennen" });
    await user.click(within(offer).getByRole("button", { name: "Behalten" }));
    expect(screen.queryByRole("note", { name: "Umbenennen" })).toBeNull();
    expect(view.data.items.has(THIN)).toBe(true);
  });

  it("explains an invalid DOI, ISBN and date and sends nothing", async () => {
    const { user, view, form } = await openEditor();
    await user.type(within(form).getByLabelText("DOI"), "doi is not here");
    await user.type(within(form).getByLabelText("ISBN"), "978-3-518-58706-4");
    await user.type(within(form).getByLabelText(/^Erschienen JJJJ/), "20.20");
    await user.click(within(form).getByRole("button", { name: "Speichern" }));
    expect(await screen.findByText(/Das ist keine gültige DOI/)).toBeVisible();
    expect(screen.getByText(/Diese ISBN ist ungültig/)).toBeVisible();
    expect(screen.getByText(/Das Datum muss JJJJ/)).toBeVisible();
    expect(within(form).getByLabelText("DOI")).toHaveAttribute("aria-invalid", "true");
    expect(view.calls.some((c) => c.name === "items.update")).toBe(false);
  });

  it("closes without a call when nothing changed", async () => {
    const { user, view, form } = await openEditor();
    await user.click(within(form).getByRole("button", { name: "Speichern" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Nichts geändert.");
    expect(view.calls.some((c) => c.name === "items.update")).toBe(false);
    expect(screen.queryByRole("form", { name: "Metadaten bearbeiten" })).toBeNull();
  });

  it("cancels without saving", async () => {
    const { user, view, form } = await openEditor();
    await user.type(within(form).getByLabelText("Band"), "3");
    await user.click(within(form).getByRole("button", { name: "Abbrechen" }));
    expect(screen.queryByRole("form", { name: "Metadaten bearbeiten" })).toBeNull();
    expect(view.calls.some((c) => c.name === "items.update")).toBe(false);
  });
});

describe("Kennung hinzufügen", () => {
  async function openForm() {
    const user = userEvent.setup();
    const view = renderApp(`/items/${THIN}`, withThinItem());
    const hint = await screen.findByRole("note", { name: "Metadaten unvollständig" });
    await user.click(within(hint).getByRole("button", { name: "Kennung hinzufügen" }));
    const form = await screen.findByRole("form", { name: "Kennung hinzufügen" });
    return { user, view, form };
  }

  it("stores the identifier through items.resolve and names the changed fields", async () => {
    const { user, view, form } = await openForm();
    await user.type(
      within(form).getByLabelText("DOI, ISBN, arXiv-ID, PMID oder Adresse"),
      "10.1038/s41586-020-2649-2",
    );
    await user.click(within(form).getByRole("button", { name: "Abrufen" }));
    expect(view.calls.find((c) => c.name === "items.resolve")?.input).toEqual({
      citekey: THIN,
      identifier: "10.1038/s41586-020-2649-2",
    });
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Aktualisiert: DOI, author, issued",
    );
    expect(view.data.items.get(THIN)?.frontmatter.DOI).toBe("10.1038/s41586-020-2649-2");
    expect(await screen.findByRole("note", { name: "Umbenennen" })).toBeVisible();
  });

  it("refuses text that is no identifier before asking the core", async () => {
    const { user, view, form } = await openForm();
    await user.type(within(form).getByLabelText("DOI, ISBN, arXiv-ID, PMID oder Adresse"), "hallo");
    await user.click(within(form).getByRole("button", { name: "Abrufen" }));
    expect(await within(form).findByRole("alert")).toHaveTextContent(
      "Das ist keine DOI, ISBN, arXiv-ID, PMID oder Adresse.",
    );
    expect(view.calls.some((c) => c.name === "items.resolve")).toBe(false);
  });

  it("checks the check digit of an ISBN", async () => {
    const { user, form } = await openForm();
    await user.type(
      within(form).getByLabelText("DOI, ISBN, arXiv-ID, PMID oder Adresse"),
      "978-3-518-58706-4",
    );
    await user.click(within(form).getByRole("button", { name: "Abrufen" }));
    expect(await within(form).findByRole("alert")).toHaveTextContent(/Diese ISBN ist ungültig/);
  });

  it("shows the reason when the lookup fails and keeps the form open", async () => {
    const { user, view, form } = await openForm();
    const original = view.core.call.bind(view.core);
    view.core.call = ((contract, input) =>
      contract.name === "items.resolve"
        ? Promise.reject(new Error("METADATA_NOT_FOUND: no metadata found"))
        : original(contract, input)) as typeof view.core.call;
    await user.type(
      within(form).getByLabelText("DOI, ISBN, arXiv-ID, PMID oder Adresse"),
      "10.1234/unknown",
    );
    await user.click(within(form).getByRole("button", { name: "Abrufen" }));
    expect(await within(form).findByRole("alert")).toHaveTextContent(/METADATA_NOT_FOUND/);
    expect(screen.getByRole("form", { name: "Kennung hinzufügen" })).toBeVisible();
  });
});
