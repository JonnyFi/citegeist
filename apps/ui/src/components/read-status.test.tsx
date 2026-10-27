import { localDateOf } from "@citegeist/schema";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { formatDay } from "../lib/format";
import type { createFixtures } from "../mock/fixtures";
import { createReflowFixtures, renderApp } from "../test-utils";

afterEach(() => localStorage.clear());

const TODAY = localDateOf(new Date());
const TODAY_DE = formatDay(TODAY, "de");

const statusOf = (data: ReturnType<typeof createFixtures>, citekey: string) =>
  data.items.get(citekey)?.frontmatter.status;
const readAtOf = (data: ReturnType<typeof createFixtures>, citekey: string) =>
  data.items.get(citekey)?.frontmatter.read_at;

async function row(citekey: string): Promise<HTMLElement> {
  const rows = await screen.findAllByTestId("item-row");
  const found = rows.find((r) => r.textContent?.includes(citekey));
  if (!found) throw new Error(`no row for ${citekey}`);
  return found;
}

describe("status control in the item view", () => {
  it("opens a menu with the three statuses and marks the current one", async () => {
    const user = userEvent.setup();
    renderApp("/items/luhmann1984soziale");
    await user.click(
      await screen.findByRole("button", { name: "Lesestatus ändern, aktuell: Wird gelesen" }),
    );
    const items = await screen.findAllByRole("menuitem");
    expect(items.map((i) => i.textContent)).toEqual(["Ungelesen", "Wird gelesen", "Gelesen"]);
    expect(items[1]).toHaveAttribute("aria-current", "true");
  });

  it("sets the status with items.setStatus and shows the read date", async () => {
    const user = userEvent.setup();
    const { calls, data } = renderApp("/items/latour2005reassembling");
    expect(screen.queryByText(/^Gelesen am/)).toBeNull();
    await user.click(
      await screen.findByRole("button", { name: "Lesestatus ändern, aktuell: Ungelesen" }),
    );
    await user.click(await screen.findByRole("menuitem", { name: "Gelesen" }));

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Lesestatus ändern, aktuell: Gelesen" }),
      ).toBeVisible(),
    );
    expect(calls.find((c) => c.name === "items.setStatus")?.input).toEqual({
      citekeys: ["latour2005reassembling"],
      status: "read",
    });
    expect(statusOf(data, "latour2005reassembling")).toBe("read");
    expect(readAtOf(data, "latour2005reassembling")).toBe(TODAY);
    expect(screen.getByText(`Gelesen am ${TODAY_DE}`)).toBeVisible();
  });

  it("removes the date when the item goes back to unread", async () => {
    const user = userEvent.setup();
    const { data } = renderApp("/items/habermas1981theorie");
    expect(await screen.findByText("Gelesen am 12.10.2026")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Lesestatus ändern, aktuell: Gelesen" }));
    await user.click(await screen.findByRole("menuitem", { name: "Ungelesen" }));
    await waitFor(() => expect(screen.queryByText(/^Gelesen am/)).toBeNull());
    expect(statusOf(data, "habermas1981theorie")).toBe("unread");
    expect(readAtOf(data, "habermas1981theorie")).toBeUndefined();
  });

  it("makes no call when the current status is chosen again", async () => {
    const user = userEvent.setup();
    const { calls } = renderApp("/items/luhmann1984soziale");
    await user.click(
      await screen.findByRole("button", { name: "Lesestatus ändern, aktuell: Wird gelesen" }),
    );
    await user.click(await screen.findByRole("menuitem", { name: "Wird gelesen" }));
    expect(calls.some((c) => c.name === "items.setStatus")).toBe(false);
  });
});

