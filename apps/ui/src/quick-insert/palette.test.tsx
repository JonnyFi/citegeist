import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, type Mock, vi } from "vitest";
import type { Core } from "../lib/core";
import { createMockCore } from "../mock/core";
import { createFixtures } from "../mock/fixtures";
import type {
  CitationPayload,
  DeliverResult,
  EditorPayload,
  PaletteTarget,
  QuickInsertBridge,
} from "./bridge";
import { QuickInsertRoot } from "./root";
import { findCitables, sourceLabel } from "./search";

/** What the fake bridge records: a citation for the clipboard or a snippet for the editor. */
type Delivered = { html?: string | undefined; text: string; kind?: "editor" };

type FakeBridge = Omit<QuickInsertBridge, "close" | "requestAccessibility" | "deliver"> & {
  delivered: Delivered[];
  deliver: Mock<(payload: CitationPayload | EditorPayload) => Promise<DeliverResult>>;
  close: Mock<() => void>;
  requestAccessibility: Mock<() => void>;
  show(target?: PaletteTarget): void;
};

const external: PaletteTarget = { type: "external" };
const editorTarget: PaletteTarget = {
  type: "text",
  project: "phd-proposal",
  text: "chapter-1",
  lang: "de",
};

function fakeBridge(
  result: DeliverResult = { pasted: true },
  target: PaletteTarget = external,
): FakeBridge {
  const listeners = new Set<(target: PaletteTarget) => void>();
  const delivered: Delivered[] = [];
  return {
    delivered,
    connection: () => null,
    target: () => target,
    deliver: vi.fn(async (payload: CitationPayload | EditorPayload) => {
      delivered.push(payload);
      return result;
    }),
    close: vi.fn<() => void>(),
    requestAccessibility: vi.fn<() => void>(),
    onShow(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    show: (next = target) =>
      act(() => {
        for (const l of listeners) l(next);
      }),
    hotkey: () => "CommandOrControl+Shift+K",
    platform: "darwin",
  };
}

function setup(bridge: FakeBridge = fakeBridge(), core: Core = createMockCore(createFixtures())) {
  const calls: Array<{ name: string; input: unknown }> = [];
  const original = core.call.bind(core);
  core.call = ((contract, input) => {
    calls.push({ name: contract.name, input });
    return original(contract, input);
  }) as typeof core.call;
  render(<QuickInsertRoot bridge={bridge} core={core} lang="de" />);
  return { bridge, core, calls, user: userEvent.setup() };
}

const options = () => screen.findAllByRole("option");
const field = () => screen.getByRole("combobox", { name: "Zitat einfügen" });

describe("quick-insert palette", () => {
  it("opens with the newest cards: quote, source and page", async () => {
    setup();
    const list = await options();
    expect(list.length).toBeGreaterThan(3);
    const first = list[0] as HTMLElement;
    expect(within(first).getByText(/Soziale Systeme bestehen aus Kommunikationen/)).toBeVisible();
    expect(within(first).getByText(/Luhmann \(1984\), Soziale Systeme/)).toBeVisible();
    expect(within(first).getByText("S. 31")).toBeVisible();
    expect(screen.getByText("Zuletzt angelegt")).toBeVisible();
  });

  it("puts the cursor in the search field", async () => {
    setup();
    await options();
    expect(field()).toHaveFocus();
  });

  it("searches cards with search.query and loads them with cards.list", async () => {
    const { user, calls } = setup();
    await options();
    await user.type(field(), "Selbstreferenz");
    await waitFor(async () => {
      const list = await options();
      expect(list).toHaveLength(1);
      expect(list[0]).toHaveTextContent("selbstreferentielle Systeme");
    });
    const search = calls.find((c) => c.name === "search.query");
    expect(search?.input).toMatchObject({ q: "Selbstreferenz", kinds: ["item", "card"] });
    expect(
      calls.some((c) => c.name === "cards.list" && JSON.stringify(c.input).includes("citekey")),
    ).toBe(true);
    expect(screen.getByText("S. 58")).toBeVisible();
  });

  it("says so when no card matches", async () => {
    const { user } = setup();
    await options();
    await user.type(field(), "xyzzy");
    expect(await screen.findByText("Nichts gefunden")).toBeVisible();
    expect(
      screen.getByText(/Für „xyzzy“ gibt es weder eine Zitatkarte noch eine Quelle/),
    ).toBeVisible();
  });

  it("Enter delivers the direct citation as HTML and text", async () => {
    const { user, bridge, calls } = setup();
    await options();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(bridge.delivered).toHaveLength(1));
    const payload = bridge.delivered[0] as CitationPayload;
    expect(payload.html).toContain("<blockquote>„Soziale Systeme bestehen aus Kommunikationen");
    expect(payload.text).toMatch(/^„Soziale Systeme bestehen aus Kommunikationen/);
    expect(payload.text).toContain("Luhmann 1984, S. 31");
    const exportCall = calls.find((c) => c.name === "cards.export");
    expect(exportCall?.input).toMatchObject({ mode: "direct", format: "html" });
  });

  it("Shift+Enter delivers the indirect citation", async () => {
    const { user, bridge, calls } = setup();
    await options();
    await user.keyboard("{Shift>}{Enter}{/Shift}");
    await waitFor(() => expect(bridge.delivered).toHaveLength(1));
    expect(bridge.delivered[0]?.text).toContain("(vgl. Luhmann 1984, S. 31)");
    expect(calls.find((c) => c.name === "cards.export")?.input).toMatchObject({ mode: "indirect" });
  });

  it("moves the selection with the arrow keys and wraps around", async () => {
    const { user, bridge } = setup();
    const list = await options();
    expect(list[0]).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{ArrowDown}");
    expect(list[1]).toHaveAttribute("aria-selected", "true");
    expect(field()).toHaveAttribute("aria-activedescendant", list[1]?.id);
    await user.keyboard("{ArrowUp}{ArrowUp}");
    expect(list[list.length - 1]).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    await waitFor(() => expect(bridge.delivered[0]?.text).toContain("selbstreferentielle"));
  });

  it("a click picks the card, Shift+click the indirect citation", async () => {
    const { user, bridge } = setup();
    const list = await options();
    await user.click(list[2] as HTMLElement);
    await waitFor(() => expect(bridge.delivered).toHaveLength(1));
    expect(bridge.delivered[0]?.text).toContain("Doppelte Kontingenz");
    await user.keyboard("{Shift>}");
    await user.click(list[2] as HTMLElement);
    await user.keyboard("{/Shift}");
    await waitFor(() => expect(bridge.delivered).toHaveLength(2));
    expect(bridge.delivered[1]?.text).toContain("vgl.");
  });

  it("Escape closes the palette", async () => {
    const { user, bridge } = setup();
    await options();
    await user.keyboard("{Escape}");
    expect(bridge.close).toHaveBeenCalledTimes(1);
  });

  it("stays quiet after a paste", async () => {
    const { user, bridge } = setup(fakeBridge({ pasted: true }));
    await options();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(bridge.delivered).toHaveLength(1));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("tells the user when the Accessibility permission is missing, then closes", async () => {
    const bridge = fakeBridge({ pasted: false, reason: "no-permission" });
    const core = createMockCore(createFixtures());
    render(<QuickInsertRoot bridge={bridge} core={core} lang="de" />);
    await options();
    const user = userEvent.setup();
    await user.keyboard("{Enter}");
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("Kopiert, aber nicht eingefügt");
    expect(status).toHaveTextContent("Bedienungshilfen");
    await user.click(within(status).getByRole("button", { name: "Bedienungshilfen öffnen" }));
    expect(bridge.requestAccessibility).toHaveBeenCalled();
  });

  it("closes by itself after the message", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const bridge = fakeBridge({ pasted: false, reason: "unsupported" });
      render(<QuickInsertRoot bridge={bridge} core={createMockCore(createFixtures())} lang="en" />);
      await options();
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      await user.keyboard("{Enter}");
      expect(await screen.findByRole("status")).toHaveTextContent(
        "Automatic pasting only exists on the Mac",
      );
      expect(bridge.close).not.toHaveBeenCalled();
      await act(() => vi.advanceTimersByTimeAsync(2600));
      expect(bridge.close).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows an error and keeps the palette open when the citation fails", async () => {
    const core = createMockCore(createFixtures());
    const original = core.call.bind(core);
    core.call = ((contract, input) =>
      contract.name === "cards.export"
        ? Promise.reject(new Error("export failed"))
        : original(contract, input)) as typeof core.call;
    const { user, bridge } = setup(fakeBridge(), core);
    await options();
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("status")).toHaveTextContent("export failed");
    expect(bridge.delivered).toHaveLength(0);
    expect(bridge.close).not.toHaveBeenCalled();
  });

  it("starts fresh each time it is shown", async () => {
    const { user, bridge } = setup();
    await options();
    await user.type(field(), "xyzzy");
    await screen.findByText("Nichts gefunden");
    bridge.show();
    await waitFor(() => expect(field()).toHaveValue(""));
    expect((await options()).length).toBeGreaterThan(3);
    expect(field()).toHaveFocus();
  });

  it("works in English", async () => {
    const bridge = fakeBridge();
    render(<QuickInsertRoot bridge={bridge} core={createMockCore(createFixtures())} lang="en" />);
    await options();
    expect(screen.getByRole("combobox", { name: "Insert citation" })).toBeVisible();
    expect(screen.getByText("Recently added")).toBeVisible();
    expect(screen.getByText(/Shift\+Enter: paraphrase/)).toBeVisible();
    expect(screen.getByText(/Alt\+Enter: citation only/)).toBeVisible();
  });

  it("asks for a library when none is open, and still closes on Escape", async () => {
    const bridge = fakeBridge();
    render(<QuickInsertRoot bridge={bridge} lang="de" />);
    const note = screen.getByText("Öffne zuerst eine Bibliothek in citegeist.");
    note.focus();
    await userEvent.setup().keyboard("{Escape}");
    expect(bridge.close).toHaveBeenCalled();
  });
});

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const callsOf = (calls: Array<{ name: string; input: unknown }>, name: string) =>
  calls.filter((c) => c.name === name);

