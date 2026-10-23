import { createMemoryHistory } from "@tanstack/react-router";
import { render } from "@testing-library/react";
import { App } from "./app";
import { createMockCore } from "./mock/core";
import { createFixtures, type MockData } from "./mock/fixtures";

/** Renders the whole app at `path` against a fresh mock core. */
export function renderApp(path = "/", data: MockData = createFixtures()) {
  const core = createMockCore(data);
  const calls: Array<{ name: string; input: unknown }> = [];
  const original = core.call.bind(core);
  core.call = ((contract, input) => {
    calls.push({ name: contract.name, input });
    return original(contract, input);
  }) as typeof core.call;
  const history = createMemoryHistory({ initialEntries: [path] });
  const view = render(<App core={core} history={history} />);
  return { ...view, core, calls, history, data };
}