describe("status square in the library table", () => {
  it("cycles unread, reading, read, unread with a label and a tooltip", async () => {
    const user = userEvent.setup();
    const { calls, data, history } = renderApp("/");
    const key = "latour2005reassembling";
    const button = () => within(row0).getByTestId("status-cycle");
    const row0 = await row(key);

    expect(button()).toHaveAccessibleName(
      /^Lesestatus von Reassembling the Social.*: Ungelesen\. Auf „Wird gelesen“ setzen\.$/,
    );
    expect(button()).toHaveAttribute("title", "Auf „Wird gelesen“ setzen");

    await user.click(button());
    await waitFor(() => expect(statusOf(data, key)).toBe("reading"));
    await waitFor(() => expect(button()).toHaveAttribute("title", "Auf „Gelesen“ setzen"));
    await user.click(button());
    await waitFor(() => expect(statusOf(data, key)).toBe("read"));
    expect(readAtOf(data, key)).toBe(TODAY);
    await waitFor(() => expect(button()).toHaveAttribute("title", "Auf „Ungelesen“ setzen"));
    await user.click(button());
    await waitFor(() => expect(statusOf(data, key)).toBe("unread"));
    expect(readAtOf(data, key)).toBeUndefined();

    const statuses = calls
      .filter((c) => c.name === "items.setStatus")
      .map((c) => (c.input as { status: string }).status);
    expect(statuses).toEqual(["reading", "read", "unread"]);
    // the click does not open the item
    expect(history.location.pathname).toBe("/");
  });

  it("shows the read date in a sortable column Gelesen am", async () => {
    const user = userEvent.setup();
    const { calls } = renderApp("/");
    const habermas = await row("habermas1981theorie");
    expect(within(habermas).getByText("12.10.2026")).toBeInTheDocument();

    await user.click(
      within(screen.getByRole("columnheader", { name: /Gelesen am/ })).getByRole("button"),
    );
    await waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.name === "items.list" &&
            (c.input as { sort?: string; order?: string }).sort === "readAt" &&
            (c.input as { order?: string }).order === "desc",
        ),
      ).toBe(true),
    );
    await waitFor(async () => {
      const keys = (await screen.findAllByTestId("item-row")).map(
        (r) => r.querySelector("span.font-mono")?.textContent,
      );
      // newest first; items that were never read come last
      expect(keys.slice(0, 5)).toEqual([
        "ahrens2017how",
        "habermas1981theorie",
        "vaswani2017attention",
        "bush1945think",
        "kuhn1962structure",
      ]);
    });
    expect(screen.getByRole("columnheader", { name: /Gelesen am/ })).toHaveAttribute(
      "aria-sort",
      "descending",
    );
  });
});

describe("bulk actions in the library", () => {
  it("marks the selected items as read and as unread with one call each", async () => {
    const user = userEvent.setup();
    const { calls, data } = renderApp("/");
    await screen.findAllByTestId("item-row");
    await user.click(screen.getByRole("checkbox", { name: "As We May Think auswählen" }));
    const bowker = "Sorting Things Out: Classification and Its Consequences";
    await user.click(screen.getByRole("checkbox", { name: `${bowker} auswählen` }));
    const bar = screen.getByRole("toolbar", { name: "Aktionen für die ausgewählten Quellen" });
    expect(within(bar).getByText("2 ausgewählt")).toBeVisible();

    await user.click(within(bar).getByRole("button", { name: "Als gelesen markieren" }));
    await waitFor(() => expect(statusOf(data, "bowker1999sorting")).toBe("read"));
    const sets = calls.filter((c) => c.name === "items.setStatus");
    expect(sets).toHaveLength(1);
    expect(sets[0]?.input).toEqual({
      citekeys: ["bowker1999sorting", "bush1945think"],
      status: "read",
    });
    // bush1945think was read already and keeps the date it had
    expect(readAtOf(data, "bush1945think")).toBe("2026-09-20");
    expect(readAtOf(data, "bowker1999sorting")).toBe(TODAY);
    expect(await screen.findByText("1 Quelle als gelesen markiert.")).toBeVisible();
    expect(
      screen.queryByRole("toolbar", { name: "Aktionen für die ausgewählten Quellen" }),
    ).toBeNull();

    await user.click(screen.getByRole("checkbox", { name: `${bowker} auswählen` }));
    await user.click(
      within(
        screen.getByRole("toolbar", { name: "Aktionen für die ausgewählten Quellen" }),
      ).getByRole("button", { name: "Als ungelesen markieren" }),
    );
    await waitFor(() => expect(statusOf(data, "bowker1999sorting")).toBe("unread"));
    expect(readAtOf(data, "bowker1999sorting")).toBeUndefined();
  });
});

const READER = "/items/luhmann1984soziale?tab=read";

function unreadReader() {
  const data = createReflowFixtures();
  const item = data.items.get("luhmann1984soziale");
  if (!item) throw new Error("fixture missing");
  item.frontmatter = { ...item.frontmatter, status: "unread" };
  return data;
}

/** The reflow scroller with a layout jsdom does not have: 2000px of text in a 500px view. */
function scrollTo(scroller: HTMLElement, top: number) {
  Object.defineProperty(scroller, "scrollHeight", { configurable: true, value: 2000 });
  Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 500 });
  scroller.scrollTop = top;
  fireEvent.scroll(scroller);
}