describe("sources in the palette", () => {
  async function findSource(user: ReturnType<typeof userEvent.setup>) {
    await options();
    await user.type(field(), "Surveillance Capitalism");
    return await screen.findByRole("option", { name: /Age of Surveillance Capitalism/ });
  }

  it("shows a source with title, authors, year and a label", async () => {
    const { user } = setup();
    const row = await findSource(user);
    expect(within(row).getByText("The Age of Surveillance Capitalism")).toBeVisible();
    expect(within(row).getByText("Zuboff (2019)")).toBeVisible();
    expect(within(row).getByText("Quelle")).toBeVisible();
  });

  it("lists cards before sources when the field is empty", async () => {
    setup();
    const list = await options();
    const tagged = list.map((row) => within(row).queryByText("Quelle") !== null);
    expect(tagged[0]).toBe(false);
    expect(tagged).toContain(true);
    expect(tagged.lastIndexOf(false)).toBeLessThan(tagged.indexOf(true));
  });

  it("inserts the citation only, whatever the keys, and says so in the hint line", async () => {
    const { user, bridge, calls } = setup();
    await findSource(user);
    expect(screen.getByText(/^Quelle: Enter fügt nur den Beleg ein/)).toBeVisible();
    expect(screen.queryByText(/Umschalt\+Enter/)).toBeNull();
    await user.keyboard("{Shift>}{Enter}{/Shift}");
    await waitFor(() => expect(bridge.delivered).toHaveLength(1));
    expect(bridge.delivered[0]?.text).toContain("Zuboff");
    expect(bridge.delivered[0]?.text).not.toContain("Surveillance");
    expect(callsOf(calls, "cards.export")).toHaveLength(0);
    expect(callsOf(calls, "cite.format")[0]?.input).toMatchObject({
      items: [{ citekey: "zuboff2019age" }],
      mode: "citation",
      format: "html",
    });
  });
});

