import { runCli } from "./program.js";

// The packaged launcher starts the app binary as Node with ELECTRON_RUN_AS_NODE. Commands that
// spawn other programs (uv, an agent CLI) must not hand that switch on.
delete process.env.ELECTRON_RUN_AS_NODE;

process.exitCode = await runCli(process.argv.slice(2));
