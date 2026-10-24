// The Zotero data model as both readers (zotero.sqlite and the local API) deliver it. The mapping
// to citegeist items works on this shape only.

export type LinkMode =
  | "imported_file"
  | "imported_url"
  | "linked_file"
  | "linked_url"
  | "embedded_image";

export type AnnotationType = "highlight" | "note" | "image" | "ink" | "underline" | "text";

export interface RawCreator {
  /** Zotero creator type such as "author" or "bookAuthor". */
  type: string;
  first?: string;
  last?: string;
  /** Single-field name (institutions). */
  name?: string;
}

export interface RawAttachment {
  linkMode: LinkMode;
  contentType?: string;
  /** Zotero path: `storage:name.pdf`, `attachments:rel/path.pdf` or absolute. */
  path?: string;
  filename?: string;
}

export interface RawAnnotation {
  type: AnnotationType;
  text: string;
  comment: string;
  color?: string;
  pageLabel?: string;
  sortIndex?: string;
  /** JSON string. */
  position: string;
  isExternal?: boolean;
}

export interface RawItem {
  key: string;
  itemType: string;
  dateAdded?: string;
  /** Field values by Zotero field name, type-specific names included. */
  fields: Record<string, string>;
  /** Parsed date from the API (`meta.parsedDate`), when there is one. */
  parsedDate?: string;
  creators: RawCreator[];
  tags: { name: string; auto: boolean }[];
  /** Keys of the collections the item sits in. */
  collections: string[];
  parentKey?: string;
  /** HTML of a note. */
  note?: string;
  attachment?: RawAttachment;
  annotation?: RawAnnotation;
}

export interface RawCollection {
  key: string;
  name: string;
  parentKey?: string;
}

export interface RawLibrary {
  label: string;
  items: RawItem[];
  collections: RawCollection[];
  /**
   * Finds the file of an attachment. Returns an absolute path, or undefined with a reason. The
   * API reader downloads on demand, so a preview passes `fetch: false` and gets a placeholder.
   */
  resolveFile(
    item: RawItem,
    opts: { fetch: boolean; linkedFilesBase?: string | undefined },
  ): Promise<{ path?: string; missing?: string }>;
  /** True when `resolveFile` can tell without downloading. */
  canCheckFiles: boolean;
  dispose?: () => void | Promise<void>;
}
