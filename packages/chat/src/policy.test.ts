import type { RequestPermissionRequest } from "@agentclientprotocol/sdk";
import { describe, expect, it } from "vitest";
import { citegeistTool, decide, pickOption } from "./policy.js";

const ctx = {
  mode: "chat" as const,
  isolated: true,
  libraryRoot: "/lib",
  scratchDir: "/local/chats/ch_1/cwd",
};
/** A11: the user's own environment. */
const open = { ...ctx, isolated: false };

const req = (
  toolCall: Partial<RequestPermissionRequest["toolCall"]>,
): RequestPermissionRequest => ({
  sessionId: "s",
  toolCall: { toolCallId: "c", ...toolCall },
  options: [
    { optionId: "a", name: "Allow", kind: "allow_once" },
    { optionId: "r", name: "Reject", kind: "reject_once" },
  ],
});

describe("citegeistTool", () => {
  it("reads the tool name from the usual spellings", () => {
    expect(citegeistTool({ name: "mcp__citegeist__add_item" })).toBe("add_item");
    expect(citegeistTool({ title: "citegeist - search (MCP)" })).toBe("search");
    expect(citegeistTool({ title: "mcp__citegeist__get_item" })).toBe("get_item");
    expect(
      citegeistTool({ title: "x", _meta: { claudeCode: { toolName: "mcp__citegeist__cite" } } }),
    ).toBe("cite");
  });

  it("does not mistake a file path for a tool", () => {
    expect(citegeistTool({ title: "Edit /Users/me/citegeist/notes.md" })).toBeUndefined();
    expect(citegeistTool({ name: "mcp__other__citegeist" })).toBeUndefined();
  });
});

describe("decide", () => {
  it("allows citegeist tools and read-only kinds", () => {
    expect(decide(req({ name: "mcp__citegeist__search", kind: "other" }), ctx).allow).toBe(true);
    expect(decide(req({ kind: "read", title: "Read file" }), ctx).allow).toBe(true);
    expect(decide(req({ kind: "fetch", title: "WebFetch" }), ctx).allow).toBe(true);
  });

  it("allows edits in the library's text areas and the scratch folder", () => {
    const edit = (path: string) => decide(req({ kind: "edit", locations: [{ path }] }), ctx).allow;
    expect(edit("/lib/notes/idee.md")).toBe(true);
    expect(edit("/lib/projects/phd/project.md")).toBe(true);
    expect(edit("/local/chats/ch_1/cwd/scratch.txt")).toBe(true);
  });

  it("rejects edits to derived data, sources, the manifest and anything outside", () => {
    const edit = (path: string) => decide(req({ kind: "edit", locations: [{ path }] }), ctx);
    expect(edit("/lib/items/a/derived/abc/doc.md").allow).toBe(false);
    expect(edit("/lib/items/a/sources/x.pdf").allow).toBe(false);
    expect(edit("/lib/citegeist.json").allow).toBe(false);
    expect(edit("/etc/hosts").allow).toBe(false);
    expect(edit("/lib/notes/../citegeist.json").allow).toBe(false);
    expect(decide(req({ kind: "edit" }), ctx)).toMatchObject({ allow: false });
  });

  it("rejects shell commands and unknown tools", () => {
    expect(decide(req({ kind: "execute", title: "Bash" }), ctx).allow).toBe(false);
    expect(decide(req({ kind: "other", title: "Mystery" }), ctx).allow).toBe(false);
    expect(decide(req({ kind: "switch_mode", title: "ExitPlanMode" }), ctx).allow).toBe(false);
  });

  it("lets an agent in the user's own environment use the shell and the user's tools (A11)", () => {
    expect(decide(req({ kind: "execute", title: "Bash" }), open).allow).toBe(true);
    expect(decide(req({ kind: "other", title: "mcp__github__create_issue" }), open).allow).toBe(
      true,
    );
    expect(decide(req({ kind: "edit", locations: [{ path: "/etc/hosts" }] }), open).allow).toBe(
      true,
    );
  });

  it("still protects derived data, sources and the manifest outside the sandbox", () => {
    const edit = (path: string) => decide(req({ kind: "edit", locations: [{ path }] }), open);
    expect(edit("/lib/items/a/derived/abc/doc.md").allow).toBe(false);
    expect(edit("/lib/items/a/sources/x.pdf").allow).toBe(false);
    expect(edit("/lib/citegeist.json").allow).toBe(false);
    expect(edit("/lib/notes/idee.md").allow).toBe(true);
  });

  it("does not open the shell for a research job even when the chat is not isolated", () => {
    const research = { ...open, mode: "research" as const };
    expect(decide(req({ kind: "other", title: "Mystery" }), research).allow).toBe(false);
    expect(decide(req({ kind: "execute", title: "Bash" }), research).allow).toBe(false);
  });

  it("keeps research jobs on the inbox path of add_item", () => {
    const research = { ...ctx, mode: "research" as const };
    const add = (rawInput: unknown) =>
      decide(req({ name: "mcp__citegeist__add_item", kind: "other", rawInput }), research);
    expect(add({ identifier: "10.1/x", why: "passt" }).allow).toBe(true);
    expect(add({ identifier: "10.1/x", why: "passt", target: "library" }).allow).toBe(false);
    expect(add({ identifier: "10.1/x" }).allow).toBe(false);
    expect(add({ identifier: "10.1/x", why: "  " }).allow).toBe(false);
    // Without arguments in the request there is nothing to check yet.
    expect(add(undefined).allow).toBe(true);
    // Research never edits files.
    expect(
      decide(req({ kind: "edit", locations: [{ path: "/lib/notes/a.md" }] }), research).allow,
    ).toBe(false);
  });
});

describe("pickOption", () => {
  const options = req({}).options;
  it("takes the matching one-time option", () => {
    expect(pickOption(options, true)?.optionId).toBe("a");
    expect(pickOption(options, false)?.optionId).toBe("r");
  });
  it("gives up when the agent offered no such option", () => {
    expect(
      pickOption([{ optionId: "a", name: "Allow", kind: "allow_once" }], false),
    ).toBeUndefined();
  });
});
