import { useEffect, useRef } from "react";
import { createNoteEditor, type NoteEditor } from "./editor";
import type { CitationProvider, EditorLabels, OpenLinkEvent, WikiLinkProvider } from "./types";

export interface NoteEditorProps {
  value: string;
  /** Called with the full text after each edit. */
  onChange?: (value: string) => void;
  provider?: WikiLinkProvider;
  /** Pandoc citations: completion after `@` and marks for unknown citekeys. */
  citations?: CitationProvider;
  labels?: Partial<EditorLabels>;
  onOpenLink?: (event: OpenLinkEvent) => void;
  readOnly?: boolean;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
  /** Gives access to the editor, for focus and for flushing pending edits. */
  editorRef?: { current: NoteEditor | null };
}

/**
 * Live-preview Markdown editor. The text lives in the editor; `value` is applied whenever it
 * differs from what the editor holds, so a host that stores `onChange` values and passes them back
 * does not disturb the cursor.
 */
export function NoteEditorView(props: NoteEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<NoteEditor | null>(null);
  const latest = useRef(props);
  latest.current = props;

  useEffect(() => {
    if (!host.current) return;
    const p = latest.current;
    const instance = createNoteEditor({
      parent: host.current,
      value: p.value,
      ...(p.provider ? { provider: p.provider } : {}),
      ...(p.citations ? { citations: p.citations } : {}),
      ...(p.labels ? { labels: p.labels } : {}),
      ...(p.readOnly ? { readOnly: true } : {}),
      ...(p.placeholder ? { placeholder: p.placeholder } : {}),
      ...(p.ariaLabel ? { ariaLabel: p.ariaLabel } : {}),
      onChange: (v) => latest.current.onChange?.(v),
      onOpenLink: (e) => latest.current.onOpenLink?.(e),
    });
    editor.current = instance;
    if (p.editorRef) p.editorRef.current = instance;
    return () => {
      instance.destroy();
      editor.current = null;
      if (p.editorRef) p.editorRef.current = null;
    };
  }, []);

  useEffect(() => {
    editor.current?.setValue(props.value);
  }, [props.value]);

  useEffect(() => {
    editor.current?.configure({
      provider: props.provider,
      citations: props.citations,
      labels: props.labels ?? {},
    });
  }, [props.provider, props.citations, props.labels]);

  return <div ref={host} className={props.className} data-testid="note-editor" />;
}
