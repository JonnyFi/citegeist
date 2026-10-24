import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderApp } from "../test-utils";

const rows = () => screen.findAllByTestId("inbox-row");
const KEYS = ["baecker2007formen", "gillespie2018custodians", "zuboff2019age"];

describe("inbox", () => {
  it("lists inbox items with who added them and why", async () => {
    renderApp("/inbox");
    const list = await rows();
    expect(list).toHaveLength(3);
    const zuboff = list.find((r) => r.textContent?.includes("zuboff2019age")) as HTMLElement;
    expect(within(zuboff).getByText("The Age of Surveillance Capitalism")).toBeVisible();
    expect(within(zuboff).getByText("agent:claude-code")).toBeVisible();
    expect(
      within(zuboff).getByText("Matches your search for platform critique since 2015."),
    ).toBeVisible();
  });

  it("accepts a single item", async () => {
    const user = userEvent.setup();
    const { calls, data } = renderApp("/inbox");
    await rows();
    await user.click(screen.getByRole("button", { name: "Custodians of the Internet annehmen" }));
    await waitFor(async () => expect(await rows()).toHaveLength(2));
    expect(calls.find((c) => c.name === "inbox.accept")?.input).toEqual({
      citekeys: ["gillespie2018custodians"],
    });
    expect(data.items.get("gillespie2018custodians")?.frontmatter.inbox).toBeUndefined();
  });

  it("discards a single item", async () => {
    const user = userEvent.setup();
    const { calls, data } = renderApp("/inbox");
    await rows();
    await user.click(screen.getByRole("button", { name: "Custodians of the Internet verwerfen" }));
    await waitFor(async () => expect(await rows()).toHaveLength(2));
    expect(calls.find((c) => c.name === "inbox.reject")?.input).toEqual({
      citekeys: ["gillespie2018custodians"],
    });
    expect(data.items.has("gillespie2018custodians")).toBe(false);
  });

  it("accepts the selected items in one call", async () => {
    const user = userEvent.setup();
    const { calls, data } = renderApp("/inbox");
    await rows();
    const accept = screen.getByRole("button", { name: /Ausgewählte annehmen/ });
    expect(accept).toBeDisabled();

    await user.click(
      screen.getByRole("checkbox", { name: "Custodians of the Internet auswählen" }),
    );
    await user.click(
      screen.getByRole("checkbox", { name: "The Age of Surveillance Capitalism auswählen" }),
    );
    expect(screen.getByRole("button", { name: "Ausgewählte annehmen (2)" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Ausgewählte annehmen (2)" }));

    await waitFor(async () => expect(await rows()).toHaveLength(1));
    expect(calls.filter((c) => c.name === "inbox.accept")).toHaveLength(1);
    expect(calls.find((c) => c.name === "inbox.accept")?.input).toEqual({
      citekeys: ["gillespie2018custodians", "zuboff2019age"],
    });
    expect(data.items.get("zuboff2019age")?.frontmatter.inbox).toBeUndefined();
    expect(data.items.get("baecker2007formen")?.frontmatter.inbox).toBeDefined();
    // the selection is gone with the accepted items
    expect(screen.getByRole("button", { name: "Ausgewählte annehmen (0)" })).toBeDisabled();
  });

  it("selects all and discards them in one call", async () => {
    const user = userEvent.setup();
    const { calls } = renderApp("/inbox");
    await rows();
    await user.click(screen.getByRole("checkbox", { name: "Alle auswählen" }));
    await user.click(screen.getByRole("button", { name: "Ausgewählte verwerfen (3)" }));
    expect(await screen.findByText("Die Inbox ist leer")).toBeVisible();
    expect(calls.find((c) => c.name === "inbox.reject")?.input).toEqual({ citekeys: KEYS });
  });

  it("accepts everything with one button", async () => {
    const user = userEvent.setup();
    const { calls } = renderApp("/inbox");
    await rows();
    await user.click(screen.getByRole("button", { name: "Alle annehmen" }));
    expect(await screen.findByText("Die Inbox ist leer")).toBeVisible();
    expect(calls.find((c) => c.name === "inbox.accept")?.input).toEqual({ citekeys: KEYS });
  });

  it("opens an inbox item from its title", async () => {
    const user = userEvent.setup();
    renderApp("/inbox");
    await rows();
    await user.click(screen.getByRole("link", { name: "Custodians of the Internet" }));
    expect(
      await screen.findByRole("heading", { level: 1, name: "Custodians of the Internet" }),
    ).toBeVisible();
  });
});
