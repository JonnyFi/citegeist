import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { UpdateBridge, UpdateInfo } from "../bridge";
import { I18nProvider } from "../i18n";
import { UpdateNotice } from "./update-notice";

function bridge(initial: UpdateInfo | null) {
  let listener: ((info: UpdateInfo | null) => void) | undefined;
  const install = vi.fn(async () => {});
  const api: UpdateBridge = {
    get: async () => initial,
    install,
    onChange: (l) => {
      listener = l;
      return () => {
        listener = undefined;
      };
    },
  };
  return { api, install, push: (info: UpdateInfo | null) => listener?.(info) };
}

const renderNotice = (api: UpdateBridge | undefined) =>
  render(
    <I18nProvider lang="de">
      <UpdateNotice bridge={api} />
    </I18nProvider>,
  );

describe("UpdateNotice", () => {
  it("shows nothing without a newer release", async () => {
    const { api } = bridge(null);
    renderNotice(api);
    await Promise.resolve();
    expect(screen.queryByTestId("update-notice")).toBeNull();
  });

  it("shows nothing where the host has no update bridge", () => {
    renderNotice(undefined);
    expect(screen.queryByTestId("update-notice")).toBeNull();
  });

  it("announces the release and starts the install on click", async () => {
    const { api, install } = bridge({ version: "0.2.0", url: "https://example.org" });
    renderNotice(api);
    const button = await screen.findByRole("button", { name: /Update verfügbar/ });
    expect(button).toHaveTextContent("0.2.0");
    await userEvent.setup().click(button);
    expect(install).toHaveBeenCalledTimes(1);
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent("Update läuft im Terminal");
  });

  it("appears when a later check finds a release", async () => {
    const { api, push } = bridge(null);
    renderNotice(api);
    push({ version: "1.0.0", url: "" });
    await waitFor(() => expect(screen.getByTestId("update-notice")).toBeInTheDocument());
  });
});
