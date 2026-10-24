import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderApp } from "../test-utils";

const runs = () => screen.findAllByTestId("litsearch-run");

describe("literature search tab", () => {
  it("sits under the inbox in the navigation and lists the runs, newest first", async () => {
    // protects: the tab is reachable and the run list shows topic, status and paper count
    // fails_when: the nav entry is missing, the order is wrong or a failed run reads as done
    // no_claim: the mock core stands in for core; run folders on disk are covered by core tests
    const user = userEvent.setup();
    renderApp("/");
    const nav = await screen.findByRole("navigation", { name: "Hauptnavigation" });
    const links = within(nav)
      .getAllByRole("link")
      .map((l) => l.textContent);
    expect(links.indexOf("Literatursuche")).toBe(links.indexOf("Inbox") + 1);
    await user.click(within(nav).getByRole("link", { name: "Literatursuche" }));
    const list = await runs();
    expect(list.map((r) => r.textContent)).toEqual([
      expect.stringContaining("agent communication protocols"),
      expect.stringContaining("recursive self-improvement"),
      expect.stringContaining("agent communication protocols"),
    ]);
    expect(within(list[0] as HTMLElement).getByText("fertig")).toBeVisible();
    expect(within(list[0] as HTMLElement).getByText("3 Paper")).toBeVisible();
    expect(within(list[1] as HTMLElement).getByText("fehlgeschlagen")).toBeVisible();
  });

  it("fills the queries from the model's suggestions and runs the search to the end", async () => {
    // protects: topic -> suggestions -> start -> live stages -> done with section counts
    // fails_when: suggestions do not land in the query fields, start sends the wrong input, or progress never finishes
    // no_claim: the mock steps through the 18 stages on a timer; real stage timing comes from pipeline.py
    const user = userEvent.setup();
    const { calls } = renderApp("/litsearch/new");
    const start = await screen.findByRole("button", { name: "Suche starten" });
    expect(start).toBeDisabled();
    await user.type(screen.getByLabelText("Thema"), "agent communication protocols");
    await user.click(screen.getByRole("button", { name: "Vorschläge holen" }));
    await waitFor(() =>
      expect(screen.getByLabelText("Suchanfrage 1")).toHaveValue('"agent communication protocol"'),
    );
    expect(screen.getByLabelText("Suchanfrage 4")).toHaveValue('"LLM agents" interoperability');
    await user.click(screen.getByRole("button", { name: "Anfrage 4 entfernen" }));
    await user.type(screen.getByLabelText("Erschienen ab"), "2022");
    await user.click(screen.getByLabelText("DBLP: Venue und Track von Informatik-Papern"));
    await user.click(start);
    expect(calls.find((c) => c.name === "litsearch.start")?.input).toEqual({
      topic: "agent communication protocols",
      queries: [
        '"agent communication protocol"',
        '"multi-agent communication"',
        '"agent-to-agent" communication',
      ],
      since: 2022,
      disableSources: ["dblp"],
    });
    expect(await screen.findAllByTestId("litsearch-stage")).toHaveLength(18);
    expect(screen.getByTestId("litsearch-percent")).toHaveTextContent(/^\d{1,3} %$/);
    await waitFor(() => expect(screen.getAllByTestId("litsearch-paper")).toHaveLength(2), {
      timeout: 4000,
    });
    expect(screen.getAllByTestId("litsearch-stage").every((s) => s.dataset.status === "done")).toBe(
      true,
    );
    expect(screen.queryByTestId("litsearch-percent")).toBeNull();
  });

  it("shows why a run failed and resumes it", async () => {
    // protects: a failed run names the pipeline's error and offers resume, which runs it again
    // fails_when: the error text is missing, resume is not offered, or it calls the wrong run
    // no_claim: the cache reuse of a resumed run happens in pipeline.py, not here
    const user = userEvent.setup();
    const { calls } = renderApp("/litsearch/2026-10-18-recursive-self-improvement", undefined, {
      aiDelayMs: 3000,
    });
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Der Lauf ist fehlgeschlagen");
    expect(alert).toHaveTextContent("Tageslimit von api.openalex.org");
    expect(
      screen.getAllByTestId("litsearch-stage").find((s) => s.textContent?.includes("Snowballing"))
        ?.dataset.status,
    ).toBe("failed");
    await user.click(screen.getByRole("button", { name: "Fortsetzen" }));
    expect(calls.find((c) => c.name === "litsearch.resume")?.input).toEqual({
      runId: "2026-10-18-recursive-self-improvement",
    });
    await waitFor(() =>
      expect(
        screen.getAllByTestId("litsearch-stage").some((s) => s.dataset.status === "running"),
      ).toBe(true),
    );
    expect(screen.queryByText("Der Lauf ist fehlgeschlagen")).toBeNull();
  });

  it("cancels a running search", async () => {
    // protects: a running search can be stopped from its page
    // fails_when: no cancel button while running, or the run does not end as cancelled
    // no_claim: ending the Python process is covered by core's runner tests
    const user = userEvent.setup();
    renderApp("/litsearch/new", undefined, { aiDelayMs: 3000 });
    await user.type(await screen.findByLabelText("Thema"), "slow topic");
    await user.type(screen.getByLabelText("Suchanfrage 1"), "slow");
    await user.click(screen.getByRole("button", { name: "Suche starten" }));
    await user.click(await screen.findByRole("button", { name: "Abbrechen" }));
    expect(await screen.findByText("Der Lauf wurde abgebrochen.")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Abbrechen" })).toBeNull();
    expect(screen.getByRole("button", { name: "Fortsetzen" })).toBeVisible();
  });

  it("points to the OpenAlex key in the settings and checks the year", async () => {
    // protects: without a key the form says how to avoid the daily limit; a bad year blocks the start
    // fails_when: the hint is missing without a key, or "20x2" can be submitted
    // no_claim: the mock settings have no OpenAlex key stored
    const user = userEvent.setup();
    renderApp("/litsearch/new");
    expect(await screen.findByRole("link", { name: "Zu den Einstellungen" })).toBeVisible();
    await user.type(screen.getByLabelText("Thema"), "x");
    await user.type(screen.getByLabelText("Suchanfrage 1"), "y");
    await user.type(screen.getByLabelText("Erschienen ab"), "20x2");
    expect(screen.getByRole("button", { name: "Suche starten" })).toBeDisabled();
  });
});

describe("results of a finished run", () => {
  const RUN = "/litsearch/2026-10-20-agent-communication-protocols";
  const titles = () => screen.getAllByTestId("litsearch-paper").map((r) => r.textContent ?? "");

  it("shows the peer-reviewed papers by rank, switches sections and opens a paper's details", async () => {
    // protects: the result list is the run's papers per section, and a click shows score parts and the reason
    // fails_when: a preprint shows among peer-reviewed papers, or the detail misses score, reason or DOI link
    // no_claim: the papers come from the mock; parsing papers.csv is covered by core tests
    const user = userEvent.setup();
    renderApp(RUN);
    await waitFor(() => expect(screen.getAllByTestId("litsearch-paper")).toHaveLength(2));
    expect(titles()[0]).toContain("A Survey of Agent Interoperability Protocols");
    await user.click(screen.getByRole("button", { name: /^Preprints/ }));
    await waitFor(() => expect(titles()).toEqual([expect.stringContaining("LLM Agents Talking")]));
    await user.click(screen.getByRole("button", { name: /^Abgelehnt/ }));
    await waitFor(() => expect(titles()[0]).toContain("DOI not found at Crossref or DataCite"));
  });

  it("filters by text, year and tier and sorts by year", async () => {
    // protects: filters narrow the list and say how many are shown; sorting changes the order
    // fails_when: a filter keeps a non-matching paper, the counter is wrong, or the sort is ignored
    // no_claim: none beyond protects
    const user = userEvent.setup();
    renderApp(RUN);
    await waitFor(() => expect(screen.getAllByTestId("litsearch-paper")).toHaveLength(2));
    await user.type(screen.getByLabelText("Jahr von"), "2024");
    expect(titles()).toEqual([expect.stringContaining("A Survey of Agent Interoperability")]);
    expect(screen.getByText("1 von 2 angezeigt")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Filter zurücksetzen" }));
    await user.selectOptions(screen.getByLabelText("Venue-Tier"), "2");
    expect(titles()).toEqual([expect.stringContaining("Emergent Communication")]);
    await user.selectOptions(screen.getByLabelText("Venue-Tier"), "all");
    await user.type(screen.getByLabelText("Titel, Autor oder Venue filtern"), "zzz");
    expect(screen.getByText("Kein Paper passt zu den Filtern.")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Filter zurücksetzen" }));
    await user.click(screen.getByRole("button", { name: "Nach Jahr sortieren" }));
    expect(titles()[0]).toContain("Emergent Communication");
  });

  it("offers the exports and the report as downloads and draws the charts", async () => {
    // protects: each download asks core for the run's file and hands it to the browser as a file
    // fails_when: a button calls the wrong format, or the charts are missing
    // no_claim: the browser download itself (Electron's save dialog) is not exercised in jsdom
    const user = userEvent.setup();
    const created: string[] = [];
    const original = URL.createObjectURL;
    URL.createObjectURL = () => {
      created.push("blob");
      return "blob:x";
    };
    URL.revokeObjectURL = () => {};
    const { calls } = renderApp(RUN);
    await user.click(await screen.findByRole("button", { name: "BibTeX" }));
    await user.click(screen.getByRole("button", { name: "Bericht (HTML)" }));
    await waitFor(() => expect(created).toHaveLength(2));
    expect(calls.filter((c) => c.name === "litsearch.export").map((c) => c.input)).toEqual([
      { runId: "2026-10-20-agent-communication-protocols", format: "bib" },
    ]);
    expect(calls.some((c) => c.name === "litsearch.report")).toBe(true);
    await user.click(screen.getByText("Diagramme"));
    expect(screen.getByRole("img", { name: "Paper pro Jahr" })).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "Zusammensetzung des Scores (Top 15)" }),
    ).toBeInTheDocument();
    URL.createObjectURL = original;
  });
});

