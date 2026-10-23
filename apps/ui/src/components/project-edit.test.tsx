import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderApp } from "../test-utils";

describe("project brief editor", () => {
  it("saves a changed brief with projects.update", async () => {
    const user = userEvent.setup();
    const { calls, data } = renderApp("/projects/rag-evaluation");
    await user.click(await screen.findByRole("button", { name: "Brief bearbeiten" }));
    const field = screen.getByRole("textbox", { name: "Projektbrief bearbeiten" });
    await user.clear(field);
    await user.type(field, "# Brief{Enter}{Enter}Neue Fragestellung.");
    await user.click(screen.getByRole("button", { name: "Speichern" }));

    expect(await screen.findByText("Neue Fragestellung.")).toBeVisible();
    expect(calls.find((c) => c.name === "projects.update")?.input).toEqual({
      slug: "rag-evaluation",
      patch: {},
      brief: "# Brief\n\nNeue Fragestellung.",
    });
    expect(data.projects.get("rag-evaluation")?.brief).toBe("# Brief\n\nNeue Fragestellung.");
    expect(screen.queryByRole("textbox", { name: "Projektbrief bearbeiten" })).toBeNull();
  });

  it("keeps the old brief when editing is cancelled", async () => {
    const user = userEvent.setup();
    const { calls } = renderApp("/projects/rag-evaluation");
    await user.click(await screen.findByRole("button", { name: "Brief bearbeiten" }));
    await user.type(screen.getByRole("textbox", { name: "Projektbrief bearbeiten" }), "x");
    await user.click(screen.getByRole("button", { name: "Abbrechen" }));
    expect(screen.getByText(/Evaluate retrieval-augmented generation/)).toBeVisible();
    expect(calls.some((c) => c.name === "projects.update")).toBe(false);
  });

  it("writes the AI language of the project", async () => {
    const user = userEvent.setup();
    const { calls, data } = renderApp("/projects/rag-evaluation");
    await user.click(await screen.findByRole("combobox", { name: "Sprache der KI-Texte" }));
    await user.click(await screen.findByRole("option", { name: "English" }));
    await waitFor(() =>
      expect(calls.find((c) => c.name === "projects.update")?.input).toEqual({
        slug: "rag-evaluation",
        patch: { ai_language: "en" },
      }),
    );
    expect(data.projects.get("rag-evaluation")?.frontmatter.ai_language).toBe("en");
  });
});

describe("project export", () => {
  const downloads: Array<{ name: string; blob: Blob }> = [];
  let blobs: Blob[] = [];

  beforeEach(() => {
    downloads.length = 0;
    blobs = [];
    URL.createObjectURL = (blob: Blob | MediaSource) => {
      blobs.push(blob as Blob);
      return `blob:mock/${blobs.length - 1}`;
    };
    URL.revokeObjectURL = () => {};
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      const blob = blobs[Number(this.href.split("/").pop())];
      if (blob) downloads.push({ name: this.download, blob });
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it("downloads the project's bibliography as .bib", async () => {
    const user = userEvent.setup();
    const { calls } = renderApp("/projects/phd-proposal");
    await screen.findAllByTestId("item-row");
    await user.click(screen.getByRole("button", { name: "Als .bib exportieren" }));
    await waitFor(() => expect(downloads).toHaveLength(1));

    expect(calls.find((c) => c.name === "cite.format")?.input).toMatchObject({
      mode: "bibliography",
      format: "bibtex",
      project: "phd-proposal",
      items: [
        { citekey: "habermas1981theorie" },
        { citekey: "latour2005reassembling" },
        { citekey: "luhmann1984soziale" },
      ],
    });
    expect(downloads[0]?.name).toBe("phd-proposal.bib");
    const text = await downloads[0]?.blob.text();
    expect(text).toContain("@book{luhmann1984soziale,");
    expect(text).toContain("author = {Luhmann, Niklas}");
  });

  it("downloads the project's bibliography as CSL-JSON", async () => {
    const user = userEvent.setup();
    renderApp("/projects/rag-evaluation");
    await screen.findAllByTestId("item-row");
    await user.click(screen.getByRole("button", { name: "Als CSL-JSON exportieren" }));
    await waitFor(() => expect(downloads).toHaveLength(1));
    expect(downloads[0]?.name).toBe("rag-evaluation.json");
    const entries = JSON.parse((await downloads[0]?.blob.text()) ?? "[]") as Array<{ id: string }>;
    expect(entries.map((e) => e.id)).toContain("lewis2020retrieval");
  });

  it("offers no export for an empty project", async () => {
    renderApp("/projects/reading-group");
    expect(await screen.findByRole("button", { name: "Als .bib exportieren" })).toBeDisabled();
  });
});
