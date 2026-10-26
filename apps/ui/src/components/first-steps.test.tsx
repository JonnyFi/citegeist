import { readFileSync } from "node:fs";
import { join } from "node:path";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { createFixtures } from "../mock/fixtures";
import { renderApp } from "../test-utils";
import { SAMPLE_IDENTIFIER } from "./first-steps";

describe("sample paper", () => {
  it("is a CC-BY fixture of the manifest, addressed by its arXiv id", () => {
    const manifest = JSON.parse(
      readFileSync(join(import.meta.dirname, "../../../../fixtures/pdf/manifest.json"), "utf8"),
    ) as { fixtures: Array<{ arxivId?: string; license: string }> };
    const fixture = manifest.fixtures.find((f) => SAMPLE_IDENTIFIER === `arXiv:${f.arxivId}`);
    expect(fixture?.license).toBe("CC-BY-4.0");
  });
});

describe("empty library", () => {
  it("shows the three first actions in English", async () => {
    const data = createFixtures();
    data.items.clear();
    renderApp("/", data, { lang: "en" });
    const steps = await screen.findByTestId("first-steps");
    expect(steps).toHaveTextContent("Your library is empty");
    expect(steps).toHaveTextContent("Add a paper");
    expect(steps).toHaveTextContent("Highlight a passage");
    expect(steps).toHaveTextContent("Open the chat");
  });

  it("adds the sample paper on request, and the library lists it", async () => {
    const user = userEvent.setup();
    const data = createFixtures();
    data.items.clear();
    const { calls } = renderApp("/", data, { lang: "en" });
    await user.click(await screen.findByRole("button", { name: "Add a sample paper" }));
    await waitFor(() => expect(screen.queryByTestId("first-steps")).toBeNull());
    expect(await screen.findByRole("table")).toBeVisible();
    expect(calls.find((c) => c.name === "items.add")?.input).toMatchObject({
      identifier: SAMPLE_IDENTIFIER,
      target: "library",
    });
  });
});
