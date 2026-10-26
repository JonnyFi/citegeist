import { ItemFrontmatter } from "@citegeist/schema";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFixtures } from "../mock/fixtures";
import { createReflowFixtures, renderApp } from "../test-utils";

afterEach(() => localStorage.clear());

const addField = () => screen.findByRole("textbox", { name: "Hinzufügen" });

describe("library table", () => {
  it("marks an item whose full text lookup found nothing as 'ohne Volltext'", async () => {
    const data = createFixtures();
    const item = data.items.get("latour2005reassembling");
    if (!item) throw new Error("fixture missing");
    item.frontmatter = ItemFrontmatter.parse({
      ...item.frontmatter,
      fulltext: { status: "missing", checked_at: "2026-10-24T10:00:00.000Z", tried: [] },
    });
    renderApp("/", data);
    const rows = await screen.findAllByTestId("item-row");
    const row = rows.find((r) => within(r).queryByText("latour2005reassembling"));
    if (!row) throw new Error("row missing");
    expect(within(row).getByText("ohne Volltext")).toBeVisible();
    expect(screen.getAllByText("ohne Volltext")).toHaveLength(1);
  });
});

describe("add field", () => {
  it("adds an item by DOI to the library and links to it", async () => {
    const user = userEvent.setup();
    const { calls } = renderApp("/");
    await user.type(await addField(), "10.1000/xyz123{Enter}");

    expect(await screen.findByRole("link", { name: "doi101000xyz123" })).toBeVisible();
    expect(screen.getByText("Hinzugefügt:")).toBeVisible();
    expect(calls.find((c) => c.name === "items.add")?.input).toEqual({
      identifier: "10.1000/xyz123",
      target: "library",
    });
    expect(await addField()).toHaveValue("");
    // the new source shows up in the table
    await waitFor(async () => expect(await screen.findAllByTestId("item-row")).toHaveLength(12));
  });

  it("names what it recognised while typing", async () => {
    const user = userEvent.setup();
    renderApp("/");
    const field = await addField();
    await user.type(field, "https://arxiv.org/abs/1706.03762");
    expect(screen.getByText("arXiv")).toBeVisible();
    await user.clear(field);
    await user.type(field, "978-3-518-28266-7");
    expect(screen.getByText("ISBN")).toBeVisible();
    await user.clear(field);
    await user.type(field, "https://example.org/artikel");
    expect(screen.getByText("Link")).toBeVisible();
  });

  it("files the item under the project the library is filtered by", async () => {
    const user = userEvent.setup();
    const { calls } = renderApp("/?project=phd-proposal");
    await user.type(await addField(), "10.1000/xyz123{Enter}");
    await screen.findByRole("link", { name: "doi101000xyz123" });
    expect(calls.find((c) => c.name === "items.add")?.input).toMatchObject({
      projects: ["phd-proposal"],
    });
  });

  it("points at the item a DOI already belongs to", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await user.type(await addField(), "doi:10.48550/arXiv.1706.03762{Enter}");
    expect(await screen.findByText("Ist schon in der Bibliothek:")).toBeVisible();
    expect(screen.getByRole("link", { name: "vaswani2017attention" })).toBeVisible();
  });

  it("follows the job to the item a new PDF was merged into", async () => {
    const user = userEvent.setup();
    renderApp("/", undefined, { mergeNewInto: "vaswani2017attention" });
    await user.type(await addField(), "10.1000/xyz123{Enter}");
    // items.add answers with the new item; the job result names the one that exists in the end
    expect(await screen.findByRole("link", { name: "doi101000xyz123" })).toBeVisible();
    expect(await screen.findByRole("link", { name: "vaswani2017attention" })).toBeVisible();
    expect(screen.getByText("Ist schon in der Bibliothek:")).toBeVisible();
    expect(screen.queryByRole("link", { name: "doi101000xyz123" })).toBeNull();
  });

  it("shows the message of the core when it refuses the input", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await user.type(await addField(), "irgendein Text{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("UNRECOGNIZED_IDENTIFIER");
  });

  it("adds a PDF dropped onto the window", async () => {
    const { calls } = renderApp("/");
    await addField();
    const file = new File(["%PDF-1.4"], "habermas.pdf", { type: "application/pdf" });
    const transfer = { types: ["Files"], files: [file] };
    fireEvent.dragEnter(window, { dataTransfer: transfer });
    expect(await screen.findByTestId("drop-overlay")).toBeInTheDocument();
    fireEvent.drop(window, { dataTransfer: transfer });

    await waitFor(() => expect(screen.queryByTestId("drop-overlay")).toBeNull());
    expect(await screen.findByRole("link", { name: "pathhabermas" })).toBeVisible();
    expect(calls.find((c) => c.name === "items.add")?.input).toMatchObject({
      identifier: "habermas.pdf",
      target: "library",
    });
  });

  it("refuses a dropped file that is no PDF", async () => {
    const { calls } = renderApp("/");
    await addField();
    const file = new File(["x"], "notizen.txt", { type: "text/plain" });
    fireEvent.drop(window, { dataTransfer: { types: ["Files"], files: [file] } });
    expect(await screen.findByRole("alert")).toHaveTextContent("notizen.txt ist kein PDF.");
    expect(calls.some((c) => c.name === "items.add")).toBe(false);
  });

  it("uses the path the desktop app reports for a dropped file", async () => {
    window.citegeist = {
      pathForFile: () => "/Users/alex/Papers/latour.pdf",
      onNavigate: () => () => {},
      platform: "test",
    } as never;
    try {
      const { calls } = renderApp("/");
      await addField();
      const file = new File(["%PDF-1.4"], "latour.pdf", { type: "application/pdf" });
      fireEvent.drop(window, { dataTransfer: { types: ["Files"], files: [file] } });
      await waitFor(() =>
        expect(calls.find((c) => c.name === "items.add")?.input).toMatchObject({
          identifier: "/Users/alex/Papers/latour.pdf",
        }),
      );
    } finally {
      delete window.citegeist;
    }
  });
});

