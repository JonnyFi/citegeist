import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import { type Core, createRemoteCore } from "./lib/core";
import "./styles.css";

async function pickCore(): Promise<Core | null> {
  const bridge = window.citegeist;
  if (bridge) return bridge.connection ? createRemoteCore(bridge.connection) : null;
  // Plain browser (pnpm dev:mock, /qa): serve fixtures from memory.
  const { createMockCore } = await import("./mock/core");
  return createMockCore();
}

const root = document.getElementById("root");
if (!root) throw new Error("index.html has no #root element");

void pickCore().then((core) => {
  createRoot(root).render(
    <StrictMode>
      <App core={core} bridge={window.citegeist} />
    </StrictMode>,
  );
});