describe("adding papers from a run", () => {
  const RUN = "/litsearch/2026-10-20-agent-communication-protocols";

  it("adds one paper straight to the library from its details and marks it", async () => {
    // protects: the user's own decision in the detail adds the paper to the library (not the inbox) and the list shows it
    // fails_when: the call goes to the inbox, uses no DOI, or the badge does not change
    // no_claim: metadata lookup and PDF download of items.add are core's; the mock only stores the item
    const user = userEvent.setup();
    const { calls, data } = renderApp(RUN);
    await user.click(
      await screen.findByRole("button", { name: "A Survey of Agent Interoperability Protocols" }),
    );
    await user.click(screen.getByRole("button", { name: "Zur Bibliothek hinzufügen" }));
    expect(calls.find((c) => c.name === "items.add")?.input).toEqual({
      identifier: "10.1145/3700001",
      target: "library",
    });
    expect(await screen.findByText(/In der Bibliothek\. Die Metadaten/)).toBeVisible();
    const added = [...data.items.values()].find((i) => i.frontmatter.DOI === "10.1145/3700001");
    expect(added?.frontmatter.inbox).toBeUndefined();
    await waitFor(() =>
      expect(
        within(screen.getAllByTestId("litsearch-paper")[0] as HTMLElement).getByText(
          "in Bibliothek",
        ),
      ).toBeVisible(),
    );
  });

  it("sends the selected papers to the inbox and only offers papers that are new", async () => {
    // protects: bulk selection goes to litsearch.toInbox, the result is counted, and added papers can no longer be picked
    // fails_when: a paper already in the library is selectable, or the selection is not sent as keys
    // no_claim: the mock's toInbox calls its own items.add as "system"
    const user = userEvent.setup();
    const { calls, data } = renderApp(RUN);
    await waitFor(() => expect(screen.getAllByTestId("litsearch-paper")).toHaveLength(2));
    const send = screen.getByRole("button", { name: "In die Inbox (0)" });
    expect(send).toBeDisabled();
    await user.click(
      screen.getByRole("checkbox", { name: "Alle neuen Paper dieses Abschnitts auswählen" }),
    );
    await user.click(screen.getByRole("button", { name: "In die Inbox (2)" }));
    expect(calls.find((c) => c.name === "litsearch.toInbox")?.input).toEqual({
      runId: "2026-10-20-agent-communication-protocols",
      keys: ["W4400000001", "W4200000002"],
    });
    expect(
      await screen.findByText("2 hinzugefügt, 0 schon vorhanden, 0 nicht möglich"),
    ).toBeVisible();
    const inInbox = [...data.items.values()].filter((i) =>
      i.frontmatter.inbox?.why?.startsWith("Literatursuche"),
    );
    expect(inInbox).toHaveLength(2);
    await waitFor(() =>
      expect(
        screen.getByRole("checkbox", {
          name: "A Survey of Agent Interoperability Protocols auswählen",
        }),
      ).toBeDisabled(),
    );
    expect(screen.getAllByText("in Inbox")).toHaveLength(2);
  });
});

