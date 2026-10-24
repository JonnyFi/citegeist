import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { pollConfig } from "../onboarding/parts";
import { renderApp } from "../test-utils";
import { alertsDe, alertsEn } from "./strings";

beforeEach(() => {
  localStorage.clear();
  pollConfig.ms = 5;
});

describe("alerts in the project view", () => {
  it("lists the alerts of the project with the last run and the found count", async () => {
    const { calls } = renderApp("/projects/rag-evaluation");
    const alert = await screen.findByTestId("alert");
    expect(within(alert).getByText("RAG-Paper aus der Informatik")).toBeVisible();
    expect(alert).toHaveTextContent("arXiv-Suche: retrieval augmented generation evaluation");
    expect(alert).toHaveTextContent("täglich");
    expect(within(alert).getByTestId("alert-last-run")).toHaveTextContent(
      "9 neu gefunden, 5 in die Inbox (nach dem Briefing geordnet)",
    );
    // The library-wide alert belongs to no project, so it is not listed here.
    expect(screen.queryByText("Neue Arbeiten zu NLP")).toBeNull();
    expect(calls.find((c) => c.name === "alerts.list")?.input).toEqual({
      project: "rag-evaluation",
    });
  });

  it("runs an alert now and shows the new result when the job is done", async () => {
    const user = userEvent.setup();
    const { calls } = renderApp("/projects/rag-evaluation");
    const alert = await screen.findByTestId("alert");
    await user.click(within(alert).getByRole("button", { name: "Jetzt ausführen" }));
    expect(await within(alert).findByRole("button", { name: "Läuft" })).toBeDisabled();
    expect(calls.find((c) => c.name === "alerts.runNow")?.input).toEqual({ id: "rag-papers" });
    expect(
      await within(alert).findByText("Der Lauf ist fertig.", {}, { timeout: 3000 }),
    ).toBeVisible();
    expect(within(alert).getByTestId("alert-last-run")).toHaveTextContent(
      "7 neu gefunden, 5 in die Inbox",
    );
    expect(within(alert).getByRole("button", { name: "Jetzt ausführen" })).toBeEnabled();
  });

  it("creates an alert for the project with ranking", async () => {
    const user = userEvent.setup();
    const { calls } = renderApp("/projects/rag-evaluation");
    await screen.findByTestId("alert");
    await user.type(screen.getByLabelText("Name"), "Chunking");
    await user.type(screen.getByLabelText("Suchwert"), "cs.IR");
    await user.click(screen.getByRole("button", { name: "Alert anlegen" }));
    await waitFor(() =>
      expect(calls.find((c) => c.name === "alerts.create")?.input).toEqual({
        name: "Chunking",
        source: { kind: "arxiv-category", value: "cs.IR" },
        intervalHours: 24,
        limit: 5,
        project: "rag-evaluation",
        rank: true,
      }),
    );
    const rows = await screen.findAllByTestId("alert");
    expect(rows.map((r) => r.getAttribute("data-id"))).toEqual(["rag-papers", "chunking"]);
    expect(screen.getByLabelText("Name")).toHaveValue("");
  });

  it("asks for a name and a search value before it creates anything", async () => {
    const user = userEvent.setup();
    const { calls } = renderApp("/projects/rag-evaluation");
    await screen.findByTestId("alert");
    await user.click(screen.getByRole("button", { name: "Alert anlegen" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Gib dem Alert einen Namen.");
    await user.type(screen.getByLabelText("Name"), "x");
    await user.click(screen.getByRole("button", { name: "Alert anlegen" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Gib einen Suchwert ein.");
    expect(calls.some((c) => c.name === "alerts.create")).toBe(false);
  });

  it("pauses and deletes an alert", async () => {
    const user = userEvent.setup();
    const { calls } = renderApp("/projects/rag-evaluation");
    const alert = await screen.findByTestId("alert");
    await user.click(within(alert).getByRole("button", { name: "Pausieren" }));
    expect(await within(alert).findByText("Pausiert")).toBeVisible();
    expect(calls.find((c) => c.name === "alerts.update")?.input).toEqual({
      id: "rag-papers",
      patch: { enabled: false },
    });
    expect(within(alert).getByRole("button", { name: "Fortsetzen" })).toBeVisible();

    await user.click(within(alert).getByRole("button", { name: "Löschen" }));
    await user.click(within(alert).getByRole("button", { name: "Endgültig löschen" }));
    await waitFor(() => expect(screen.queryByTestId("alert")).toBeNull());
    expect(await screen.findByText("Noch keine Alerts.")).toBeVisible();
    expect(calls.find((c) => c.name === "alerts.delete")?.input).toEqual({ id: "rag-papers" });
  });
});

describe("alerts in the settings", () => {
  it("lists the alerts of the whole library and names the project of each", async () => {
    renderApp("/settings?section=alerts");
    const rows = await screen.findAllByTestId("alert");
    expect(rows.map((r) => r.getAttribute("data-id"))).toEqual(["rag-papers", "neue-nlp-themen"]);
    expect(rows[0]).toHaveTextContent("Projekt rag-evaluation");
    expect(rows[1]).toHaveTextContent("Bibliothek");
    expect(rows[1]).toHaveTextContent("OpenAlex-Thema: T10181");
    expect(rows[1]).toHaveTextContent("wöchentlich");
    expect(within(rows[1] as HTMLElement).getByText("Noch nicht gelaufen.")).toBeVisible();
  });

  it("creates a library-wide alert without a ranking option", async () => {
    const user = userEvent.setup();
    const { calls } = renderApp("/settings?section=alerts");
    await screen.findAllByTestId("alert");
    expect(screen.queryByLabelText("Nach dem Briefing des Projekts ordnen")).toBeNull();
    await user.type(screen.getByLabelText("Name"), "Bengio");
    await user.click(screen.getByRole("combobox", { name: "Quelle" }));
    await user.click(await screen.findByRole("option", { name: "Autor:in" }));
    await user.type(screen.getByLabelText("Suchwert"), "0000-0002-9322-3515");
    await user.click(screen.getByRole("combobox", { name: "Intervall" }));
    await user.click(await screen.findByRole("option", { name: "wöchentlich" }));
    await user.click(screen.getByRole("button", { name: "Alert anlegen" }));
    await waitFor(() =>
      expect(calls.find((c) => c.name === "alerts.create")?.input).toEqual({
        name: "Bengio",
        source: { kind: "author", value: "0000-0002-9322-3515" },
        intervalHours: 168,
        limit: 5,
        rank: false,
      }),
    );
  });

  it("shows the tab in English too", async () => {
    renderApp("/settings?section=alerts", undefined, { lang: "en" });
    expect(await screen.findByRole("heading", { name: "Alerts" })).toBeVisible();
    expect(await screen.findAllByRole("button", { name: "Run now" })).toHaveLength(2);
  });
});

describe("alert strings", () => {
  it("have an English text for every German one, and no em dash in either", () => {
    expect(Object.keys(alertsEn).sort()).toEqual(Object.keys(alertsDe).sort());
    for (const text of [...Object.values(alertsDe), ...Object.values(alertsEn)]) {
      expect(text).not.toContain(String.fromCharCode(0x2014));
    }
  });
});
