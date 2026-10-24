/**
 * What an unattended research job may send out (W5.1, finding L9 in docs/security.md).
 *
 * A research job reads untrusted web pages and has access to the library. By the Agents Rule of
 * Two (Meta, "Practical AI agent security") it must then not also be able to act outward on its
 * own: a page that steers the agent could otherwise put library content into an address and make
 * the core or the agent call it. The job therefore keeps two things: the fixed web search of the
 * agent, and requests to addresses that the model cannot compose, which are
 * - hosts of the scholarly infrastructure listed here (a DOI resolver, a preprint server, an
 *   index), which the attacker does not operate, and
 * - addresses that an earlier web search returned verbatim.
 * The core enforces the first rule for `add_item` on every research token; the permission policy
 * of the chat enforces both for the agent's own web fetch.
 */

/**
 * Hosts a research job may fetch with any path and query. Only infrastructure that holds papers
 * and metadata, whose request logs an attacker cannot read. A request to one of them may carry
 * library content in its path, but the attacker never sees it.
 */
export const SCHOLARLY_HOSTS: readonly string[] = [
  "doi.org",
  "dx.doi.org",
  "arxiv.org",
  "export.arxiv.org",
  "api.crossref.org",
  "api.openalex.org",
  "openalex.org",
  "api.semanticscholar.org",
  "www.semanticscholar.org",
  "pubmed.ncbi.nlm.nih.gov",
  "eutils.ncbi.nlm.nih.gov",
  "www.ncbi.nlm.nih.gov",
  "pmc.ncbi.nlm.nih.gov",
  "europepmc.org",
  "www.biorxiv.org",
  "www.medrxiv.org",
  "api.unpaywall.org",
  "core.ac.uk",
  "api.core.ac.uk",
  "dblp.org",
  "aclanthology.org",
  "openreview.net",
  "osf.io",
  "zenodo.org",
];

/** Tools of the citegeist MCP server that change something and that a research job may call. */
export const RESEARCH_WRITE_TOOLS: readonly string[] = ["add_item"];

/** True when the address is https on a scholarly host (or a subdomain-free exact match). */
export function isScholarlyUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  if (parsed.username !== "" || parsed.password !== "") return false;
  if (parsed.port !== "" && parsed.port !== "443") return false;
  return SCHOLARLY_HOSTS.includes(parsed.hostname.toLowerCase());
}

/** Address in the form in which two mentions of the same page compare equal. */
export function normalizeUrl(url: string): string | undefined {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return undefined;
    u.hash = "";
    const out = u.toString();
    return out.endsWith("/") && u.pathname === "/" ? out : out.replace(/\/$/, "");
  } catch {
    return undefined;
  }
}

/** The http(s) addresses in a text, as they stand there, without trailing punctuation. */
export function urlsIn(text: string): string[] {
  const found = text.match(/https?:\/\/[^\s<>"'`)\]}]+/gi) ?? [];
  return found.map((u) => u.replace(/[.,;:!?]+$/, ""));
}
