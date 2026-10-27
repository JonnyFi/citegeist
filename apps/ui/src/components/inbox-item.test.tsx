import { ItemFrontmatter } from "@citegeist/schema";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { createFixtures, type MockData } from "../mock/fixtures";
import { renderApp } from "../test-utils";

const INBOX = "zuboff2019age";
const LIBRARY = "luhmann1984soziale";
const DOI = "10.1234/shared";

describe("an inbox item in the item view", () => {
  it("reads Inbox in the breadcrumb, links back to the inbox and offers no library actions", async () => {
    renderApp(`/items/${INBOX}`);
    const crumb = await screen.findByRole("navigation", { name: "Pfad" });
    const link = within(crumb).getByRole("link", { name: "Inbox" });
    expect(link).toHaveAttribute("href", "/inbox");
    expect(within(crumb).queryByRole("link", { name: "Bibliothek" })).toBeNull();
    expect(within(crumb).getByText(/Age of Surveillance Capitalism/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Löschen" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Lesen beginnen" })).toBeNull();
  });

  it("shows who suggested it and why, with Annehmen and Verwerfen, and no Inbox chip", async () => {
    renderApp(`/items/${INBOX}`);
    const banner = await screen.findByRole("region", { name: "Inbox-Eintrag" });
    expect(banner).toHaveTextContent("In der Inbox");
    expect(banner).toHaveTextContent("vorgeschlagen von");
    expect(within(banner).getByText("agent:claude-code")).toBeVisible();
    expect(within(banner).getByText(/Matches your search for platform critique/)).toBeVisible();
    expect(within(banner).getByRole("button", { name: "Annehmen" })).toBeVisible();
    expect(within(banner).getByRole("button", { name: "Verwerfen" })).toBeVisible();
    // the status row carries no chip of its own for the inbox
    expect(screen.queryByText("Inbox", { selector: "span" })).toBeNull();
  });

  it("switches to the library form in place after Annehmen", async () => {
    const user = userEvent.setup();
    const { calls, data } = renderApp(`/items/${INBOX}`);
    const banner = await screen.findByRole("region", { name: "Inbox-Eintrag" });
    await user.click(within(banner).getByRole("button", { name: "Annehmen" }));
    expect(calls.find((c) => c.name === "inbox.accept")?.input).toEqual({ citekeys: [INBOX] });
    await waitFor(() => expect(screen.queryByRole("region", { name: "Inbox-Eintrag" })).toBeNull());
    expect(data.items.get(INBOX)?.frontmatter.inbox).toBeUndefined();
    const crumb = screen.getByRole("navigation", { name: "Pfad" });
    expect(within(crumb).getByRole("link", { name: "Bibliothek" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Löschen" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Lesen beginnen" })).toBeVisible();
  });

  it("discards the item with Verwerfen and returns to the inbox", async () => {
    const user = userEvent.setup();
    const { calls, history, data } = renderApp(`/items/${INBOX}`);
    const banner = await screen.findByRole("region", { name: "Inbox-Eintrag" });
    await user.click(within(banner).getByRole("button", { name: "Verwerfen" }));
    expect(calls.find((c) => c.name === "inbox.reject")?.input).toEqual({ citekeys: [INBOX] });
    await waitFor(() => expect(history.location.pathname).toBe("/inbox"));
    expect(data.items.has(INBOX)).toBe(false);
  });
});

/** The inbox item and a library item hold the same DOI after the library item got it elsewhere. */
function withTwins(holder: "inbox" | "library"): MockData {
  const data = createFixtures();
  const set = (key: string) => {
    const item = data.items.get(key);
    if (!item) throw new Error("fixture missing");
    item.frontmatter = ItemFrontmatter.parse({ ...item.frontmatter, DOI });
  };
  set(holder === "inbox" ? INBOX : LIBRARY);
  return data;
}

async function addIdentifier(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Kennung hinzufügen" }));
  const form = await screen.findByRole("form", { name: "Kennung hinzufügen" });
  await user.type(within(form).getByLabelText("DOI, ISBN, arXiv-ID, PMID oder Adresse"), DOI);
  await user.click(within(form).getByRole("button", { name: "Abrufen" }));
  return form;
}

