/** The text open in the editor of the main window, as the main window renderer publishes it. */
export interface EditorState {
  project: string;
  text: string;
  /** BCP 47 language of the text: the terms of Pandoc locators. */
  lang?: string | undefined;
}

/**
 * Where the palette puts a citation: `text` is the open text of citegeist itself (Pandoc syntax,
 * through the main window), `external` is any other app (formatted text on the clipboard, then Cmd+V).
 */
export type PaletteTarget =
  | { type: "text"; project: string; text: string; lang?: string | undefined }
  | { type: "external" };

export const EXTERNAL_TARGET: PaletteTarget = { type: "external" };

export interface TargetInput {
  /** Bundle id of the app that had focus when the hotkey was pressed. */
  frontBundleId: string | undefined;
  /** Bundle id of citegeist itself. */
  ownBundleId: string | undefined;
  /** The main window exists, is visible and has keyboard focus. */
  mainWindowFocused: boolean;
  /** What the main window published, or null when no text is open. */
  editor: EditorState | null;
}

/** An editor state without project or text name cannot address a text: treat it as not open. */
function usable(editor: EditorState | null): editor is EditorState {
  return Boolean(editor && editor.project.length > 0 && editor.text.length > 0);
}

/**
 * The citation goes into the editor only when all of this holds at the moment of the hotkey:
 * citegeist is the app in front, its main window has focus, and a text is open there. Otherwise a
 * Pandoc snippet would land in the wrong place, so the palette pastes formatted text as usual.
 *
 * On a platform that cannot tell the front app (neither id is known), the window focus decides.
 */
export function decideTarget(input: TargetInput): PaletteTarget {
  const { frontBundleId, ownBundleId, mainWindowFocused, editor } = input;
  const ownIsFront =
    ownBundleId === undefined ? frontBundleId === undefined : frontBundleId === ownBundleId;
  if (!ownIsFront || !mainWindowFocused || !usable(editor)) return EXTERNAL_TARGET;
  return {
    type: "text",
    project: editor.project,
    text: editor.text,
    ...(editor.lang ? { lang: editor.lang } : {}),
  };
}

const MAX_NAME = 500;

/** Reads what the main window renderer sent. Anything that is not a well-formed state counts as "no text open". */
export function parseEditorState(value: unknown): EditorState | null {
  if (typeof value !== "object" || value === null) return null;
  const { project, text, lang } = value as Record<string, unknown>;
  if (typeof project !== "string" || typeof text !== "string") return null;
  if (project.length === 0 || text.length === 0) return null;
  if (project.length > MAX_NAME || text.length > MAX_NAME) return null;
  const language =
    typeof lang === "string" && lang.length > 0 && lang.length <= 35 ? lang : undefined;
  return { project, text, ...(language ? { lang: language } : {}) };
}