describe("keys", () => {
  it("shows the hint line for cards in German and English", async () => {
    setup();
    await options();
    expect(
      screen.getByText(
        "Enter: wörtlich · Umschalt+Enter: sinngemäß · Alt+Enter: nur Beleg · Esc: schließen",
      ),
    ).toBeVisible();
  });

  it("Alt+Enter delivers the citation only", async () => {
    const { user, bridge, calls } = setup();
    await options();
    await user.keyboard("{Alt>}{Enter}{/Alt}");
    await waitFor(() => expect(bridge.delivered).toHaveLength(1));
    expect(callsOf(calls, "cards.export")[0]?.input).toMatchObject({ mode: "cite" });
    expect(bridge.delivered[0]?.text).toContain("Luhmann");
    expect(bridge.delivered[0]?.text).not.toContain("Soziale Systeme bestehen");
  });

  it("Alt+click and Shift+click pick citation only and paraphrase", async () => {
    const { user, bridge, calls } = setup();
    const list = await options();
    await user.keyboard("{Alt>}");
    await user.click(list[0] as HTMLElement);
    await user.keyboard("{/Alt}");
    await waitFor(() => expect(bridge.delivered).toHaveLength(1));
    await user.keyboard("{Shift>}");
    await user.click(list[0] as HTMLElement);
    await user.keyboard("{/Shift}");
    await waitFor(() => expect(bridge.delivered).toHaveLength(2));
    expect(callsOf(calls, "cards.export").map((c) => (c.input as { mode: string }).mode)).toEqual([
      "cite",
      "indirect",
    ]);
  });
});