describe("a DOI that the other side of the inbox boundary holds", () => {
  it("offers to merge with the inbox item, and one click does it", async () => {
    const user = userEvent.setup();
    const { calls, data } = renderApp(`/items/${LIBRARY}`, withTwins("inbox"));
    await addIdentifier(user);
    const merge = await screen.findByRole("button", {
      name: `Zusammenführen mit dem Inbox-Eintrag ${INBOX}`,
    });
    // nothing was stored by the refused call
    expect(data.items.get(LIBRARY)?.frontmatter.DOI).toBeUndefined();
    await user.click(merge);
    expect(calls.find((c) => c.name === "items.merge")?.input).toEqual({
      from: INBOX,
      into: LIBRARY,
    });
    await waitFor(() => expect(data.items.has(INBOX)).toBe(false));
    expect(await screen.findByText(new RegExp(`Zusammengeführt mit ${INBOX}`))).toBeVisible();
    expect(data.items.get(LIBRARY)?.frontmatter.DOI).toBe(DOI);
  });

  it("offers to merge an inbox item into the library item that holds the DOI", async () => {
    const user = userEvent.setup();
    const { calls, data, history } = renderApp(`/items/${INBOX}`, withTwins("library"));
    await addIdentifier(user);
    const merge = await screen.findByRole("button", {
      name: `Zusammenführen mit ${LIBRARY} aus der Bibliothek`,
    });
    await user.click(merge);
    expect(calls.find((c) => c.name === "items.merge")?.input).toEqual({
      from: INBOX,
      into: LIBRARY,
    });
    await waitFor(() => expect(history.location.pathname).toBe(`/items/${LIBRARY}`));
    expect(data.items.has(INBOX)).toBe(false);
  });

  it("offers the merge from the metadata editor as well", async () => {
    const user = userEvent.setup();
    renderApp(`/items/${LIBRARY}`, withTwins("inbox"));
    await user.click(await screen.findByRole("button", { name: "Metadaten bearbeiten" }));
    const form = await screen.findByRole("form", { name: "Metadaten bearbeiten" });
    await user.type(within(form).getByLabelText("DOI"), DOI);
    await user.click(within(form).getByRole("button", { name: "Speichern" }));
    expect(
      await screen.findByRole("button", {
        name: `Zusammenführen mit dem Inbox-Eintrag ${INBOX}`,
      }),
    ).toBeVisible();
  });
});

describe("the library list and the inbox", () => {
  it("leaves inbox items out and shows them, marked, with Inklusive Inbox", async () => {
    const user = userEvent.setup();
    const { calls } = renderApp("/");
    await screen.findAllByTestId("item-row");
    expect(screen.queryByText(INBOX)).toBeNull();
    const first = calls.find((c) => c.name === "items.list")?.input as Record<string, unknown>;
    expect(first.inbox).toBe(false);

    await user.click(screen.getByRole("checkbox", { name: "Inklusive Inbox" }));
    const row = (await screen.findAllByTestId("item-row")).find((r) =>
      r.textContent?.includes("Age of Surveillance Capitalism"),
    ) as HTMLElement;
    expect(within(row).getByText("Inbox")).toBeVisible();
    const withInbox = calls.filter((c) => c.name === "items.list").at(-1)?.input as Record<
      string,
      unknown
    >;
    expect(withInbox).toMatchObject({ includeInbox: true });
    // the sort of the library list travels with the filter
    expect(withInbox.sort).toBeDefined();
  });
});

describe("adding something that waits in the inbox", () => {
  it("says it waits there and accepts only on request", async () => {
    const user = userEvent.setup();
    const data = createFixtures();
    const item = data.items.get(INBOX);
    if (!item) throw new Error("fixture missing");
    item.frontmatter = ItemFrontmatter.parse({ ...item.frontmatter, DOI });
    const { data: shown, calls } = renderApp("/", data);
    const field = await screen.findByRole("textbox", { name: "Hinzufügen" });
    await user.type(field, `${DOI}{Enter}`);
    const note = await screen.findByText(/Liegt in der Inbox:/);
    expect(note).toBeVisible();
    expect(shown.items.get(INBOX)?.frontmatter.inbox).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Annehmen" }));
    expect(calls.find((c) => c.name === "inbox.accept")?.input).toEqual({ citekeys: [INBOX] });
    expect(await screen.findByText(/Angenommen:/)).toBeVisible();
    expect(shown.items.get(INBOX)?.frontmatter.inbox).toBeUndefined();
  });
});