describe("add menu and native file picker", () => {
  const openMenu = async (user: ReturnType<typeof userEvent.setup>) => {
    await addField();
    await user.click(screen.getByRole("button", { name: "+ Hinzufügen" }));
  };

  it("offers PDF wählen and a typed identifier in the menu", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await openMenu(user);
    expect(await screen.findByRole("menuitem", { name: "PDF wählen" })).toBeVisible();
    await user.click(screen.getByRole("menuitem", { name: "DOI, arXiv, ISBN oder URL eingeben" }));
    await waitFor(async () => expect(await addField()).toHaveFocus());
  });

  it("takes a PDF from the file input in the browser preview", async () => {
    const user = userEvent.setup();
    const { calls } = renderApp("/");
    await openMenu(user);
    await user.click(await screen.findByRole("menuitem", { name: "PDF wählen" }));
    const file = new File(["%PDF-1.4"], "latour.pdf", { type: "application/pdf" });
    await user.upload(screen.getByTestId("pdf-file-input"), file);
    await waitFor(() =>
      expect(calls.find((c) => c.name === "items.add")?.input).toMatchObject({
        identifier: "latour.pdf",
      }),
    );
  });

  it("adds the PDFs chosen in the native dialog", async () => {
    const user = userEvent.setup();
    const pickPaths = vi.fn(async () => ["/Users/alex/Papers/latour.pdf"]);
    window.citegeist = { pickPaths, onNavigate: () => () => {}, platform: "test" } as never;
    try {
      const { calls } = renderApp("/");
      await openMenu(user);
      await user.click(await screen.findByRole("menuitem", { name: "PDF wählen" }));
      expect(pickPaths).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "file", multiple: true, extensions: ["pdf"] }),
      );
      await waitFor(() =>
        expect(calls.find((c) => c.name === "items.add")?.input).toMatchObject({
          identifier: "/Users/alex/Papers/latour.pdf",
        }),
      );
    } finally {
      delete window.citegeist;
    }
  });

  it("adds nothing when the dialog is cancelled", async () => {
    const user = userEvent.setup();
    window.citegeist = {
      pickPaths: async () => [],
      onNavigate: () => () => {},
      platform: "test",
    } as never;
    try {
      const { calls } = renderApp("/");
      await openMenu(user);
      await user.click(await screen.findByRole("menuitem", { name: "PDF wählen" }));
      expect(calls.some((c) => c.name === "items.add")).toBe(false);
    } finally {
      delete window.citegeist;
    }
  });
});

