import { type Actor, CitegeistError } from "@citegeist/schema";
import type { z } from "zod";

export type Access = "read" | "write" | "admin";

/** Context every handler receives. `actor` becomes the provenance of everything it writes. */
export interface OpContext {
  actor: Actor;
  signal?: AbortSignal;
  /**
   * False when the caller may not make the core read local files of this Mac (`items.add` with a
   * path, `items.attach`). Unset means allowed: the human, `cg` and local MCP clients. MCP tokens
   * of research sessions carry false.
   */
  localFiles?: boolean;
  /**
   * "scholarly" when the caller is an unattended research job (W5.1): `items.add` then refuses
   * an address that the model composed, which is every URL outside the scholarly hosts of
   * `SCHOLARLY_HOSTS`. Unset means no limit.
   */
  egress?: "scholarly";
}

/** MCP exposure: the curated tool name and whether the tool is read-only (readOnlyHint). */
export interface McpExposure {
  tool: string;
  readOnly: boolean;
  idempotent?: boolean;
}

/** The contract of one operation. Handlers are bound later by the core; contracts carry no logic. */
export interface OperationContract<
  I extends z.ZodType = z.ZodType,
  O extends z.ZodType = z.ZodType,
> {
  name: string;
  summary: string;
  access: Access;
  input: I;
  output: O;
  mcp?: McpExposure;
  /** CLI command path, e.g. ["items", "add"]. Defaults to the name split at dots. */
  cli?: string[];
  /**
   * Input fields that hold a secret. The CLI adds `--<field>-stdin` for each, so the value does
   * not appear in the process list or the shell history.
   */
  secretInputs?: string[];
}

export function defineContract<I extends z.ZodType, O extends z.ZodType>(
  c: OperationContract<I, O>,
): OperationContract<I, O> {
  return c;
}

export type Handler<C extends OperationContract> = (
  ctx: OpContext,
  input: z.output<C["input"]>,
) => Promise<z.input<C["output"]>>;

/** Binds contracts to handlers. The core builds one registry; RPC, CLI and MCP are generated from it. */
export class Registry {
  private readonly handlers = new Map<
    string,
    { contract: OperationContract; handler: Handler<OperationContract> }
  >();

  bind<C extends OperationContract>(contract: C, handler: Handler<C>): this {
    if (this.handlers.has(contract.name))
      throw new Error(`operation ${contract.name} is already bound`);
    this.handlers.set(contract.name, { contract, handler: handler as Handler<OperationContract> });
    return this;
  }

  get(name: string) {
    return this.handlers.get(name);
  }

  list(): OperationContract[] {
    return [...this.handlers.values()].map((h) => h.contract);
  }

  async call(name: string, ctx: OpContext, rawInput: unknown): Promise<unknown> {
    const entry = this.handlers.get(name);
    if (!entry) {
      throw new CitegeistError({
        code: "UNKNOWN_OPERATION",
        message: `No operation named ${name}`,
        fix: "Run `cg --help` or list the MCP tools to see the available operations",
        recovery: "fix-and-retry",
        context: { name },
      });
    }
    if (entry.contract.access === "admin" && ctx.actor !== "human") {
      throw new CitegeistError({
        code: "FORBIDDEN_ADMIN",
        message: `Operation ${name} can only be run by a human, caller was ${ctx.actor}`,
        fix: "Ask the user to run this from the citegeist app or the cg CLI",
        recovery: "ask-human",
        context: { name, actor: ctx.actor },
      });
    }
    const input = entry.contract.input.parse(rawInput);
    const output = await entry.handler(ctx, input);
    return entry.contract.output.parse(output);
  }
}
