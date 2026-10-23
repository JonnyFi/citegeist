import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import { type Core, createRemoteCore } from "./lib/core";
import { QUICK_INSERT_HASH, QuickInsertRoot } from "./quick-insert";
import "./styles.css";

async function pickCore(): Promise<Core | null> {
  const bridge = window.citegeist;
  if (bridge) return bridge.connection ? createRemoteCore(bridge.connection) : null;
  // Plain browser (pnpm dev:mock, /qa): serve fixtures from memory.
  const { createMockCore } = await import("./mock/core");
  return createMockCore(undefined, { demoJobs: true });
}

const root = document.getElementById("root");
if (!root) throw new Error("index.html has no #root element");

// The palette window of the desktop app loads this page with a hash of its own.
const paletteBridge = window.citegeistQuickInsert;
if (location.hash === QUICK_INSERT_HASH && paletteBridge) {
  createRoot(root).render(
    <StrictMode>
      <QuickInsertRoot bridge={paletteBridge} />
    </StrictMode>,
  );
} else {
  void renderApp(root);
}

async function renderApp(root: HTMLElement) {
  const core = await pickCore();
  createRoot(root).render(
    <StrictMode>
      <App core={core} bridge={window.citegeist} />
    </StrictMode>,
  );
}
