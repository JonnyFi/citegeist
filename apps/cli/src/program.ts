import { readFile } from "node:fs/promises";
import {
  formatAgentError,
  generateToken,
  serveMcpStdio,
  startMcpHttpServer,
  toAgentError,
} from "@citegeist/mcp";
import { localizeError, type OperationContract, type Registry } from "@citegeist/ops";
import { Actor, type AgentError, CitegeistError } from "@citegeist/schema";
import { Command, CommanderError } from "commander";
import { EXIT, EXIT_HELP, exitCodeFor } from "./exit.js";
import { buildInput, type CommandSpec, commandSpec } from "./flags.js";
import { formatHuman } from "./output.js";
import { createRegistry, libraryFlagFromArgv, registryControls } from "./registry.js";

export interface CliIO {
  stdout(text: string): void;
  stderr(text: string): void;
  readStdin(): Promise<string>;
  env: NodeJS.ProcessEnv;
}

export interface RunOptions {
  /** Defaults to createRegistry() from ./registry.js. */
  registry?: Registry;
  io?: Partial<CliIO>;
}

const RESERVED_FLAGS = new Set(["json", "actor", "input", "input-file", "help"]);

async function readAllStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks).toString("utf8");
}

function camel(flag: string): string {
  return flag.replace(/-([a-z0-9])/g, (_m, c: string) => c.toUpperCase());
}

function collect(value: string, previous: string[] | undefined): string[] {
  return [...(previous ?? []), value];
}

