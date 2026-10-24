import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, type Mock, vi } from "vitest";
import type { Core } from "../lib/core";
import { createMockCore } from "../mock/core";
import { createFixtures } from "../mock/fixtures";
import type { CitationPayload, DeliverResult, QuickInsertBridge } from "./bridge";
import { QuickInsertRoot } from "./root";
import { findCards, sourceLabel } from "./search";

type FakeBridge = Omit<QuickInsertBridge, "close" | "requestAccessibility"> & {
  delivered: CitationPayload[];
  close: Mock<() => void>;
  requestAccessibility: Mock<() => void>;
  show(): void;
};

function fakeBridge(result: DeliverResult = { pasted: true }): FakeBridge {
  const listeners = new Set<() => void>();
  const delivered: CitationPayload[] = [];
  return {
    delivered,
    connection: () => null,
    deliver: vi.fn(async (payload: CitationPayload) => {
      delivered.push(payload);
      return result;
    }),
    close: vi.fn<() => void>(),
    requestAccessibility: vi.fn<() => void>(),
    onShow(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    show: () =>
      act(() => {
        for (const l of listeners) l();
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
    expect(search?.input).toMatchObject({ q: "Selbstreferenz", kinds: ["card"] });
    expect(
      calls.some((c) => c.name === "cards.list" && JSON.stringify(c.input).includes("citekey")),
    ).toBe(true);
    expect(screen.getByText("S. 58")).toBeVisible();
  });

  it("says so when no card matches", async () => {
    const { user } = setup();
    await options();
    await user.type(field(), "xyzzy");
    expect(await screen.findByText("Keine Karte gefunden")).toBeVisible();
    expect(screen.getByText(/Für „xyzzy“ gibt es keine Zitatkarte/)).toBeVisible();
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
    await screen.findByText("Keine Karte gefunden");
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
    expect(screen.getByText(/Shift\+Enter: indirect citation/)).toBeVisible();
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

describe("findCards", () => {
  it("keeps the order of the search hits and names the source", async () => {
    const core = createMockCore(createFixtures());
    const found = await findCards(core, "Transformer");
    expect(found.length).toBeGreaterThan(1);
    expect(found.every((r) => r.card.body.quote.length > 0)).toBe(true);
    expect(found.some((r) => r.source.startsWith("Vaswani"))).toBe(true);
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
