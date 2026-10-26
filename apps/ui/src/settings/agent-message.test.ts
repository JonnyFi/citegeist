import { describe, expect, it } from "vitest";
import {
  type AgentMessageInput,
  buildAgentMessage,
  CALLBACK_PLACEHOLDER,
  MCP_PLACEHOLDER,
} from "./agent-message";

const BASE: AgentMessageInput = {
  name: "phd-bot",
  kind: "both",
  publicUrl: "https://mac.example.ts.net",
  hasInboundToken: false,
};

function text(input: Partial<AgentMessageInput>): string {
  const out = buildAgentMessage({ ...BASE, ...input });
  if (!out.ok) throw new Error("expected a message");
  return out.text;
}

describe("buildAgentMessage", () => {
  it("refuses without a public address", () => {
    expect(buildAgentMessage({ ...BASE, publicUrl: undefined })).toEqual({
      ok: false,
      reason: "no-public-url",
    });
    expect(buildAgentMessage({ ...BASE, publicUrl: "  " }).ok).toBe(false);
  });

  it("gives the MCP part with name, URL, header name and the full header value", () => {
    const out = text({ kind: "outbound", mcpScope: "write", mcpToken: "whmcp_abc" });
    expect(out).toContain("custom MCP server");
    expect(out).toContain("Name: citegeist");
    expect(out).toContain("URL: https://mac.example.ts.net/mcp");
    expect(out).toContain("Header-Name: Authorization");
    expect(out).toContain("Header-Wert: Bearer whmcp_abc");
    expect(out).toContain("Einträge anlegen");
    expect(out).not.toContain("/hooks/");
  });

  it("says that read access is read only", () => {
    expect(text({ kind: "outbound", mcpScope: "read", mcpToken: "whmcp_abc" })).toContain(
      "nur lesend",
    );
  });

  it("strips a trailing slash from the public address", () => {
    expect(
      text({ kind: "outbound", mcpScope: "read", publicUrl: "https://mac.example.ts.net/" }),
    ).toContain("URL: https://mac.example.ts.net/mcp\n");
  });

  it("uses a placeholder for a token that is not known any more", () => {
    const out = buildAgentMessage({ ...BASE, mcpScope: "write", hasInboundToken: true });
    if (!out.ok) throw new Error("expected a message");
    expect(out.text).toContain(`Header-Wert: Bearer ${MCP_PLACEHOLDER}`);
    expect(out.text).toContain(`Authorization: Bearer ${CALLBACK_PLACEHOLDER}`);
    expect(out.needsMcpToken).toBe(true);
    expect(out.needsInboundToken).toBe(true);
  });

  it("needs no placeholder once both tokens are given", () => {
    const out = buildAgentMessage({
      ...BASE,
      mcpScope: "write",
      mcpToken: "whmcp_1",
      hasInboundToken: true,
      inboundToken: "whtok_1",
    });
    if (!out.ok) throw new Error("expected a message");
    expect(out.needsMcpToken).toBe(false);
    expect(out.needsInboundToken).toBe(false);
    expect(out.text).not.toContain("-TOKEN:");
    expect(out.text).toMatch(/Authorization: Bearer whtok_1/);
    expect(out.text).toMatch(/Header-Wert: Bearer whmcp_1/);
  });

  it("never mixes the two tokens up", () => {
    const out = text({ mcpScope: "write", mcpToken: "whmcp_1", inboundToken: "whtok_1" });
    const mcpPart = out.split("Aufträge von")[0] as string;
    expect(mcpPart).toContain("whmcp_1");
    expect(mcpPart).not.toContain("whtok_1");
    expect(out.split("Header:")[1]).not.toContain("whmcp_1");
  });

  it("gives the callback part for a both connector: callback.url, headers and both bodies", () => {
    const out = text({ hasInboundToken: true, inboundToken: "whtok_9" });
    expect(out).toContain("task.request");
    expect(out).toContain("callback.url aus genau diesem Auftrag");
    expect(out).toContain("Authorization: Bearer whtok_9");
    expect(out).toContain("x-citegeist-id:");
    expect(out).toContain('"status":"succeeded"');
    expect(out).toContain('"status":"failed","error"');
    expect(out).toContain("papers.add");
    expect(out).toContain("note.add");
    expect(out).toContain("https://mac.example.ts.net/hooks/phd-bot");
    expect(out).toContain("denselben Headern wie oben");
  });

  it("gives an inbound connector the headers and the papers and notes, no tasks", () => {
    const out = text({ kind: "inbound", hasInboundToken: true, inboundToken: "whtok_9" });
    expect(out).not.toContain("task.request");
    expect(out).not.toContain("task.result");
    expect(out).toContain("POST an https://mac.example.ts.net/hooks/phd-bot.");
    expect(out).toContain("Authorization: Bearer whtok_9");
    expect(out).toContain("papers.add");
  });

  it("gives an outbound connector without a token only the task line", () => {
    const out = buildAgentMessage({ ...BASE, kind: "outbound" });
    if (!out.ok) throw new Error("expected a message");
    expect(out.text).toContain("task.request");
    expect(out.text).not.toContain("Authorization");
    expect(out.needsInboundToken).toBe(false);
    expect(out.needsMcpToken).toBe(false);
  });

  it("gives an outbound connector with a token the callback part but not papers.add", () => {
    const out = text({ kind: "outbound", hasInboundToken: true, inboundToken: "whtok_2" });
    expect(out).toContain("task.result");
    expect(out).not.toContain("papers.add");
    expect(out).not.toContain("note.add");
  });

  it("contains no em dash", () => {
    const out = text({ mcpScope: "write", hasInboundToken: true });
    expect(out).not.toContain(String.fromCharCode(0x2014));
  });
});
