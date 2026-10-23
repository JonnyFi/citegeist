import type { OperationContract } from "@citegeist/ops";
import { CitegeistError } from "@citegeist/schema";
import { z } from "zod";

type Json = Record<string, unknown>;

export type FlagKind = "string" | "number" | "boolean" | "string-list" | "number-list" | "json";

export interface FlagSpec {
  /** Property name in the input object. */
  prop: string;
  /** Long option name without dashes, e.g. "max-chars". */
  flag: string;
  kind: FlagKind;
  required: boolean;
  description: string;
}

export interface CommandSpec {
  /** Command path, e.g. ["items", "add"]. */
  path: string[];
  /** Property filled by the positional argument, if any. */
  positional?: { prop: string; list: boolean };
  flags: FlagSpec[];
}

export function kebab(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/_/g, "-")
    .toLowerCase();
}

/** CLI path of a contract: `cli` when set, else the name split at dots (camelCase becomes kebab-case). */
export function commandPath(contract: OperationContract): string[] {
  return contract.cli ?? contract.name.split(".").map(kebab);
}

function scalarKind(prop: Json): "string" | "number" | "boolean" | undefined {
  if (Array.isArray(prop.enum) || typeof prop.const === "string") return "string";
  if (prop.type === "string") return "string";
  if (prop.type === "number" || prop.type === "integer") return "number";
  if (prop.type === "boolean") return "boolean";
  return undefined;
}

function kindOf(prop: Json): FlagKind {
  const scalar = scalarKind(prop);
  if (scalar === "string") return "string";
  if (scalar === "number") return "number";
  if (scalar === "boolean") return "boolean";
  if (prop.type === "array" && typeof prop.items === "object" && prop.items !== null) {
    const item = scalarKind(prop.items as Json);
    if (item === "string") return "string-list";
    if (item === "number") return "number-list";
  }
  return "json";
}

function describe(prop: Json, kind: FlagKind): string {
  const parts: string[] = [];
  if (typeof prop.description === "string") parts.push(prop.description);
  const choices =
    (Array.isArray(prop.enum) && prop.enum) ||
    (typeof prop.items === "object" && prop.items !== null && (prop.items as Json).enum);
  if (Array.isArray(choices)) parts.push(`one of: ${choices.join(", ")}`);
  if (kind === "json") parts.push("JSON");
  if (kind === "string-list" || kind === "number-list") parts.push("repeat the flag for more");
  if (prop.default !== undefined) parts.push(`default: ${JSON.stringify(prop.default)}`);
  return parts.join("; ");
}

/** Derives positional argument and flags from the contract's input schema. */
export function commandSpec(contract: OperationContract): CommandSpec {
  const json = z.toJSONSchema(contract.input, { io: "input", unrepresentable: "any" }) as Json;
  const props = (json.properties ?? {}) as Record<string, Json>;
  const required = new Set(Array.isArray(json.required) ? (json.required as string[]) : []);
  const flags: FlagSpec[] = [];
  let positional: CommandSpec["positional"];
  for (const [name, prop] of Object.entries(props)) {
    const kind = kindOf(prop);
    if (
      !positional &&
      required.has(name) &&
      (kind === "string" || kind === "string-list") &&
      !Array.isArray(prop.enum)
    ) {
      positional = { prop: name, list: kind === "string-list" };
    }
    flags.push({
      prop: name,
      flag: kebab(name),
      kind,
      required: required.has(name),
      description: describe(prop, kind),
    });
  }
  return { path: commandPath(contract), ...(positional ? { positional } : {}), flags };
}

function usageError(message: string, fix: string): CitegeistError {
  return new CitegeistError({
    code: "INVALID_INPUT",
    message,
    fix,
    recovery: "fix-and-retry",
    sideEffects: "none",
  });
}

/** Converts parsed command-line values into the raw input object for the operation. */
export function buildInput(
  spec: CommandSpec,
  values: { positional: string | string[] | undefined; flags: Record<string, unknown> },
  base: Json,
): Json {
  const input: Json = { ...base };
  const help = `Run "cg ${spec.path.join(" ")} --help" for the arguments.`;
  for (const f of spec.flags) {
    const raw = values.flags[f.prop];
    if (raw === undefined) continue;
    switch (f.kind) {
      case "string":
      case "boolean":
        input[f.prop] = raw;
        break;
      case "number": {
        const n = Number(raw);
        input[f.prop] = Number.isNaN(n) ? raw : n;
        break;
      }
      case "string-list":
        input[f.prop] = raw;
        break;
      case "number-list":
        input[f.prop] = (raw as string[]).map((v) => {
          const n = Number(v);
          return Number.isNaN(n) ? v : n;
        });
        break;
      case "json":
        try {
          input[f.prop] = JSON.parse(String(raw));
        } catch {
          throw usageError(`--${f.flag} is not valid JSON: ${String(raw).slice(0, 80)}`, help);
        }
        break;
    }
  }
  if (spec.positional && values.positional !== undefined) {
    input[spec.positional.prop] = values.positional;
  }
  return input;
}