describe("Shift+Enter and Alt+Enter paste", () => {
  // Regression: the main process types Cmd+V right after deliver. With Shift (or Alt) still held
  // the other app received Cmd+Shift+V (Cmd+Alt+V), not a paste. The palette now waits for the keyup.
  it("hands the indirect citation over only after Shift is released", async () => {
    const { user, bridge, calls } = setup();
    await options();
    await user.keyboard("{Shift>}{Enter}");
    await waitFor(() =>
      expect(callsOf(calls, "cards.export")[0]?.input).toMatchObject({
        mode: "indirect",
        format: "html",
      }),
    );
    await wait(80);
    expect(bridge.deliver).not.toHaveBeenCalled();
    await user.keyboard("{/Shift}");
    await waitFor(() => expect(bridge.deliver).toHaveBeenCalledTimes(1));
    expect(bridge.delivered[0]?.text).toContain("(vgl. Luhmann 1984, S. 31)");
    expect(bridge.delivered[0]?.kind).toBeUndefined();
  });

  it("hands the citation over only after Alt is released", async () => {
    const { user, bridge, calls } = setup();
    await options();
    await user.keyboard("{Alt>}{Enter}");
    await waitFor(() => expect(callsOf(calls, "cards.export")).toHaveLength(1));
    expect(callsOf(calls, "cards.export")[0]?.input).toMatchObject({ mode: "cite" });
    await wait(80);
    expect(bridge.deliver).not.toHaveBeenCalled();
    await user.keyboard("{/Alt}");
    await waitFor(() => expect(bridge.deliver).toHaveBeenCalledTimes(1));
  });

  it("does not wait for a plain Enter", async () => {
    const { user, bridge } = setup();
    await options();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(bridge.deliver).toHaveBeenCalledTimes(1));
  });

  it("gives up waiting after a moment when the keyup never comes", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const bridge = fakeBridge();
      render(<QuickInsertRoot bridge={bridge} core={createMockCore(createFixtures())} lang="de" />);
      await options();
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      await user.keyboard("{Shift>}{Enter}");
      await act(() => vi.advanceTimersByTimeAsync(1000));
      expect(bridge.deliver).not.toHaveBeenCalled();
      await act(() => vi.advanceTimersByTimeAsync(700));
      expect(bridge.deliver).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("inserting into the open text", () => {
  it("sends Pandoc syntax to the editor and never the clipboard payload", async () => {
    const { user, bridge, calls } = setup(fakeBridge({ pasted: true }, editorTarget));
    await options();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(bridge.delivered).toHaveLength(1));
    expect(callsOf(calls, "cards.export")[0]?.input).toMatchObject({
      mode: "direct",
      format: "pandoc",
      locale: "de",
    });
    expect(bridge.delivered[0]?.kind).toBe("editor");
    expect(bridge.delivered[0]?.html).toBeUndefined();
    expect(bridge.delivered[0]?.text).toContain("[@luhmann1984soziale, S. 31]");
  });

  it("inserts the paraphrase with vgl. in the language of the text, without waiting for Shift", async () => {
    const target: PaletteTarget = { ...editorTarget, lang: "de" };
    const { user, bridge, calls } = setup(fakeBridge({ pasted: true }, target));
    await options();
    await user.keyboard("{Shift>}{Enter}");
    // No keyup yet: the editor path types nothing, so it does not wait.
    await waitFor(() => expect(bridge.delivered).toHaveLength(1));
    expect(callsOf(calls, "cards.export")[0]?.input).toMatchObject({
      mode: "indirect",
      format: "pandoc",
      locale: "de",
    });
    expect(bridge.delivered[0]?.kind).toBe("editor");
    expect(bridge.delivered[0]?.text).toContain("vgl.");
    expect(bridge.delivered[0]?.text).toContain("@luhmann1984soziale");
    await user.keyboard("{/Shift}");
  });

  it("passes the language of an English text on", async () => {
    const { user, bridge, calls } = setup(
      fakeBridge({ pasted: true }, { ...editorTarget, lang: "en" }),
    );
    await options();
    await user.keyboard("{Alt>}{Enter}{/Alt}");
    await waitFor(() => expect(bridge.delivered).toHaveLength(1));
    expect(callsOf(calls, "cards.export")[0]?.input).toMatchObject({
      mode: "cite",
      format: "pandoc",
      locale: "en",
    });
  });

  it("cites a source in Pandoc syntax", async () => {
    const { user, bridge, calls } = setup(fakeBridge({ pasted: true }, editorTarget));
    await options();
    await user.type(field(), "Surveillance Capitalism");
    await screen.findByRole("option", { name: /Age of Surveillance Capitalism/ });
    await user.keyboard("{Enter}");
    await waitFor(() => expect(bridge.delivered).toHaveLength(1));
    expect(callsOf(calls, "cite.format")[0]?.input).toMatchObject({
      items: [{ citekey: "zuboff2019age" }],
      format: "pandoc",
      locale: "de",
    });
    expect(bridge.delivered[0]).toMatchObject({ kind: "editor", text: "[@zuboff2019age]" });
  });

  it("learns a new target each time it is shown", async () => {
    const { user, bridge, calls } = setup(fakeBridge({ pasted: true }, external));
    await options();
    bridge.show(editorTarget);
    await user.keyboard("{Enter}");
    await waitFor(() => expect(bridge.delivered).toHaveLength(1));
    expect(bridge.delivered[0]?.kind).toBe("editor");
    bridge.show(external);
    await options();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(bridge.delivered).toHaveLength(2));
    expect(bridge.delivered[1]?.kind).toBeUndefined();
    expect(
      callsOf(calls, "cards.export").map((c) => (c.input as { format: string }).format),
    ).toEqual(["pandoc", "html"]);
  });

  it("says so when the text is gone, then closes", async () => {
    const bridge = fakeBridge({ pasted: false, reason: "editor-unavailable" }, editorTarget);
    const { user } = setup(bridge);
    await options();
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Das Zitat konnte nicht in den Text eingefügt werden",
    );
  });

  it("says so when the editor path throws", async () => {
    const bridge = fakeBridge({ pasted: true }, editorTarget);
    bridge.deliver.mockRejectedValueOnce(new Error("channel closed"));
    const { user } = setup(bridge);
    await options();
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("status")).toHaveTextContent("nicht in den Text eingefügt");
  });
});

