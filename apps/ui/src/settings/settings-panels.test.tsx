import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { SettingsScreen } from "../routes/settings";
import { renderWithSettingsCore } from "../routes/settings-test-utils";
import { mockConflict } from "./mock";
import { renderWithPanelsCore } from "./test-utils";

beforeEach(() => localStorage.clear());

describe("embedding model", () => {
  it("offers EmbeddingGemma and Qwen3 and downloads the one that is picked", async () => {
    const user = userEvent.setup();
    const { state, calls } = renderWithSettingsCore(<SettingsScreen />, {
      semantic: { enabled: true, model: "embeddinggemma-300m", state: "downloading", progress: 0 },
      semanticPolls: 6,
    });
    const select = await screen.findByRole("combobox", { name: "Embedding-Modell" });
    expect(select).toHaveTextContent("EmbeddingGemma 300M");
    await user.click(select);
    expect(await screen.findByRole("option", { name: /EmbeddingGemma/ })).toBeVisible();
    await user.click(await screen.findByRole("option", { name: /Qwen3 Embedding 0.6B/ }));
    await waitFor(() => expect(state.semantic.model).toBe("qwen3-embedding-0.6b"));
    expect(calls.find((c) => c.name === "settings.update")?.input).toEqual({
      patch: { semantic: { model: "qwen3-embedding-0.6b" } },
    });
    expect(
      await screen.findByRole("progressbar", { name: "Fortschritt des Downloads" }),
    ).toBeVisible();
    expect(await screen.findByRole("combobox", { name: "Embedding-Modell" })).toHaveTextContent(
      "Qwen3 Embedding 0.6B",
    );
  });
});