describe("delete with undo", () => {
  it("deletes from the row menu and brings the item back with Rückgängig", async () => {
    const user = userEvent.setup();
    const { calls } = renderApp("/");
    const rows = await screen.findAllByTestId("item-row");
    expect(rows).toHaveLength(11);
    const title = within(rows[0] as HTMLElement).getByRole("link").textContent ?? "";
    await user.click(
      within(rows[0] as HTMLElement).getByRole("button", { name: `Aktionen für ${title}` }),
    );
    await user.click(await screen.findByRole("menuitem", { name: "Löschen" }));
    await waitFor(() => expect(calls.some((c) => c.name === "items.trash")).toBe(true));
    await waitFor(async () => expect(await screen.findAllByTestId("item-row")).toHaveLength(10));

    await user.click(await screen.findByRole("button", { name: "Rückgängig" }));
    await waitFor(() => expect(calls.some((c) => c.name === "items.restore")).toBe(true));
    await waitFor(async () => expect(await screen.findAllByTestId("item-row")).toHaveLength(11));
  });

  it("deletes from the source overview and returns to the library", async () => {
    const user = userEvent.setup();
    const { calls } = renderApp("/items/latour2005reassembling");
    await user.click(await screen.findByRole("button", { name: "Löschen" }));
    await waitFor(() =>
      expect(calls.find((c) => c.name === "items.trash")?.input).toEqual({
        citekey: "latour2005reassembling",
      }),
    );
    expect(await screen.findByText("latour2005reassembling gelöscht.")).toBeVisible();
    expect(await screen.findByRole("heading", { level: 1, name: "Bibliothek" })).toBeVisible();
  });
});

describe("PDF anhängen", () => {
  it("shows the action only on a source without a file and attaches the PDF", async () => {
    const user = userEvent.setup();
    const { calls } = renderApp("/");
    await user.type(await addField(), "10.1000/xyz123{Enter}");
    await user.click(await screen.findByRole("link", { name: "doi101000xyz123" }));

    expect(await screen.findByText("Kein Volltext vorhanden")).toBeVisible();
    const file = new File(["%PDF-1.4"], "xyz.pdf", { type: "application/pdf" });
    await user.upload(screen.getByTestId("attach-file-input"), file);
    await waitFor(() =>
      expect(calls.find((c) => c.name === "items.attach")?.input).toEqual({
        citekey: "doi101000xyz123",
        path: "xyz.pdf",
      }),
    );
    await waitFor(() => expect(screen.queryByText("Kein Volltext vorhanden")).toBeNull());
  });

  it("uses the native dialog in the desktop app", async () => {
    const user = userEvent.setup();
    const pickPaths = vi.fn(async () => ["/Users/alex/Papers/xyz.pdf"]);
    window.citegeist = { pickPaths, onNavigate: () => () => {}, platform: "test" } as never;
    try {
      const { calls } = renderApp("/");
      await user.type(await addField(), "10.1000/xyz123{Enter}");
      await user.click(await screen.findByRole("link", { name: "doi101000xyz123" }));
      await user.click(await screen.findByRole("button", { name: "PDF anhängen" }));
      await waitFor(() =>
        expect(calls.find((c) => c.name === "items.attach")?.input).toEqual({
          citekey: "doi101000xyz123",
          path: "/Users/alex/Papers/xyz.pdf",
        }),
      );
    } finally {
      delete window.citegeist;
    }
  });

  it("is absent on a source that has a file", async () => {
    renderApp("/items/luhmann1984soziale");
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByText("Kein Volltext vorhanden")).toBeNull();
  });
});