describe("findCitables", () => {
  it("keeps the order of the search hits and names the source of a card", async () => {
    const core = createMockCore(createFixtures());
    const found = await findCitables(core, "Transformer");
    const cards = found.flatMap((r) => (r.type === "card" ? [r] : []));
    expect(cards.length).toBeGreaterThan(1);
    expect(cards.every((r) => r.card.body.quote.length > 0)).toBe(true);
    expect(cards.some((r) => r.source.startsWith("Vaswani"))).toBe(true);
  });

  it("finds a source by its title", async () => {
    const core = createMockCore(createFixtures());
    const found = await findCitables(core, "Surveillance Capitalism");
    const source = found.find((r) => r.type === "source");
    expect(source?.type === "source" && source.item.citekey).toBe("zuboff2019age");
    expect(source?.type === "source" && source.label).toMatch(/^Zuboff \(2019\), The Age of/);
  });

  it("without a query lists cards first, then sources, at most twelve", async () => {
    const core = createMockCore(createFixtures());
    const found = await findCitables(core, "  ");
    expect(found.length).toBeLessThanOrEqual(12);
    const types = found.map((r) => r.type);
    expect(types[0]).toBe("card");
    expect(types).toContain("source");
    expect(types.lastIndexOf("card")).toBeLessThan(types.indexOf("source"));
  });

  it("asks for items and cards in one search.query", async () => {
    const core = createMockCore(createFixtures());
    const seen: Array<{ name: string; input: unknown }> = [];
    const original = core.call.bind(core);
    core.call = ((contract, input) => {
      seen.push({ name: contract.name, input });
      return original(contract, input);
    }) as typeof core.call;
    await findCitables(core, "systeme");
    const searches = seen.filter((c) => c.name === "search.query");
    expect(searches).toHaveLength(1);
    expect(searches[0]?.input).toMatchObject({ q: "systeme", kinds: ["item", "card"] });
  });
});

describe("sourceLabel", () => {
  const base = { title: "T" } as never;
  it("names one, two and many authors and the year", () => {
    const one = { ...(base as object), author: [{ family: "A" }], issued: 1984 } as never;
    const two = {
      ...(base as object),
      author: [{ family: "A" }, { family: "B" }],
      issued: "2020-05",
    } as never;
    const many = {
      ...(base as object),
      author: [{ family: "A" }, { family: "B" }, { family: "C" }],
    } as never;
    expect(sourceLabel(one)).toBe("A (1984), T");
    expect(sourceLabel(two)).toBe("A & B (2020), T");
    expect(sourceLabel(many)).toBe("A et al., T");
    expect(sourceLabel(base)).toBe("T");
  });
});
