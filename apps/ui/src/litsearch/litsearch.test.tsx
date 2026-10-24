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
    await waitFor(() => expect(screen.getByText("Fertig")).toBeVisible(), { timeout: 4000 });
    expect(screen.getAllByTestId("litsearch-stage").every((s) => s.dataset.status === "done")).toBe(
      true,
    );
    expect(screen.getByText("Begutachtet").nextSibling).toHaveTextContent("2");
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
