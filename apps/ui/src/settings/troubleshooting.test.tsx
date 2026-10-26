import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AboutInfo, CitegeistBridge } from "../bridge";
import { I18nProvider } from "../i18n";
import { TroubleshootingPanel } from "./troubleshooting";

const info: AboutInfo = {
  version: "0.1.0",
  commit: "abc1234",
  license: "Apache-2.0",
  repositoryUrl: "https://github.com/JonnyFi/citegeist",
  libraryPath: "/Users/a/Papers",
  dataDir: "/Users/a/Library/Application Support/citegeist",
  logFile: "/Users/a/Library/Logs/citegeist/core.log",
  noticePath: "/Applications/citegeist.app/Contents/Resources/NOTICE",
};

afterEach(() => {
  delete window.citegeist;
});

describe("troubleshooting", () => {
  it("shows version, paths and opens the log and the NOTICE", async () => {
    const user = userEvent.setup();
    const about = {
      get: vi.fn(async () => info),
      openLog: vi.fn(async () => {}),
      openNotice: vi.fn(async () => {}),
      revealLogFolder: vi.fn(async () => {}),
    };
    window.citegeist = {
      connection: null,
      openLibrary: async () => true,
      createLibrary: async () => true,
      onNavigate: () => () => {},
      platform: "darwin",
      about,
    } satisfies CitegeistBridge;
    render(
      <I18nProvider lang="en">
        <TroubleshootingPanel />
      </I18nProvider>,
    );
    expect(await screen.findByText("0.1.0")).toBeVisible();
    expect(screen.getByText("Apache-2.0")).toBeVisible();
    expect(screen.getByText(info.logFile)).toBeVisible();
    expect(screen.getByText(info.libraryPath as string)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Open log" }));
    await user.click(screen.getByRole("button", { name: "Open NOTICE" }));
    await waitFor(() => expect(about.openLog).toHaveBeenCalledOnce());
    expect(about.openNotice).toHaveBeenCalledOnce();
  });

  it("renders nothing without the desktop app", () => {
    const { container } = render(
      <I18nProvider lang="en">
        <TroubleshootingPanel />
      </I18nProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