describe("Metadaten neu abrufen", () => {
  it("looks the metadata up again and names the fields that changed", async () => {
    const user = userEvent.setup();
    const { calls } = renderApp("/items/bowker1999sorting");
    await user.click(await screen.findByRole("button", { name: "Metadaten neu abrufen" }));
    expect(await screen.findByText("Aktualisiert: abstract")).toBeVisible();
    expect(calls.find((c) => c.name === "items.resolve")?.input).toEqual({
      citekey: "bowker1999sorting",
    });
  });

  it("says so when nothing changed", async () => {
    const user = userEvent.setup();
    renderApp("/items/luhmann1984soziale");
    await user.click(await screen.findByRole("button", { name: "Metadaten neu abrufen" }));
    expect(await screen.findByText("Nichts Neues gefunden")).toBeVisible();
  });

  it("shows the reason when the lookup fails", async () => {
    const user = userEvent.setup();
    const view = renderApp("/items/luhmann1984soziale");
    const original = view.core.call.bind(view.core);
    view.core.call = ((contract, input) =>
      contract.name === "items.resolve"
        ? Promise.reject(new Error("RESOLVE_FAILED: Crossref did not answer"))
        : original(contract, input)) as typeof view.core.call;
    await user.click(await screen.findByRole("button", { name: "Metadaten neu abrufen" }));
    expect(await screen.findByText("RESOLVE_FAILED: Crossref did not answer")).toBeVisible();
  });
});

describe("Weiterlesen", () => {
  const POSITION = { page: 215, label: "216", ratio: 0.3, at: "2026-10-23T10:00:00.000Z" };

  it("offers to read when nothing was read yet", async () => {
    renderApp("/items/luhmann1984soziale");
    expect(await screen.findByRole("button", { name: "Lesen beginnen" })).toBeVisible();
  });

  it("names the page where reading stopped and opens the reader at it", async () => {
    localStorage.setItem("citegeist.reading.luhmann1984soziale", JSON.stringify(POSITION));
    const user = userEvent.setup();
    const { history } = renderApp("/items/luhmann1984soziale", createReflowFixtures());
    await user.click(await screen.findByRole("button", { name: "Weiterlesen, S. 216" }));
    expect(await screen.findByTestId("reflow-scroll")).toBeInTheDocument();
    expect(history.location.search).toContain("resume=true");
    expect(history.location.search).toContain("tab=read");
  });

  it("remembers the position while the reader is scrolled", async () => {
    const user = userEvent.setup();
    renderApp("/items/luhmann1984soziale?tab=read", createReflowFixtures());
    await user.click(await screen.findByRole("button", { name: "Text" }));
    const scroller = await screen.findByTestId("reflow-scroll");
    fireEvent.scroll(scroller);
    await waitFor(
      () => expect(localStorage.getItem("citegeist.reading.luhmann1984soziale")).not.toBeNull(),
      { timeout: 3000 },
    );
    const saved = JSON.parse(localStorage.getItem("citegeist.reading.luhmann1984soziale") ?? "{}");
    expect(saved).toMatchObject({ page: 0, ratio: 0 });
  });
});

