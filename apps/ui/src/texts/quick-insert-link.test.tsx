import { QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClient } from "../app";
import type { CitegeistBridge, OpenTextInfo } from "../bridge";
import { CoreProvider } from "../lib/hooks";
import { createMockCore } from "../mock/core";
import { createFixtures } from "../mock/fixtures";
import { publishOpenText, registerInserter, resetActiveText } from "./active";
import { QuickInsertLink } from "./quick-insert-link";

function fakeBridge() {
  const published: Array<OpenTextInfo | null> = [];
  let listener: ((snippet: string) => void) | undefined;
  const bridge = {
    platform: "darwin",
    textLink: {
      publish: (text: OpenTextInfo | null) => void published.push(text),
      onInsert: (l: (snippet: string) => void) => {
        listener = l;
        return () => {
          listener = undefined;
        };
      },
    },
  } as unknown as CitegeistBridge;
  return { bridge, published, send: (snippet: string) => listener?.(snippet) };
}

function mount(bridge: CitegeistBridge | undefined) {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <CoreProvider core={createMockCore(createFixtures())}>
        <QuickInsertLink bridge={bridge} />
      </CoreProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => resetActiveText());

describe("QuickInsertLink", () => {
  it("publishes the open text, its language, and null when the editor closes", () => {
    const { bridge, published } = fakeBridge();
    mount(bridge);
    expect(published.at(-1)).toBeNull();
    act(() =>
      publishOpenText({
        project: "phd-proposal",
        text: "chapter-1",
        title: "Kapitel 1",
        lang: "de",
      }),
    );
    expect(published.at(-1)).toEqual({ project: "phd-proposal", text: "chapter-1", lang: "de" });
    act(() => publishOpenText(null));
    expect(published.at(-1)).toBeNull();
  });

  it("hands a snippet from the palette to the cursor of the open editor", () => {
    const { bridge, send } = fakeBridge();
    const insert = vi.fn();
    mount(bridge);
    act(() => {
      publishOpenText({ project: "p", text: "t", title: "T" });
      registerInserter(insert);
    });
    send("[@luhmann1984soziale, S. 31]");
    expect(insert).toHaveBeenCalledWith("[@luhmann1984soziale, S. 31]");
  });

  it("does nothing without a bridge", () => {
    expect(() => mount(undefined)).not.toThrow();
  });
});
