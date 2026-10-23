/**
 * Record and replay of HTTP responses for tests. A recording is one JSON file per request in
 * fixtures/metadata/http. The key is the request URL without identifying parameters (mailto,
 * API keys) plus the Accept header, so recordings never contain who made the request.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { FetchLike } from "./http.js";
import { keyUrl } from "./http.js";

export interface RecordedResponse {
  url: string;
  accept: string;
  status: number;
  contentType: string;
  body: string;
}

export function fixtureName(url: string, accept: string): string {
  const u = new URL(url);
  const hash = createHash("sha256")
    .update(`${keyUrl(url)}\n${accept}`)
    .digest("hex")
    .slice(0, 12);
  const slug = `${u.hostname.replace(/^(www|api|export|services|sru)\./, "")}${u.pathname}`
    .replace(/[^a-zA-Z0-9.-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
  return `${slug}-${hash}.json`;
}

function acceptOf(init: RequestInit | undefined): string {
  const h = init?.headers;
  if (!h) return "";
  if (h instanceof Headers) return h.get("accept") ?? "";
  if (Array.isArray(h)) return h.find(([k]) => k?.toLowerCase() === "accept")?.[1] ?? "";
  const rec = h as Record<string, string>;
  for (const k of Object.keys(rec)) if (k.toLowerCase() === "accept") return rec[k] ?? "";
  return "";
}

/** Serves recorded responses. Unknown requests fail loudly: tests never go online. */
export function createReplayFetch(dir: string): FetchLike & { calls: string[] } {
  const calls: string[] = [];
  const fn: FetchLike = async (input, init) => {
    const accept = acceptOf(init);
    const file = join(dir, fixtureName(input, accept));
    calls.push(keyUrl(input));
    let rec: RecordedResponse;
    try {
      rec = JSON.parse(await readFile(file, "utf8")) as RecordedResponse;
    } catch {
      throw new Error(`No recorded response for ${keyUrl(input)} (accept: ${accept || "-"})`);
    }
    return new Response(rec.body, {
      status: rec.status,
      headers: { "content-type": rec.contentType },
    });
  };
  return Object.assign(fn, { calls });
}

/** Wraps a real fetch and stores every response in `dir`. Used once to record the fixtures. */
export function createRecordingFetch(dir: string, real: FetchLike = fetch): FetchLike {
  return async (input, init) => {
    const res = await real(input, init);
    const body = await res.clone().text();
    const accept = acceptOf(init);
    const rec: RecordedResponse = {
      url: keyUrl(input),
      accept,
      status: res.status,
      contentType: res.headers.get("content-type") ?? "",
      body,
    };
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, fixtureName(input, accept)), `${JSON.stringify(rec)}\n`);
    return res;
  };
}