describe("reading status while reading", () => {
  it("marks an unread item of the library as reading when its reader opens", async () => {
    const data = unreadReader();
    const { calls } = renderApp(READER, data);
    await screen.findByTestId("reflow-scroll");
    await waitFor(() => expect(statusOf(data, "luhmann1984soziale")).toBe("reading"));
    expect(calls.filter((c) => c.name === "items.setStatus")).toHaveLength(1);
    expect(calls.find((c) => c.name === "items.setStatus")?.input).toEqual({
      citekeys: ["luhmann1984soziale"],
      status: "reading",
      from: ["unread"],
    });
    expect(readAtOf(data, "luhmann1984soziale")).toBeUndefined();
  });

  it("leaves an item that is being read or was read alone", async () => {
    for (const status of ["reading", "read"] as const) {
      const data = unreadReader();
      const item = data.items.get("luhmann1984soziale");
      if (item) item.frontmatter = { ...item.frontmatter, status };
      const { calls, unmount } = renderApp(READER, data);
      await screen.findByTestId("reflow-scroll");
      await new Promise((r) => setTimeout(r, 100));
      expect(calls.some((c) => c.name === "items.setStatus")).toBe(false);
      expect(statusOf(data, "luhmann1984soziale")).toBe(status);
      unmount();
    }
  });

  it("does not change an inbox item that is opened for a preview", async () => {
    const data = unreadReader();
    const doc = data.docs.get("luhmann1984soziale");
    if (!doc) throw new Error("fixture missing");
    data.docs.set("zuboff2019age", doc);
    expect(data.items.get("zuboff2019age")?.frontmatter.inbox).toBeDefined();
    const { calls } = renderApp("/items/zuboff2019age?tab=read", data);
    const scroller = await screen.findByTestId("reflow-scroll");
    await new Promise((r) => setTimeout(r, 100));
    scrollTo(scroller, 1500);
    await new Promise((r) => setTimeout(r, 700));
    expect(calls.some((c) => c.name === "items.setStatus")).toBe(false);
    expect(statusOf(data, "zuboff2019age")).toBe("unread");
    // not even the question at the end: the item is not accepted yet
    expect(screen.queryByText("Fertig gelesen?")).toBeNull();
  });
});

describe("the question at the end of the document", () => {
  it("appears at the end, marks the item as read on request and never by itself", async () => {
    const user = userEvent.setup();
    const data = createReflowFixtures();
    const { calls } = renderApp(READER, data);
    const scroller = await screen.findByTestId("reflow-scroll");
    expect(screen.queryByText("Fertig gelesen?")).toBeNull();

    // in the middle of the text there is nothing to ask
    scrollTo(scroller, 300);
    await new Promise((r) => setTimeout(r, 700));
    expect(screen.queryByText("Fertig gelesen?")).toBeNull();

    // the last tenth of the text
    scrollTo(scroller, 1450);
    expect(await screen.findByText("Fertig gelesen?", {}, { timeout: 3000 })).toBeVisible();
    expect(statusOf(data, "luhmann1984soziale")).toBe("reading");
    expect(calls.some((c) => c.name === "items.setStatus")).toBe(false);

    await user.click(screen.getByRole("button", { name: "Als gelesen markieren" }));
    await waitFor(() => expect(statusOf(data, "luhmann1984soziale")).toBe("read"));
    expect(readAtOf(data, "luhmann1984soziale")).toBe(TODAY);
    await waitFor(() => expect(screen.queryByText("Fertig gelesen?")).toBeNull());
    expect(screen.getByText("Als gelesen markiert.")).toBeVisible();
  });

  it("goes away with Ausblenden and stays away for that item", async () => {
    const user = userEvent.setup();
    const data = createReflowFixtures();
    const { calls, unmount } = renderApp(READER, data);
    scrollTo(await screen.findByTestId("reflow-scroll"), 1450);
    await screen.findByText("Fertig gelesen?", {}, { timeout: 3000 });
    await user.click(screen.getByRole("button", { name: "Ausblenden" }));
    expect(screen.queryByText("Fertig gelesen?")).toBeNull();
    unmount();

    renderApp(READER, data);
    scrollTo(await screen.findByTestId("reflow-scroll"), 1450);
    await new Promise((r) => setTimeout(r, 700));
    expect(screen.queryByText("Fertig gelesen?")).toBeNull();
    expect(statusOf(data, "luhmann1984soziale")).toBe("reading");
    expect(calls.some((c) => c.name === "items.setStatus")).toBe(false);
  });

  it("is not asked for an item that is read already", async () => {
    const data = createReflowFixtures();
    const item = data.items.get("luhmann1984soziale");
    if (item) item.frontmatter = { ...item.frontmatter, status: "read" };
    renderApp(READER, data);
    scrollTo(await screen.findByTestId("reflow-scroll"), 1450);
    await new Promise((r) => setTimeout(r, 700));
    expect(screen.queryByText("Fertig gelesen?")).toBeNull();
  });
});
