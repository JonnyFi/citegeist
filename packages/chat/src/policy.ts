import { resolve } from "node:path";
import type { PermissionOption, RequestPermissionRequest } from "@agentclientprotocol/sdk";
import { isScholarlyUrl } from "@citegeist/ops";
import { researchFetch } from "./egress.js";
import { relativeInside } from "./util.js";

/**
 * Answers the permission requests of an agent. A request that nobody answers blocks the agent
 * so every request gets an answer.
 *
 * - citegeist's own MCP tools are allowed. In a research job `add_item` must target the inbox
 *   and carry a reason (docs/decisions/0014-agent-content-goes-to-inbox.md).
 * - Reading, searching and fetching are allowed, because research needs the web. A research job
 *   fetches only addresses that a web search returned or that sit on a scholarly host, and it
 *   adds papers only by an address of such a host or by DOI or arXiv id (Agents Rule of Two).
 * - Edits are allowed inside the library's text areas (docs/decisions/0018-direct-agent-edits-with-undo.md), never in derived data, converted
 *   sources or the manifest, and never in a research job.
 * - Shell commands and everything unknown are rejected in the sandbox (isolated).
 *   Outside the sandbox the agent runs in the user's own environment: the shell and the user's
 *   other tools are allowed, and edits outside the library are allowed. The library keeps its
 *   protected areas (derived data, converted sources, the manifest).
 */

export type SessionMode = "chat" | "research";

export interface PolicyContext {
  mode: SessionMode;
  /** The sandbox. Research jobs are always isolated. */
  isolated: boolean;
  libraryRoot: string;
  /** The session's scratch directory, where the agent may keep working files. */
  scratchDir: string;
  /**
   * Normalized addresses that the web search of this session returned. A research job may fetch
   * exactly these besides the scholarly hosts (`egress.ts`).
   */
  seenUrls?: ReadonlySet<string>;
}

export interface Decision {
  allow: boolean;
  /** Shown to the user when the request was rejected. */
  reason?: string;
}

