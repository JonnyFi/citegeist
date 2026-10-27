import type { ItemFrontmatter } from "@citegeist/schema";

type Items = Map<string, { frontmatter: ItemFrontmatter }>;

/** An error shaped like the one the real core sends: the agent-ready detail travels as `data`. */
export function mockDetailError(detail: {
  code: string;
  message: string;
  context?: Record<string, unknown>;
}): Error {
  return Object.assign(new Error(`${detail.code}: ${detail.message}`), {
    data: { ...detail, fix: "", recovery: "ask-human" },
  });
}

/** The item that already has this DOI, apart from `citekey`. */
export function mockTwinOf(items: Items, citekey: string, doi: string): string | undefined {
  const wanted = doi.toLowerCase();
  for (const { frontmatter: fm } of items.values()) {
    if (fm.citekey !== citekey && fm.DOI?.toLowerCase() === wanted) return fm.citekey;
  }
  return undefined;
}

/**
 * The offer the core makes when a DOI belongs to an item on the other side of the inbox boundary:
 * IDENTIFIER_IN_INBOX with the two items for items.merge. Undefined when there is no such twin.
 */
export function mockMergeOffer(items: Items, citekey: string, doi: string): Error | undefined {
  const twin = mockTwinOf(items, citekey, doi);
  const mine = items.get(citekey)?.frontmatter;
  const theirs = items.get(twin ?? "")?.frontmatter;
  if (!twin || !mine || !theirs) return undefined;
  if ((mine.inbox !== undefined) === (theirs.inbox !== undefined)) return undefined;
  const [from, into] = mine.inbox ? [citekey, twin] : [twin, citekey];
  return mockDetailError({
    code: "IDENTIFIER_IN_INBOX",
    message: mine.inbox
      ? `${doi} already belongs to ${twin} in the library; ${citekey} is the same work and waits in the inbox`
      : `${doi} already belongs to ${twin} in the inbox; it is the same work as ${citekey}`,
    context: { citekey, duplicateOf: twin, inboxItem: from, merge: { from, into } },
  });
}
