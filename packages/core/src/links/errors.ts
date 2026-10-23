import { CitegeistError } from "@citegeist/schema";

function make(
  code: string,
  message: string,
  fix: string,
  context: Record<string, unknown> = {},
): CitegeistError {
  return new CitegeistError({
    code,
    message,
    fix,
    recovery: "fix-and-retry",
    sideEffects: "none",
    context,
  });
}

export const linkErrors = {
  badIndex: (note: string, index: number, count: number) =>
    make(
      "LINK_INDEX_INVALID",
      `note '${note}' has no link at index ${index} (it has ${count})`,
      "Read the note with notes.get and pass indexes into frontmatter.links, counting from 0.",
      { note, index, count },
    ),
  notProposed: (note: string, index: number) =>
    make(
      "LINK_NOT_PROPOSED",
      `link ${index} of note '${note}' is already accepted and cannot be decided again`,
      "Only links with status proposed can be accepted or rejected.",
      { note, index },
    ),
  conflict: (note: string, index: number) =>
    make(
      "LINK_DECISION_CONFLICT",
      `link ${index} of note '${note}' is both in accept and in reject`,
      "Put every index into one list only.",
      { note, index },
    ),
};
