// No model call: streaming-input query that never sends a prompt, only inspects the initialize result.
import { query } from "@anthropic-ai/claude-agent-sdk";
import { cleanEnv } from "./shared.mjs";
async function* never() { await new Promise(() => {}); }
const q = query({ prompt: never(), options: { model: "haiku", tools: [], settingSources: [], persistSession: false, env: cleanEnv() } });
const init = await q.initializationResult?.();
console.log(JSON.stringify(init?.models ?? (await q.supportedModels()), null, 1).slice(0, 3000));
q.close();
process.exit(0);
