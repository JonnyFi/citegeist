import type { ItemDraft } from "@citegeist/cite";
import type { ImportOptions, ImportProblem } from "@citegeist/ops";
import type { ItemFrontmatter } from "@citegeist/schema";

export type { ImportOptions, ImportProblem };

/** An annotation on a PDF, as Zotero stores it, reduced to what a card needs. */
export interface SourceAnnotation {
  ref: string;
  type: "highlight" | "underline" | "note" | "image" | "ink" | "text";
  /** The highlighted text, verbatim. */
  text: string;
  comment: string;
  color?: string;
  /** The printed page label. */
  pageLabel?: string;
  sortIndex?: string;
  /** Zotero position JSON, unparsed. */
  position: string;
  tags: string[];
}

export interface SourceAttachment {
  ref: string;
  filename: string;
  contentType?: string;
  linkMode: "imported_file" | "imported_url" | "linked_file" | "linked_url" | "embedded_image";
  /** URL of a linked or snapshot attachment. */
  url?: string;
  /** Absolute path of the file, when it was found. */
  path?: string;
  /** Why there is no file. */
  missing?: string;
  /** Fetches the file when only a run needs it (the Zotero API source). */
  resolve?: () => Promise<{ path?: string; missing?: string }>;
  annotations: SourceAnnotation[];
}

export interface SourceNote {
  ref: string;
  title?: string;
  markdown: string;
}

/** One bibliographic entry of a source, mapped to a draft but not yet matched against the library. */
export interface SourceItem {
  /** Zotero key or the position in a file. */
  ref: string;
  draft: ItemDraft;
  /** Zotero collection paths such as "Thesis/Chapter 2". */
  collections: string[];
  notes: SourceNote[];
  attachments: SourceAttachment[];
  /** ISO time the entry was added in the source system. */
  dateAdded?: string;
}

/** Everything a source holds, in the shape the planner works on. */
export interface SourceBundle {
  /** Short label for the report, such as "Zotero (zotero.sqlite)". */
  label: string;
  /** Provenance tag: "zotero", "bibtex", "ris" or "csl-json". */
  tag: string;
  items: SourceItem[];
  /** Notes without a parent item. */
  standaloneNotes: SourceNote[];
  /** Collection paths that exist in the source. */
  collections: string[];
  problems: ImportProblem[];
  /** Attachments found and available on disk; false when the source cannot tell before a run. */
  filesChecked: boolean;
  /** Releases temporary files. */
  dispose?: () => void | Promise<void>;
}

/** The index data the importer needs about an item that is already in the library. */
export interface ExistingItem {
  citekey: string;
  title: string;
  year?: string | undefined;
  firstAuthor?: string | undefined;
  doi?: string | undefined;
  isbn?: string | undefined;
  ids: Record<string, string>;
}

/** What the importer needs from the core. `createLibraryHost` builds one from a Library. */
export interface ImportHost {
  /** Every item in the library, including the inbox. */
  existingItems(): ExistingItem[];
  /** Citekeys that are taken, including folders the index does not know. */
  existingCitekeys(): Set<string>;
  /** The citekey formula of the library manifest. */
  citekeyFormula(): string | undefined;
  readItem(citekey: string): { frontmatter: ItemFrontmatter; body: string };
  /** Writes (or overwrites) an item file and throws when the library does not accept it. */
  writeItem(frontmatter: ItemFrontmatter, body?: string): void;
}

export interface ImportContext {
  now?: () => Date;
}
