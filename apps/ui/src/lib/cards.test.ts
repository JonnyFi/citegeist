import { describe, expect, it } from "vitest";
import { cardColor, readerHighlight } from "./cards";

const anchor = { text: { exact: "x", prefix: "", suffix: "", norm: "norm-v1" } };

describe("readerHighlight", () => {
  // protects=a card with a colour is a filled marker in that colour, a card without one an underline in its kind's;
  // fails_when=the colour is ignored, or an uncoloured card gets a fill; no_claim=how the reader paints the box
  it("fills the marker in the card's colour and underlines in the kind's colour otherwise", () => {
    expect(readerHighlight({ id: "c_1", color: "green", kind: "thesis", anchor })).toMatchObject({
      id: "c_1",
      color: "var(--hl-green-fill)",
      fill: true,
    });
    expect(readerHighlight({ id: "c_2", kind: "thesis", anchor })).toMatchObject({
      color: "var(--card-thesis)",
      fill: false,
    });
    expect(readerHighlight({ id: "c_3", anchor })).toMatchObject({
      color: "var(--card-none)",
      fill: false,
    });
  });
});

describe("cardColor", () => {
  // protects=the own colour of a card wins over the colour of its kind; fails_when=the kind colour hides the highlight colour;
  // no_claim=nothing about the dark theme values
  it("prefers the highlight colour to the kind colour", () => {
    expect(cardColor({ color: "red", kind: "finding" })).toBe("var(--hl-red)");
    expect(cardColor({ kind: "finding" })).toBe("var(--card-finding)");
  });
});
