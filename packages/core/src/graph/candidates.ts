import type { GraphLookup } from "@citegeist/metadata";
import type { GraphWork } from "@citegeist/ops";
import { type Actor, CitegeistError } from "@citegeist/schema";
import type { AddInput, AddResult } from "../ingest/service.js";

export interface CandidateResult {
  identifier: string;
  status: "added" | "duplicate" | "failed";
  citekey?: string;
  job?: string;
  reason?: string;
}

export interface AddCandidatesInput {
  candidates: GraphWork[];
  from?: string | undefined;
  /** Which list the candidates come from. Words the note the user sees in the inbox. */
  via?: "references" | "citing" | undefined;
  projects: string[];
  tags: string[];
}

export interface AddCandidatesResult {
  results: CandidateResult[];
  added: number;
  duplicates: number;
  failed: number;
}

export type AddItem = (actor: Actor, input: AddInput) => Promise<AddResult>;

function why(input: AddCandidatesInput): string {
  if (!input.from) return "suggested by the citation graph";
  if (input.via === "references") return `cited by ${input.from}`;
  if (input.via === "citing") return `cites ${input.from}`;
  return `found in the citation graph of ${input.from}`;
}

/** The string items.add understands: DOI first, then arXiv id, then the DOI of an OpenAlex work. */
async function identifierOf(w: GraphWork, lookup: GraphLookup): Promise<string | undefined> {
  if (w.doi) return w.doi;
  if (w.arxiv) return `arXiv:${w.arxiv}`;
  if (w.openalex) return lookup.openAlexDoi(w.openalex);
  return undefined;
}

/**
 * Adds works of the citation graph to the inbox (docs/decisions/0014-agent-content-goes-to-inbox.md). A human who asks for it gets the same
 * inbox as an agent: the works wait for review, whoever found them. items.add puts a human's
 * additions straight into the library, so the call runs as "system" for a human and keeps the
 * agent's own name otherwise.
 */
export async function addCandidates(
  actor: Actor,
  deps: { lookup: GraphLookup; addItem: AddItem },
  input: AddCandidatesInput,
): Promise<AddCandidatesResult> {
  const by: Actor = actor === "human" ? "system" : actor;
  const results: CandidateResult[] = [];
  const seen = new Set<string>();
  for (const candidate of input.candidates) {
    let identifier: string | undefined;
    try {
      identifier = await identifierOf(candidate, deps.lookup);
    } catch (err) {
      results.push({
        identifier: candidate.openalex ?? "unknown",
        status: "failed",
        reason: `could not look up the DOI: ${err instanceof Error ? err.message : String(err)}`,
      });
      continue;
    }
    if (!identifier) {
      results.push({
        identifier: candidate.openalex ?? candidate.title ?? "unknown",
        status: "failed",
        reason: "OpenAlex lists no DOI for this work, so there is nothing to look it up by",
      });
      continue;
    }
    const dedupe = identifier.toLowerCase();
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    try {
      const added = await deps.addItem(by, {
        identifier,
        projects: input.projects,
        tags: input.tags,
        target: "inbox",
        why: why(input),
      });
      results.push({
        identifier,
        status: added.duplicateOf ? "duplicate" : "added",
        citekey: added.citekey,
        job: added.job,
      });
    } catch (err) {
      results.push({
        identifier,
        status: "failed",
        reason: err instanceof CitegeistError ? err.detail.message : String(err),
      });
    }
  }
  const count = (s: CandidateResult["status"]): number =>
    results.filter((r) => r.status === s).length;
  return {
    results,
    added: count("added"),
    duplicates: count("duplicate"),
    failed: count("failed"),
  };
}