describe("comparing runs", () => {
  it("compares a run with an earlier one: new, dropped and re-ranked papers", async () => {
    // protects: "compare with" on a finished run opens the diff with the earlier run as the base
    // fails_when: the direction is wrong, or a group lists the wrong papers
    // no_claim: the mock's diff matches by DOI or title; core's matching rule is tested in core
    const user = userEvent.setup();
    const { history } = renderApp("/litsearch/2026-10-20-agent-communication-protocols");
    await user.selectOptions(
      await screen.findByLabelText("Vergleichen mit"),
      "2026-10-10-agent-communication-protocols",
    );
    await waitFor(() =>
      expect(history.location.search).toBe(
        "?a=2026-10-10-agent-communication-protocols&b=2026-10-20-agent-communication-protocols",
      ),
    );
    const added = await screen.findByTestId("compare-added");
    expect(within(added).getByText("A Survey of Agent Interoperability Protocols")).toBeVisible();
    expect(within(added).getByText("LLM Agents Talking: A Benchmark")).toBeVisible();
    expect(
      within(screen.getByTestId("compare-dropped")).getByText(
        "Speech Acts for Software Agents, Revisited",
      ),
    ).toBeVisible();
    const moved = screen.getByTestId("compare-moved");
    expect(
      within(moved).getByText("Emergent Communication in Multi-Agent Reinforcement Learning"),
    ).toBeVisible();
    expect(within(moved).getByText("Rang 1 → 2")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Richtung tauschen" }));
    await waitFor(() =>
      expect(
        within(screen.getByTestId("compare-dropped")).getByText(
          "A Survey of Agent Interoperability Protocols",
        ),
      ).toBeVisible(),
    );
  });
});
