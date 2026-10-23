import type { Creator } from "@citegeist/schema";

export function creatorName(c: Creator): string {
  if ("literal" in c) return c.literal;
  return c.given ? `${c.family}, ${c.given}` : c.family;
}

const TYPE_LABELS: Record<string, string> = {
  book: "Book",
  chapter: "Chapter",
  article: "Article",
  "article-journal": "Journal article",
  "article-magazine": "Magazine article",
  "article-newspaper": "Newspaper article",
  "paper-conference": "Conference paper",
  report: "Report",
  thesis: "Thesis",
  webpage: "Web page",
  dataset: "Dataset",
};

export function typeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type.replace(/-/g, " ");
}

export const STATUS_LABELS = { unread: "Unread", reading: "Reading", read: "Read" } as const;

export function statusLabel(status: string): string {
  return STATUS_LABELS[status as keyof typeof STATUS_LABELS] ?? status;
}
