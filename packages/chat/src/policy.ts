import type { PermissionOption, RequestPermissionRequest } from "@agentclientprotocol/sdk";
import { relativeInside } from "./util.js";

/**
 * Answers the permission requests of an agent. A request that nobody answers blocks the agent
 * (research note, section 4.5, point 6), so every request gets an answer.
 *
 * - citegeist's own MCP tools are allowed. In a research job `add_item` must target the inbox
 *   and carry a reason (D7).
 * - Reading, searching and fetching are allowed, because research needs the web.
 * - Edits are allowed inside the library's text areas (D12), never in derived data, converted
 *   sources or the manifest, and never in a research job.
 * - Shell commands and everything unknown are rejected in the sandbox (A11, isolated).
 *   Outside the sandbox the agent runs in the user's own environment: the shell and the user's
 *   other tools are allowed, and edits outside the library are allowed. The library keeps its
 *   protected areas (derived data, converted sources, the manifest).
 */

export type SessionMode = "chat" | "research";

export interface PolicyContext {
  mode: SessionMode;
  /** A11: the sandbox. Research jobs are always isolated. */
  isolated: boolean;
  libraryRoot: string;
  /** The session's scratch directory, where the agent may keep working files. */
  scratchDir: string;
}

export interface Decision {
  allow: boolean;
  /** Shown to Jonny when the request was rejected. */
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
    return { allow: true };
  }

  switch (call.kind) {
    case "read":
    case "search":
    case "think":
    case "fetch":
      return { allow: true };
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
