import { createMemoryHistory } from "@tanstack/react-router";
import { render } from "@testing-library/react";
import { App } from "./app";
import type { Lang } from "./i18n";
import { createMockCore, type MockOptions } from "./mock/core";
import { createFixtures, type MockData } from "./mock/fixtures";

/**
 * Fixture library whose readable item has no PDF URL, so the reader opens the reflow view. pdf.js
 * needs a real browser; the PDF view is exercised by /qa against dev:mock.
 */
export function createReflowFixtures(): MockData {
  const data = createFixtures();
  const doc = data.docs.get("luhmann1984soziale");
  if (doc) delete doc.pdfUrl;
  return data;
}

/** Renders the whole app at `path` against a fresh mock core, in German unless `lang` says otherwise ("system" leaves it to the system language). */
export function renderApp(
  path = "/",
  data: MockData = createFixtures(),
  options: MockOptions & { lang?: Lang | "system" } = {},
) {
  const { lang = "de", ...mockOptions } = options;
  const core = createMockCore(data, { aiDelayMs: 50, ...mockOptions });
  const calls: Array<{ name: string; input: unknown }> = [];
  const original = core.call.bind(core);
  core.call = ((contract, input) => {
    calls.push({ name: contract.name, input });
    return original(contract, input);
  }) as typeof core.call;
  const history = createMemoryHistory({ initialEntries: [path] });
  const view = render(
    <App core={core} history={history} {...(lang === "system" ? {} : { lang })} />,
  );
  return { ...view, core, calls, history, data };
}