/** Name of the citegeist MCP tool behind a tool call, e.g. `mcp__citegeist__add_item` -> `add_item`. */
export function citegeistTool(call: {
  name?: string | null | undefined;
  title?: string | null | undefined;
  _meta?: { [key: string]: unknown } | null | undefined;
}): string | undefined {
  const claude = (call._meta?.claudeCode as { toolName?: unknown } | undefined)?.toolName;
  // Strict on purpose: a file edit whose path contains "citegeist" must not pass as a citegeist tool.
  const patterns: Array<[string | null | undefined, RegExp]> = [
    [typeof claude === "string" ? claude : undefined, /^mcp__citegeist__([a-z][a-z0-9_]*)$/],
    [call.name, /^mcp__citegeist__([a-z][a-z0-9_]*)$/],
    [call.title, /^(?:mcp__)?citegeist(?:__|:\s*|\s+-\s+|\.)([a-z][a-z0-9_]*)(?:\s*\(MCP\))?$/i],
  ];
  for (const [text, re] of patterns) {
    const m = text ? re.exec(text.trim()) : null;
    if (m?.[1]) return m[1];
  }
  return undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Library paths an agent must not write: derived data, originals, the manifest and agent rules. */
function writable(rel: string): boolean {
  if (!/^(items|notes|projects)\//.test(rel)) return false;
  if (/(^|\/)(derived|sources|exports)\//.test(rel)) return false;
  return true;
}

const FILE_EXT = /\.(pdf|html?|epub)$/i;
const DOI_LIKE = /^(doi:)?10\.\d{4,9}\//i;

/**
 * The local file a citegeist tool call would read, or undefined when it names none. `add_item`
 * takes a DOI, a URL or a path; `attach_file` always takes a path.
 */
function localFileOf(tool: string, input: Record<string, unknown>): string | undefined {
  if (tool === "attach_file" && typeof input.path === "string") return input.path;
  if (tool !== "add_item" || typeof input.identifier !== "string") return undefined;
  const id = input.identifier.trim();
  if (id.startsWith("file://")) return id.slice("file://".length);
  if (/^(\/|~|\.{1,2}\/)/.test(id)) return id;
  if (DOI_LIKE.test(id) || /^[a-z][a-z0-9+.-]*:\/\//i.test(id)) return undefined;
  return FILE_EXT.test(id) ? id : undefined;
}

/** Inside the library or the scratch folder: where an agent without the user's trust may read. */
function inAllowedArea(ctx: PolicyContext, abs: string): boolean {
  return [ctx.scratchDir, ctx.libraryRoot].some(
    (root) => abs === root || relativeInside(root, abs) !== undefined,
  );
}

/**
 * Paths a read or search names: the usual path arguments, plus the fixed part of a glob or
 * pattern that starts at the root or at the home folder (`/Users/me/.ssh/*`).
 */
function readPathsOf(req: RequestPermissionRequest, scratchDir: string): string[] {
  const out = pathsOf(req);
  const raw = req.toolCall.rawInput;
  if (raw && typeof raw === "object") {
    for (const key of ["pattern", "glob"]) {
      const v = (raw as Record<string, unknown>)[key];
      if (typeof v === "string" && /^[/~]/.test(v)) out.push(v.split(/[*?[{]/)[0] ?? v);
    }
  }
  // A relative path is relative to the working folder of the session.
  return out.map((p) => (p.startsWith("~") ? p : resolve(scratchDir, p)));
}

function pathsOf(req: RequestPermissionRequest): string[] {
  const out: string[] = [];
  for (const loc of req.toolCall.locations ?? []) out.push(loc.path);
  for (const c of req.toolCall.content ?? []) if (c.type === "diff") out.push(c.path);
  const raw = req.toolCall.rawInput;
  if (raw && typeof raw === "object") {
    for (const key of ["file_path", "path", "filePath"]) {
      const v = (raw as Record<string, unknown>)[key];
      if (typeof v === "string") out.push(v);
    }
  }
  return out;
}

export function decide(req: RequestPermissionRequest, ctx: PolicyContext): Decision {
  const call = req.toolCall;
  const tool = citegeistTool(call);
  if (tool) {
    // Without arguments in the request there is nothing to check; the research runner flags a
    // violation afterwards from the finished tool call.
    if (ctx.mode === "research" && tool === "add_item" && isObject(call.rawInput)) {
      const input = (call.rawInput ?? {}) as { target?: unknown; why?: unknown };
      if (input.target === "library") {
        return {
          allow: false,
          reason: "A research job adds papers to the inbox. Call add_item without target library.",
        };
      }
      if (typeof input.why !== "string" || input.why.trim() === "") {
        return {
          allow: false,
          reason: "add_item needs a reason in `why`. Call it again with one.",
        };
      }
    }
    // The core opens the address of `add_item`. In a research job, an address that the model
    // composed could carry library content to a server of the attacker (Agents Rule of Two).
    if (ctx.mode === "research" && tool === "add_item" && isObject(call.rawInput)) {
      const id = (call.rawInput as { identifier?: unknown }).identifier;
      if (typeof id === "string" && /^https?:\/\//i.test(id.trim()) && !isScholarlyUrl(id.trim())) {
        return {
          allow: false,
          reason:
            "A research job adds a paper by DOI, arXiv id or the address of a scholarly host, not by an arbitrary web address. Call add_item with the DOI or leave the paper out.",
        };
      }
    }
    // The core reads a local file named in a tool call with the rights of the user. An agent
    // that works on web content (research) or in the sandbox gets none of that: injected text
    // must not be able to pull a file of the user into the library and read it from there.
    if ((ctx.isolated || ctx.mode === "research") && isObject(call.rawInput)) {
      const file = localFileOf(tool, call.rawInput as Record<string, unknown>);
      if (file !== undefined && (ctx.mode === "research" || !inAllowedArea(ctx, file))) {
        return {
          allow: false,
          reason:
            "An isolated agent may not add files from outside the library. Pass a DOI, an arXiv id or a URL.",
        };
      }
    }
    return { allow: true };
  }

  switch (call.kind) {
    case "read":
    case "search": {
      // The sandbox and research jobs read the library and their scratch folder, nothing else.
      // Everything else on the disk (keys, the token of the core, other projects) stays closed,
      // because web content can steer the agent and the web fetch is an open exit.
      if (ctx.isolated || ctx.mode === "research") {
        for (const p of readPathsOf(req, ctx.scratchDir)) {
          if (!inAllowedArea(ctx, p)) {
            return { allow: false, reason: `Reading ${p} is not allowed in an isolated chat.` };
          }
        }
      }
      return { allow: true };
    }
    case "think":
      return { allow: true };
    case "fetch": {
      if (ctx.mode !== "research") return { allow: true };
      const verdict = researchFetch(call, ctx.seenUrls);
      return verdict.allow ? { allow: true } : { allow: false, reason: verdict.reason };
    }
    case "edit":
    case "delete":
    case "move": {
      if (ctx.mode === "research") {
        return {
          allow: false,
          reason: "A research job changes the library only through add_item.",
        };
      }
      const paths = pathsOf(req);
      if (paths.length === 0) {
        if (!ctx.isolated) return { allow: true };
        return { allow: false, reason: "The edit names no file, so citegeist cannot record it." };
      }
      for (const p of paths) {
        if (relativeInside(ctx.scratchDir, p) !== undefined) continue;
        const rel = relativeInside(ctx.libraryRoot, p);
        // The user's own environment may change files outside the library.
        if (rel === undefined && !ctx.isolated) continue;
        if (rel === undefined || !writable(rel)) {
          return { allow: false, reason: `Editing ${p} is not allowed in a chat.` };
        }
      }
      return { allow: true };
    }
    case "execute":
      if (!ctx.isolated && ctx.mode === "chat") return { allow: true };
      return {
        allow: false,
        reason:
          "Shell commands are not allowed in an isolated chat. Turn off Isolierter Agent in the settings to allow them.",
      };
    default:
      // The user's own MCP servers and other tools.
      if (!ctx.isolated && ctx.mode === "chat") return { allow: true };
      return {
        allow: false,
        reason: `The tool call "${call.title ?? call.name ?? "?"}" is not allowed.`,
      };
  }
}

/** The option that carries out a decision, or undefined when the agent offered none. */
export function pickOption(
  options: readonly PermissionOption[],
  allow: boolean,
): PermissionOption | undefined {
  const order = allow ? ["allow_once", "allow_always"] : ["reject_once", "reject_always"];
  for (const kind of order) {
    const hit = options.find((o) => o.kind === kind);
    if (hit) return hit;
  }
  return undefined;
}