/** The root command and one subcommand per contract. Nothing here names an individual operation. */
export function buildProgram(registry: Registry, io: CliIO, onExit: (code: number) => void) {
  const root = new Command("cg");
  root
    .description("citegeist command line. Every operation of the library is a command.")
    .option("--json", "print results and errors as JSON")
    .option("--library <path>", "library folder (env CITEGEIST_LIBRARY, default ~/Citegeist)")
    .option("--actor <actor>", 'who is calling, "human" or "agent:<name>" (env CITEGEIST_ACTOR)')
    .addHelpText("after", `\n${EXIT_HELP}`)
    .exitOverride()
    .configureOutput({
      writeOut: (s) => io.stdout(s),
      writeErr: (s) => io.stderr(s),
      outputError: () => {},
    });

  const groups = new Map<string, Command>();
  const groupFor = (path: string[]): Command => {
    let parent = root;
    let key = "";
    for (const segment of path) {
      key = `${key}/${segment}`;
      let group = groups.get(key);
      if (!group) {
        group = parent.command(segment).description(`${segment} commands`);
        groups.set(key, group);
      }
      parent = group;
    }
    return parent;
  };

  const report = (raw: AgentError, json: boolean) => {
    // Fix texts name operations; on the command line they are `cg` commands.
    const error = localizeError(raw, "cli", registry.list());
    io.stderr(json ? `${JSON.stringify({ error })}\n` : `${formatAgentError(error)}\n`);
    onExit(exitCodeFor(error));
  };

  for (const contract of registry.list()) {
    const spec = commandSpec(contract);
    for (const f of spec.flags) {
      if (RESERVED_FLAGS.has(f.flag)) {
        throw new Error(
          `operation ${contract.name}: input field ${f.prop} collides with --${f.flag}`,
        );
      }
    }
    const leafName = spec.path[spec.path.length - 1] ?? contract.name;
    const leaf = groupFor(spec.path.slice(0, -1)).command(leafName).description(contract.summary);
    const camelName = contract.name.split(".").pop();
    if (camelName && camelName !== leafName && !contract.cli) leaf.alias(camelName);

    if (spec.positional) {
      const p = spec.positional;
      leaf.argument(p.list ? `[${p.prop}...]` : `[${p.prop}]`, "required");
    }
    for (const f of spec.flags) {
      const desc = f.required
        ? `${f.description}${f.description ? "; " : ""}required`
        : f.description;
      if (f.kind === "boolean") {
        leaf.option(`--${f.flag}`, desc).option(`--no-${f.flag}`, `negates --${f.flag}`);
      } else if (f.kind === "string-list" || f.kind === "number-list") {
        leaf.option(`--${f.flag} <value>`, desc, collect);
      } else {
        leaf.option(`--${f.flag} <value>`, desc);
      }
    }
    leaf
      .option("--input <json>", "whole input as a JSON object; flags override its fields")
      .option("--input-file <path>", 'read the input JSON from a file, "-" for stdin')
      .addHelpText("after", `\nOperation: ${contract.name} (${contract.access})`)
      .action(async (...args: unknown[]) => {
        const cmd = args[args.length - 1] as Command;
        const opts = cmd.optsWithGlobals() as Record<string, unknown>;
        const json = Boolean(opts.json);
        try {
          await runOperation(contract, spec, args, opts);
        } catch (err) {
          const detail = toAgentError(err);
          if (detail.code === "INVALID_INPUT" && err instanceof Error && err.name === "ZodError") {
            detail.fix = `Correct the listed fields. Run "cg ${spec.path.join(" ")} --help" for the arguments.`;
          }
          report(detail, json);
        }
      });
  }

  async function runOperation(
    contract: OperationContract,
    spec: CommandSpec,
    args: unknown[],
    opts: Record<string, unknown>,
  ): Promise<void> {
    const actorText = String(opts.actor ?? io.env.CITEGEIST_ACTOR ?? "human");
    const actor = Actor.safeParse(actorText);
    if (!actor.success) {
      throw usage(`--actor "${actorText}" is not valid.`, 'Use "human" or "agent:<name>".');
    }
    let base: Record<string, unknown> = {};
    const inputText =
      typeof opts.input === "string"
        ? opts.input
        : typeof opts.inputFile === "string"
          ? opts.inputFile === "-"
            ? await io.readStdin()
            : await readFile(opts.inputFile, "utf8").catch(() => {
                throw usage(`Cannot read ${String(opts.inputFile)}.`, "Check the path.");
              })
          : undefined;
    if (inputText !== undefined) {
      try {
        const parsed: unknown = JSON.parse(inputText);
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
          throw new Error();
        base = parsed as Record<string, unknown>;
      } catch {
        throw usage(
          "The input is not a JSON object.",
          'Pass an object such as \'{"identifier":"10.1000/x"}\'.',
        );
      }
    }
    const rawPositional = args[0];
    const positional =
      spec.positional && Array.isArray(rawPositional) && rawPositional.length === 0
        ? undefined
        : (rawPositional as string | string[] | undefined);
    const flags: Record<string, unknown> = {};
    for (const f of spec.flags) flags[f.prop] = opts[camel(f.flag)];
    const input = buildInput(
      spec,
      { positional: spec.positional ? positional : undefined, flags },
      base,
    );
    const out = await registry.call(contract.name, { actor: actor.data }, input);
    io.stdout(`${opts.json ? JSON.stringify(out) : formatHuman(out)}\n`);
  }

  root
    .command("mcp")
    .description("start the MCP server (stdio by default)")
    .option("--http", "serve Streamable HTTP on 127.0.0.1 instead of stdio")
    .option("--port <port>", "port for --http, 0 picks a free one", "0")
    .option("--scope <scope>", "stdio: read or write", "write")
    .addHelpText(
      "after",
      "\nHTTP tokens come from CITEGEIST_MCP_TOKEN (write scope) and CITEGEIST_MCP_READ_TOKEN (read scope). Without CITEGEIST_MCP_TOKEN a random one is printed on stderr.",
    )
    .action(async (opts: { http?: boolean; port: string; scope: string }) => {
      if (opts.scope !== "read" && opts.scope !== "write") {
        report(usage(`--scope ${opts.scope} is not valid.`, "Use read or write.").detail, false);
        return;
      }
      const onerror = (e: Error) => io.stderr(`mcp error: ${e.message}\n`);
      // Open the library now if no app serves it, so the watcher indexes edits from the start.
      await registryControls(registry)
        .warm()
        .catch((e: unknown) => onerror(e instanceof Error ? e : new Error(String(e))));
      if (!opts.http) {
        const handle = serveMcpStdio(registry, { scope: opts.scope, onerror });
        await new Promise<void>((resolve) => {
          process.stdin.once("close", resolve);
          process.stdin.once("end", resolve);
        });
        await handle.close();
        return;
      }
      const writeToken = io.env.CITEGEIST_MCP_TOKEN || generateToken();
      const readToken = io.env.CITEGEIST_MCP_READ_TOKEN;
      const handle = await startMcpHttpServer(registry, {
        port: Number(opts.port),
        onerror,
        tokens: [
          { token: writeToken, scope: "write" },
          ...(readToken ? [{ token: readToken, scope: "read" as const }] : []),
        ],
      });
      io.stderr(`citegeist MCP listening on ${handle.url}\n`);
      if (!io.env.CITEGEIST_MCP_TOKEN) io.stderr(`bearer token: ${writeToken}\n`);
      await new Promise<void>((resolve) => {
        process.once("SIGINT", resolve);
        process.once("SIGTERM", resolve);
      });
      await handle.close();
    });

  return { root, report };
}

function usage(message: string, fix: string): CitegeistError {
  return new CitegeistError({
    code: "USAGE_ERROR",
    message,
    fix,
    recovery: "fix-and-retry",
    sideEffects: "none",
  });
}

/** Runs `cg` with the given arguments (without node and script) and returns the exit code. */
export async function runCli(argv: string[], options: RunOptions = {}): Promise<number> {
  const io: CliIO = {
    stdout: (s) => void process.stdout.write(s),
    stderr: (s) => void process.stderr.write(s),
    readStdin: readAllStdin,
    env: process.env,
    ...options.io,
  };
  const registry =
    options.registry ??
    createRegistry(io.env, { library: libraryFlagFromArgv(argv), longLived: argv[0] === "mcp" });
  let code: number = EXIT.ok;
  const { root, report } = buildProgram(registry, io, (c) => {
    code = c;
  });
  const wantsJson = argv.includes("--json");
  try {
    await root.parseAsync(argv, { from: "user" });
  } catch (err) {
    if (err instanceof CommanderError) {
      if (err.exitCode === 0) return EXIT.ok;
      report(
        usage(err.message.replace(/^error: /, ""), 'Run "cg --help" or add --help to the command.')
          .detail,
        wantsJson,
      );
    } else {
      report(toAgentError(err), wantsJson);
    }
  }
  await registryControls(registry)
    .close()
    .catch(() => {});
  return code;
}
