import { ItemFrontmatter } from "@citegeist/schema";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { createFixtures } from "../mock/fixtures";
import { renderApp } from "../test-utils";
import { slugFor } from "./project-membership";

const projectsOf = (data: ReturnType<typeof createFixtures>, citekey: string): string[] =>
  data.items.get(citekey)?.frontmatter.projects ?? [];

describe("slugFor", () => {
  it("builds a slug from a title and numbers it when taken", () => {
    expect(slugFor("Dissertation: Größe & Maß", [])).toBe("dissertation-grosse-mass");
    expect(slugFor("Reading group", ["reading-group", "reading-group-2"])).toBe("reading-group-3");
    expect(slugFor("???", [])).toBe("projekt");
  });
});

describe("library: add to project", () => {
  it("adds the selected items to a project with one projects.addItems call", async () => {
    const user = userEvent.setup();
    const { calls, data } = renderApp("/");
    await screen.findAllByTestId("item-row");
    expect(
      screen.queryByRole("toolbar", { name: "Aktionen für die ausgewählten Quellen" }),
    ).toBeNull();

    await user.click(
      screen.getByRole("checkbox", {
        name: "Sorting Things Out: Classification and Its Consequences auswählen",
      }),
    );
    await user.click(screen.getByRole("checkbox", { name: "As We May Think auswählen" }));
    const bar = screen.getByRole("toolbar", { name: "Aktionen für die ausgewählten Quellen" });
    expect(within(bar).getByText("2 ausgewählt")).toBeVisible();
    expect(within(bar).queryByRole("button", { name: "Aus Projekt entfernen" })).toBeNull();

    await user.click(within(bar).getByRole("button", { name: "Zu Projekt hinzufügen" }));
    await user.click(await screen.findByRole("menuitem", { name: "PhD proposal" }));

    await waitFor(() =>
      expect(calls.filter((c) => c.name === "projects.addItems")).toHaveLength(1),
    );
    expect(calls.find((c) => c.name === "projects.addItems")?.input).toEqual({
      slug: "phd-proposal",
      citekeys: ["bowker1999sorting", "bush1945think"],
    });
    expect(projectsOf(data, "bowker1999sorting")).toEqual(["phd-proposal"]);
    expect(projectsOf(data, "bush1945think")).toEqual(["phd-proposal"]);
    expect(await screen.findByText("2 Quellen zu PhD proposal hinzugefügt.")).toBeVisible();
    // the selection is gone afterwards
    expect(
      screen.queryByRole("toolbar", { name: "Aktionen für die ausgewählten Quellen" }),
    ).toBeNull();
  });

  it("selects a range with shift and undoes the change from the toast", async () => {
    const user = userEvent.setup();
    const { data } = renderApp("/");
    const rows = await screen.findAllByTestId("item-row");
    const boxes = rows.map((r) => within(r).getByRole("checkbox"));
    await user.click(boxes[0] as HTMLElement);
    await user.keyboard("{Shift>}");
    await user.click(boxes[2] as HTMLElement);
    await user.keyboard("{/Shift}");
    const bar = screen.getByRole("toolbar", { name: "Aktionen für die ausgewählten Quellen" });
    expect(within(bar).getByText("3 ausgewählt")).toBeVisible();

    await user.click(within(bar).getByRole("button", { name: "Zu Projekt hinzufügen" }));
    await user.click(await screen.findByRole("menuitem", { name: "Reading group" }));
    await screen.findByText(/Quellen zu Reading group hinzugefügt/);
    const keys = ["ahrens2017how", "bowker1999sorting", "bush1945think"];
    for (const key of keys) expect(projectsOf(data, key)).toContain("reading-group");

    await user.click(screen.getByRole("button", { name: "Rückgängig" }));
    await waitFor(() => {
      for (const key of keys) expect(projectsOf(data, key)).not.toContain("reading-group");
    });
  });

  it("creates a new project from the menu and adds the items to it", async () => {
    const user = userEvent.setup();
    const { calls, data } = renderApp("/");
    await screen.findAllByTestId("item-row");
    await user.click(screen.getByRole("checkbox", { name: "As We May Think auswählen" }));
    await user.click(screen.getByRole("button", { name: "Zu Projekt hinzufügen" }));
    await user.click(await screen.findByRole("menuitem", { name: "Neues Projekt …" }));
    await user.type(
      screen.getByRole("textbox", { name: "Titel des neuen Projekts" }),
      "Zettelkasten Studie",
    );
    await user.click(screen.getByRole("button", { name: "Anlegen" }));

    await waitFor(() => expect(data.projects.has("zettelkasten-studie")).toBe(true));
    expect(calls.find((c) => c.name === "projects.create")?.input).toEqual({
      slug: "zettelkasten-studie",
      title: "Zettelkasten Studie",
    });
    await waitFor(() => expect(projectsOf(data, "bush1945think")).toEqual(["zettelkasten-studie"]));
    expect(await screen.findByText("1 Quelle zu Zettelkasten Studie hinzugefügt.")).toBeVisible();
  });

  it("removes the selected items from the project of the list", async () => {
    const user = userEvent.setup();
    const { calls, data } = renderApp("/projects/rag-evaluation?tab=list");
    await screen.findAllByTestId("item-row");
    await user.click(
      screen.getByRole("checkbox", {
        name: "Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks auswählen",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Aus Projekt entfernen" }));
    await waitFor(() =>
      expect(calls.find((c) => c.name === "projects.removeItems")?.input).toEqual({
        slug: "rag-evaluation",
        citekeys: ["lewis2020retrieval"],
      }),
    );
    expect(projectsOf(data, "lewis2020retrieval")).toEqual([]);
    expect(await screen.findByText("1 Quelle aus RAG evaluation entfernt.")).toBeVisible();
  });
});

describe("item view: project chips", () => {
  it("adds the item to a project with + Projekt", async () => {
    const user = userEvent.setup();
    const { calls, data } = renderApp("/items/bowker1999sorting");
    await user.click(await screen.findByRole("button", { name: "Zu einem Projekt hinzufügen" }));
    await user.click(await screen.findByRole("menuitem", { name: "RAG evaluation" }));
    expect(
      await screen.findByRole("button", { name: "Aus Projekt RAG evaluation entfernen" }),
    ).toBeVisible();
    expect(calls.find((c) => c.name === "projects.addItems")?.input).toEqual({
      slug: "rag-evaluation",
      citekeys: ["bowker1999sorting"],
    });
    expect(projectsOf(data, "bowker1999sorting")).toEqual(["rag-evaluation"]);
  });

  it("offers only projects the item is not in", async () => {
    const user = userEvent.setup();
    renderApp("/items/luhmann1984soziale");
    await user.click(await screen.findByRole("button", { name: "Zu einem Projekt hinzufügen" }));
    expect(await screen.findByRole("menuitem", { name: "RAG evaluation" })).toBeVisible();
    expect(screen.queryByRole("menuitem", { name: "PhD proposal" })).toBeNull();
  });

  it("removes a project with the x of its chip", async () => {
    const user = userEvent.setup();
    const { calls, data } = renderApp("/items/luhmann1984soziale");
    await user.click(
      await screen.findByRole("button", { name: "Aus Projekt PhD proposal entfernen" }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Aus Projekt PhD proposal entfernen" }),
      ).toBeNull(),
    );
    expect(calls.find((c) => c.name === "projects.removeItems")?.input).toEqual({
      slug: "phd-proposal",
      citekeys: ["luhmann1984soziale"],
    });
    expect(projectsOf(data, "luhmann1984soziale")).toEqual([]);
  });
});

describe("project view: add sources", () => {
  it("searches the library by title, author or citekey and adds several sources", async () => {
    const user = userEvent.setup();
    const { calls, data } = renderApp("/projects/rag-evaluation?tab=list");
    await screen.findAllByTestId("item-row");
    await user.click(screen.getByRole("button", { name: "Quellen hinzufügen" }));
    const panel = screen.getByRole("region", { name: "Quellen hinzufügen" });
    // sources of the project are not offered
    expect(within(panel).queryByText("es2023ragas")).toBeNull();

    await user.type(
      within(panel).getByRole("textbox", { name: "Bibliothek durchsuchen" }),
      "bowker",
    );
    expect(within(panel).getAllByRole("checkbox")).toHaveLength(1);
    await user.clear(within(panel).getByRole("textbox", { name: "Bibliothek durchsuchen" }));
    await user.type(within(panel).getByRole("textbox", { name: "Bibliothek durchsuchen" }), "Bush");
    await user.click(within(panel).getByRole("checkbox", { name: "As We May Think auswählen" }));
    await user.clear(within(panel).getByRole("textbox", { name: "Bibliothek durchsuchen" }));
    await user.type(
      within(panel).getByRole("textbox", { name: "Bibliothek durchsuchen" }),
      "kuhn1962",
    );
    await user.click(
      within(panel).getByRole("checkbox", {
        name: "The Structure of Scientific Revolutions auswählen",
      }),
    );
    await user.click(within(panel).getByRole("button", { name: "Hinzufügen (2)" }));

    await waitFor(() =>
      expect(calls.find((c) => c.name === "projects.addItems")?.input).toEqual({
        slug: "rag-evaluation",
        citekeys: ["bush1945think", "kuhn1962structure"],
      }),
    );
    expect(projectsOf(data, "bush1945think")).toEqual(["rag-evaluation"]);
    expect(await screen.findByText("2 Quellen zu RAG evaluation hinzugefügt.")).toBeVisible();
    expect(screen.queryByRole("region", { name: "Quellen hinzufügen" })).toBeNull();
  });

  it("offers the picker from an empty project", async () => {
    const user = userEvent.setup();
    renderApp("/projects/reading-group?tab=list");
    await user.click(await screen.findByRole("button", { name: "Quellen hinzufügen" }));
    expect(await screen.findByRole("region", { name: "Quellen hinzufügen" })).toBeVisible();
  });
});

describe("inbox: accept into a project", () => {
  it("adds the accepted item to the chosen project", async () => {
    const user = userEvent.setup();
    const { calls, data } = renderApp("/inbox");
    await screen.findAllByTestId("inbox-row");
    await user.click(screen.getByRole("combobox", { name: "Beim Annehmen zu Projekt" }));
    await user.click(await screen.findByRole("option", { name: "PhD proposal" }));
    await user.click(screen.getByRole("button", { name: "Custodians of the Internet annehmen" }));

    await waitFor(() => expect(calls.some((c) => c.name === "inbox.accept")).toBe(true));
    expect(calls.find((c) => c.name === "projects.addItems")?.input).toEqual({
      slug: "phd-proposal",
      citekeys: ["gillespie2018custodians"],
    });
    expect(projectsOf(data, "gillespie2018custodians")).toEqual(["phd-proposal"]);
    expect(data.items.get("gillespie2018custodians")?.frontmatter.inbox).toBeUndefined();
  });

  it("preselects the project that all waiting items came with", async () => {
    const data = createFixtures();
    for (const [, item] of data.items) {
      if (item.frontmatter.inbox) {
        item.frontmatter = ItemFrontmatter.parse({
          ...item.frontmatter,
          projects: ["rag-evaluation"],
        });
      }
    }
    const { calls } = renderApp("/inbox", data);
    const user = userEvent.setup();
    await screen.findAllByTestId("inbox-row");
    expect(screen.getByRole("combobox", { name: "Beim Annehmen zu Projekt" })).toHaveTextContent(
      "RAG evaluation",
    );
    expect(screen.getAllByText("In RAG evaluation")).toHaveLength(3);
    await user.click(screen.getByRole("button", { name: "Alle annehmen" }));
    await waitFor(() => expect(calls.some((c) => c.name === "inbox.accept")).toBe(true));
    expect(calls.find((c) => c.name === "projects.addItems")?.input).toMatchObject({
      slug: "rag-evaluation",
    });
  });

  it("adds no project when none is chosen", async () => {
    const user = userEvent.setup();
    const { calls } = renderApp("/inbox");
    await screen.findAllByTestId("inbox-row");
    await user.click(screen.getByRole("button", { name: "Alle annehmen" }));
    await waitFor(() => expect(calls.some((c) => c.name === "inbox.accept")).toBe(true));
    expect(calls.some((c) => c.name === "projects.addItems")).toBe(false);
  });
});