describe("metadata sources", () => {
  it("saves the Unpaywall address and the NCBI tool", async () => {
    const user = userEvent.setup();
    const { state, calls } = renderWithSettingsCore(<SettingsScreen />);
    await user.type(await screen.findByLabelText("Unpaywall-Adresse"), "me@example.org");
    await user.type(screen.getByLabelText("NCBI-Tool"), "meine-bibliothek");
    await user.click(screen.getByRole("button", { name: "Quellen speichern" }));
    await waitFor(() => expect(state.unpaywallEmail).toBe("me@example.org"));
    expect(state.ncbiTool).toBe("meine-bibliothek");
    expect(calls.find((c) => c.name === "settings.update")?.input).toEqual({
      patch: { unpaywallEmail: "me@example.org", ncbiTool: "meine-bibliothek" },
    });
  });

  it("refuses an Unpaywall address that is no email address", async () => {
    const user = userEvent.setup();
    renderWithSettingsCore(<SettingsScreen />);
    await user.type(await screen.findByLabelText("Unpaywall-Adresse"), "nope");
    await user.click(screen.getByRole("button", { name: "Quellen speichern" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Unpaywall address");
  });

  it("stores the NCBI key in the Keychain and does not show it again", async () => {
    const user = userEvent.setup();
    const { state, calls } = renderWithSettingsCore(<SettingsScreen />);
    const field = await screen.findByLabelText("NCBI-API-Schlüssel");
    expect(field).toHaveAttribute("type", "password");
    await user.type(field, "ncbi-secret-key");
    await user.click(screen.getByRole("button", { name: "NCBI-Schlüssel speichern" }));
    expect(await screen.findByText("Der NCBI-Schlüssel liegt in der Keychain.")).toBeVisible();
    expect(screen.queryByDisplayValue("ncbi-secret-key")).toBeNull();
    expect(state.apiKeys.ncbi).toBe(true);
    expect(calls.find((c) => c.name === "settings.update")?.input).toMatchObject({
      apiKey: { provider: "ncbi", key: "ncbi-secret-key" },
    });
    await user.click(screen.getByRole("button", { name: "NCBI-Schlüssel entfernen" }));
    await waitFor(() => expect(state.apiKeys.ncbi).toBe(false));
    expect(await screen.findByLabelText("NCBI-API-Schlüssel")).toBeVisible();
  });

  it("stores the OpenAlex key in its own Keychain slot, apart from the NCBI key", async () => {
    // protects: the literature search key lands in slot "openalex" and stays masked
    // fails_when: the key goes to another slot, shows again in clear text or touches the NCBI slot
    // no_claim: the mock core stands in for the Keychain; the real MacKeychain is not touched
    const user = userEvent.setup();
    const { state, calls } = renderWithSettingsCore(<SettingsScreen />);
    const field = await screen.findByLabelText("OpenAlex-API-Schlüssel");
    expect(field).toHaveAttribute("type", "password");
    await user.type(field, "oa-secret-key");
    await user.click(screen.getByRole("button", { name: "OpenAlex-Schlüssel speichern" }));
    expect(await screen.findByText("Der OpenAlex-Schlüssel liegt in der Keychain.")).toBeVisible();
    expect(screen.queryByDisplayValue("oa-secret-key")).toBeNull();
    expect(state.apiKeys.openalex).toBe(true);
    expect(state.apiKeys.ncbi).toBe(false);
    expect(calls.find((c) => c.name === "settings.update")?.input).toMatchObject({
      apiKey: { provider: "openalex", key: "oa-secret-key" },
    });
  });
});

describe("sections", () => {
  it("switches between general, sync and webhooks", async () => {
    const user = userEvent.setup();
    renderWithPanelsCore(<SettingsScreen />);
    expect(await screen.findByRole("checkbox", { name: "Isolierter Agent" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Sync" }));
    expect(await screen.findByRole("heading", { name: "Sync und Verlauf" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Webhooks" }));
    expect(
      await screen.findByRole("heading", { name: "Webhooks für externe Agents" }),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Allgemein" }));
    expect(await screen.findByRole("checkbox", { name: "Isolierter Agent" })).toBeVisible();
  });
});

describe("sync", () => {
  it("shows the git state, the last sync and that there is no conflict", async () => {
    renderWithPanelsCore(<SettingsScreen section="sync" />, {
      sync: {
        transport: "git",
        versioning: true,
        remote: "git@github.com:jonny/library.git",
        uncommitted: 3,
        lastSync: { at: "2026-10-24T07:55:00.000Z", ok: true, message: "Pulled and pushed." },
      },
    });
    const git = await screen.findByTestId("sync-git");
    expect(git).toHaveTextContent("main");
    expect(git).toHaveTextContent("3 Dateien");
    expect(git).toHaveTextContent("git@github.com:jonny/library.git");
    expect(screen.getByTestId("sync-last")).toHaveTextContent("Pulled and pushed.");
    expect(screen.getByText("Es gibt keine Konflikte.")).toBeVisible();
  });

  it("picks exactly one transport and saves the git remote with its interval", async () => {
    const user = userEvent.setup();
    const { sync, calls } = renderWithPanelsCore(<SettingsScreen section="sync" />);
    const save = await screen.findByRole("button", { name: "Sync speichern" });
    expect(save).toBeDisabled();
    expect(screen.getByRole("button", { name: "Aus" })).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "git-Remote" }));
    expect(screen.getByRole("button", { name: "Aus" })).toHaveAttribute("aria-pressed", "false");
    expect(save).toBeDisabled();
    await user.type(screen.getByLabelText("Remote-URL"), "git@github.com:jonny/library.git");
    const interval = screen.getByLabelText("Abstand in Minuten");
    await user.clear(interval);
    await user.type(interval, "30");
    await user.click(save);

    await waitFor(() => expect(sync.transport).toBe("git"));
    expect(calls.find((c) => c.name === "sync.configure")?.input).toEqual({
      transport: "git",
      remote: "git@github.com:jonny/library.git",
      intervalMinutes: 30,
      versioning: false,
    });
    expect(sync.intervalMinutes).toBe(30);
    expect(await screen.findByText("Gespeichert")).toBeVisible();
  });

  it("does not offer a git remote while the library sits in iCloud", async () => {
    renderWithPanelsCore(<SettingsScreen section="sync" />, {
      sync: {
        transport: "icloud",
        location: "icloud",
        evicted: ["sources/a.pdf", "sources/b.pdf"],
      },
    });
    expect(await screen.findByRole("button", { name: "git-Remote" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "iCloud" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/außerhalb von iCloud und Dropbox/)).toBeVisible();
    expect(
      screen.getByText("2 Dateien liegen nur in iCloud und fehlen auf diesem Mac."),
    ).toBeVisible();
  });

  it("syncs now and reports the result", async () => {
    const user = userEvent.setup();
    const { sync, calls } = renderWithPanelsCore(<SettingsScreen section="sync" />, {
      sync: { transport: "git", remote: "git@example.org:l.git", uncommitted: 2 },
    });
    expect(screen.queryByText("Es hat noch kein Sync stattgefunden.")).toBeNull();
    await user.click(await screen.findByRole("button", { name: "Jetzt synchronisieren" }));
    expect(await screen.findByText("1 Commit angelegt.")).toBeVisible();
    expect(screen.getAllByText("Pulled with rebase and pushed.").length).toBeGreaterThan(0);
    expect(calls.find((c) => c.name === "sync.now")?.input).toEqual({ downloadAll: false });
    await waitFor(() => expect(sync.uncommitted).toBe(0));
    expect(await screen.findByTestId("sync-last")).toHaveTextContent("Letzter Sync am");
  });

  it("cannot sync while the transport is off", async () => {
    renderWithPanelsCore(<SettingsScreen section="sync" />);
    expect(await screen.findByRole("button", { name: "Jetzt synchronisieren" })).toBeDisabled();
    expect(screen.getByTestId("sync-last")).toHaveTextContent(
      "Es hat noch kein Sync stattgefunden.",
    );
  });

  it("shows a failed sync with its message", async () => {
    const user = userEvent.setup();
    renderWithPanelsCore(<SettingsScreen section="sync" />, {
      sync: { transport: "git", remote: "git@example.org:l.git", nowError: "Push rejected." },
    });
    await user.click(await screen.findByRole("button", { name: "Jetzt synchronisieren" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Push rejected.");
  });

  it("lists conflicts and resolves them with keep a, keep b or keep both", async () => {
    const user = userEvent.setup();
    const { sync, calls } = renderWithPanelsCore(<SettingsScreen section="sync" />, {
      sync: {
        transport: "icloud",
        location: "icloud",
        conflicts: [
          mockConflict("notes/autopoiesis.md"),
          mockConflict("notes/medium.md"),
          mockConflict("notes/gleich.md", { identical: true }),
        ],
      },
    });
    const rows = await screen.findAllByTestId("conflict");
    expect(rows).toHaveLength(3);
    const first = within(rows[0] as HTMLElement);
    expect(first.getByText("notes/autopoiesis.md")).toBeVisible();
    expect(first.getByText("A: Datei")).toBeVisible();
    expect(first.getByText("B: notes/autopoiesis 2.md")).toBeVisible();
    await user.click(first.getByText("Unterschied anzeigen"));
    expect(first.getByText(/Luhmann übernimmt den Begriff/, { exact: false })).toBeVisible();
    expect(
      within(rows[2] as HTMLElement).getByText("Beide Fassungen sind identisch."),
    ).toBeVisible();

    await user.click(first.getByRole("button", { name: "A behalten" }));
    await waitFor(() => expect(screen.getAllByTestId("conflict")).toHaveLength(2));
    expect(calls.find((c) => c.name === "sync.resolveConflict")?.input).toEqual({
      path: "notes/autopoiesis.md",
      copy: "notes/autopoiesis 2.md",
      keep: "a",
    });

    const second = within(screen.getAllByTestId("conflict")[0] as HTMLElement);
    await user.click(second.getByRole("button", { name: "B behalten" }));
    await waitFor(() => expect(screen.getAllByTestId("conflict")).toHaveLength(1));
    const last = within(screen.getByTestId("conflict"));
    await user.click(last.getByRole("button", { name: "Beide behalten" }));
    expect(await screen.findByText("Es gibt keine Konflikte.")).toBeVisible();
    expect(
      calls
        .filter((c) => c.name === "sync.resolveConflict")
        .map((c) => (c.input as { keep: string }).keep),
    ).toEqual(["a", "b", "both"]);
    expect(sync.conflicts).toEqual([]);
  });

  it("labels the two versions of a git conflict as this Mac and remote", async () => {
    renderWithPanelsCore(<SettingsScreen section="sync" />, {
      sync: {
        transport: "git",
        remote: "git@example.org:l.git",
        conflicts: [mockConflict("notes/autopoiesis.md")],
      },
    });
    const row = within(await screen.findByTestId("conflict"));
    expect(row.getByText("A: dieser Mac")).toBeVisible();
    expect(row.getByText("B: Remote")).toBeVisible();
  });
});

const HOOK = {
  name: "grok",
  kind: "both" as const,
  url: "https://grok-bot.example.com/citegeist",
  inboundUrl: "",
  actor: "agent:grok",
  hasSecret: true,
  createdAt: "2026-10-23T12:00:00.000Z",
};

describe("webhooks", () => {
  it("starts empty, says the base URL is not set and explains the Grok setup", async () => {
    renderWithPanelsCore(<SettingsScreen section="webhooks" />);
    expect(await screen.findByText("Es ist noch kein Connector angelegt.")).toBeVisible();
    expect(screen.getByText(/Nicht gesetzt\. Die Adressen zeigen auf diesen Mac/)).toBeVisible();
    expect(screen.getByRole("heading", { name: "Grok einrichten" })).toBeVisible();
    expect(screen.getByText(/docs\/webhooks\.md/)).toBeVisible();
  });

  it("creates an inbound connector and shows its secret once", async () => {
    const user = userEvent.setup();
    const { webhooks, calls } = renderWithPanelsCore(<SettingsScreen section="webhooks" />);
    await user.type(await screen.findByLabelText("Name"), "grok");
    await user.click(screen.getByRole("button", { name: "Anlegen" }));

    const notice = await screen.findByTestId("secret-notice");
    expect(within(notice).getByText("Secret für grok")).toBeVisible();
    const secret = within(notice).getByTestId("secret-value").textContent ?? "";
    expect(secret).toMatch(/^whsec_/);
    expect(secret).toBe(webhooks.secrets.grok);
    expect(calls.find((c) => c.name === "webhooks.create")?.input).toEqual({
      name: "grok",
      kind: "inbound",
    });

    const card = await screen.findByTestId("connector");
    expect(within(card).getByText("http://127.0.0.1:51234/hooks/grok")).toBeVisible();
    expect(within(card).getByText("agent:grok")).toBeVisible();
    expect(within(card).getByText("In der Keychain")).toBeVisible();

    await user.click(within(notice).getByRole("button", { name: "Fertig" }));
    expect(screen.queryByTestId("secret-notice")).toBeNull();
    expect(screen.queryByText(secret)).toBeNull();
  });

  it("asks for the address of an outbound connector and checks the name", async () => {
    const user = userEvent.setup();
    const { calls } = renderWithPanelsCore(<SettingsScreen section="webhooks" />);
    await user.type(await screen.findByLabelText("Name"), "Grok Bot");
    await user.click(screen.getByRole("button", { name: "Anlegen" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("nur Kleinbuchstaben");

    const name = screen.getByLabelText("Name");
    await user.clear(name);
    await user.type(name, "grok");
    await user.click(screen.getByRole("button", { name: "Ausgehend" }));
    await user.click(screen.getByRole("button", { name: "Anlegen" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("keine gültige Adresse");

    await user.type(screen.getByLabelText("Adresse des Agents"), "https://grok.example.com/hook");
    await user.click(screen.getByRole("button", { name: "Anlegen" }));
    expect(await screen.findByTestId("secret-notice")).toBeVisible();
    expect(calls.find((c) => c.name === "webhooks.create")?.input).toEqual({
      name: "grok",
      kind: "outbound",
      url: "https://grok.example.com/hook",
    });
  });

  it("shows the endpoint under the public base URL", async () => {
    renderWithPanelsCore(<SettingsScreen section="webhooks" />, {
      webhooks: { publicBaseUrl: "https://mac.beispiel.ts.net", hooks: [HOOK] },
    });
    const card = await screen.findByTestId("connector");
    expect(within(card).getByText("https://mac.beispiel.ts.net/hooks/grok")).toBeVisible();
    expect(within(card).getByText("https://grok-bot.example.com/citegeist")).toBeVisible();
    expect(screen.getAllByText("https://mac.beispiel.ts.net").length).toBeGreaterThan(0);
    expect(screen.queryByText(/Nicht gesetzt/)).toBeNull();
  });

  it("rotates the secret with a grace period and shows the new one once", async () => {
    const user = userEvent.setup();
    const { webhooks, calls } = renderWithPanelsCore(<SettingsScreen section="webhooks" />, {
      webhooks: { hooks: [HOOK], secrets: { grok: "whsec_old" } },
    });
    const card = within(await screen.findByTestId("connector"));
    await user.click(card.getByRole("button", { name: "Secret erneuern" }));
    const grace = card.getByLabelText("Altes Secret gilt noch (Minuten)");
    expect(grace).toHaveValue("60");
    await user.clear(grace);
    await user.type(grace, "15");
    await user.click(card.getByRole("button", { name: "Erneuern" }));

    const notice = await screen.findByTestId("secret-notice");
    const secret = within(notice).getByTestId("secret-value").textContent;
    expect(secret).not.toBe("whsec_old");
    expect(secret).toBe(webhooks.secrets.grok);
    expect(calls.find((c) => c.name === "webhooks.rotateSecret")?.input).toEqual({
      name: "grok",
      graceMinutes: 15,
    });
    expect(await screen.findByText(/Das alte Secret gilt noch bis/)).toBeVisible();
  });

  it("sends a test and reports the answer, the local check and a failure", async () => {
    const user = userEvent.setup();
    renderWithPanelsCore(<SettingsScreen section="webhooks" />, {
      webhooks: {
        hooks: [
          HOOK,
          { ...HOOK, name: "lokal", kind: "inbound", url: undefined as never },
          { ...HOOK, name: "tot", url: "https://unreachable.example.com/x" },
        ],
      },
    });
    const cards = await screen.findAllByTestId("connector");
    const byName = (name: string) =>
      within(cards.find((c) => c.getAttribute("data-name") === name) as HTMLElement);

    await user.click(byName("grok").getByRole("button", { name: "Test senden" }));
    expect(
      await byName("grok").findByText("Der Agent hat mit Status 200 geantwortet (142 ms)."),
    ).toBeVisible();

    await user.click(byName("lokal").getByRole("button", { name: "Test senden" }));
    expect(
      await byName("lokal").findByText("Die Signatur stimmt, geprüft am lokalen Empfänger."),
    ).toBeVisible();

    await user.click(byName("tot").getByRole("button", { name: "Test senden" }));
    expect(
      await byName("tot").findByText(/Der Test ist fehlgeschlagen: connect ECONNREFUSED/),
    ).toBeVisible();
  });

  it("deletes a connector only after a confirmation", async () => {
    const user = userEvent.setup();
    const { webhooks } = renderWithPanelsCore(<SettingsScreen section="webhooks" />, {
      webhooks: { hooks: [HOOK] },
    });
    const card = within(await screen.findByTestId("connector"));
    await user.click(card.getByRole("button", { name: "Löschen" }));
    expect(card.getByText("Connector grok und seine Secrets löschen?")).toBeVisible();
    await user.click(card.getByRole("button", { name: "Abbrechen" }));
    expect(webhooks.hooks).toHaveLength(1);

    await user.click(card.getByRole("button", { name: "Löschen" }));
    await user.click(card.getByRole("button", { name: "Endgültig löschen" }));
    await waitFor(() => expect(webhooks.hooks).toHaveLength(0));
    expect(await screen.findByText("Es ist noch kein Connector angelegt.")).toBeVisible();
  });
});