describe("card column export", () => {
  const written: Array<Record<string, Blob>> = [];
  class FakeClipboardItem {
    constructor(readonly data: Record<string, Blob>) {}
  }

  beforeEach(() => {
    written.length = 0;
    vi.stubGlobal("ClipboardItem", FakeClipboardItem);
  });
  afterEach(() => vi.unstubAllGlobals());

  const fakeClipboard = () =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        write: async (items: FakeClipboardItem[]) => {
          for (const i of items) written.push(i.data);
        },
        writeText: async () => {},
      },
    });

  it("copies every card of a source as direct citations", async () => {
    const user = userEvent.setup();
    fakeClipboard();
    const { calls, data } = renderApp("/items/luhmann1984soziale");
    await screen.findAllByRole("button", { name: /Karte öffnen|im Reader/i }).catch(() => []);
    await user.click(await screen.findByRole("button", { name: "Exportieren" }));
    await user.click(await screen.findByRole("menuitem", { name: "Als direkte Zitate kopieren" }));

    expect(await screen.findByText("3 Karten kopiert")).toBeVisible();
    const call = calls.find((c) => c.name === "cards.export");
    const ids = data.cards.filter((c) => c.frontmatter.item === "luhmann1984soziale");
    expect(call?.input).toMatchObject({
      mode: "direct",
      format: "html",
      ids: ids.map((c) => c.frontmatter.id),
    });
    expect(written).toHaveLength(1);
    const text = await (written[0] as Record<string, Blob>)["text/plain"]?.text();
    expect(text).toContain("„Soziale Systeme bestehen aus Kommunikationen");
    expect(text).toContain("„Doppelte Kontingenz ist der Ausgangspunkt");
    expect(text?.split("\n\n")).toHaveLength(3);
  });

  it("copies indirect citations from the reader column too", async () => {
    const user = userEvent.setup();
    fakeClipboard();
    const { calls } = renderApp("/items/luhmann1984soziale?tab=read", createReflowFixtures());
    await user.click(await screen.findByRole("button", { name: "Exportieren" }));
    await user.click(
      await screen.findByRole("menuitem", { name: "Als indirekte Zitate kopieren" }),
    );
    expect(await screen.findByText("3 Karten kopiert")).toBeVisible();
    expect(calls.find((c) => c.name === "cards.export")?.input).toMatchObject({
      mode: "indirect",
    });
  });

  it("shows the message of the core when the export fails", async () => {
    const user = userEvent.setup();
    fakeClipboard();
    const view = renderApp("/items/luhmann1984soziale");
    const original = view.core.call.bind(view.core);
    view.core.call = ((contract, input) =>
      contract.name === "cards.export"
        ? Promise.reject(new Error("CARD_NOT_FOUND: no card with id"))
        : original(contract, input)) as typeof view.core.call;
    await user.click(await screen.findByRole("button", { name: "Exportieren" }));
    await user.click(await screen.findByRole("menuitem", { name: "Als direkte Zitate kopieren" }));
    expect(await screen.findByText(/CARD_NOT_FOUND/)).toBeVisible();
  });
});

describe("project card tab", () => {
  it("lists the cards of the project with their source, and filters by kind", async () => {
    const user = userEvent.setup();
    const { calls } = renderApp("/projects/phd-proposal?tab=cards");
    const items = await screen.findAllByTestId("project-card");
    expect(items).toHaveLength(3);
    expect(calls.find((c) => c.name === "cards.list")?.input).toMatchObject({
      project: "phd-proposal",
    });
    expect(
      within(items[0] as HTMLElement).getByRole("link", { name: /luhmann1984soziale/ }),
    ).toBeVisible();
    expect(screen.getByText("3 Karten")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Definition" }));
    expect(screen.getAllByTestId("project-card")).toHaveLength(1);
    expect(screen.getByText("1 Karte")).toBeVisible();
  });

  it("shows the card count on the tab and exports the cards of the project", async () => {
    const user = userEvent.setup();
    const { calls } = renderApp("/projects/phd-proposal?tab=cards");
    await screen.findAllByTestId("project-card");
    expect(screen.getByRole("link", { name: /^Karten\s*3$/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await user.click(screen.getByRole("button", { name: "Exportieren" }));
    await user.click(await screen.findByRole("menuitem", { name: "Als direkte Zitate kopieren" }));
    await waitFor(() =>
      expect(calls.find((c) => c.name === "cards.export")?.input).toMatchObject({
        project: "phd-proposal",
      }),
    );
  });

  it("says so when a project has no cards", async () => {
    renderApp("/projects/reading-group?tab=cards");
    expect(await screen.findByText("Noch keine Karten in diesem Projekt")).toBeVisible();
  });

  it("opens a card in the reader", async () => {
    const user = userEvent.setup();
    const { history } = renderApp("/projects/phd-proposal?tab=cards", createReflowFixtures());
    const first = (await screen.findAllByTestId("project-card"))[0] as HTMLElement;
    await act(async () => {
      await user.click(within(first).getByRole("button", { name: /Im Reader öffnen|Reader/ }));
    });
    await waitFor(() => expect(history.location.pathname).toBe("/items/luhmann1984soziale"));
    expect(history.location.search).toContain("tab=read");
  });
});
