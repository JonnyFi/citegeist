import { useEffect } from "react";
import type { CitegeistBridge } from "../bridge";
import { useCore } from "../lib/hooks";
import { insertIntoText, useOpenText } from "./active";

/**
 * Connects the texts editor with the quick-insert palette, which is a window of its own. It
 * publishes the open text to the main process (so the palette knows whether a citation can go
 * into the editor) and hands the Pandoc snippets the palette sends to the editor. Renders nothing.
 */
export function QuickInsertLink({ bridge }: { bridge: CitegeistBridge | undefined }) {
  const core = useCore();
  const open = useOpenText();
  const link = bridge?.textLink;
  const project = open?.project;
  const text = open?.text;
  const lang = open?.lang;

  useEffect(() => {
    if (!link) return;
    link.publish(project && text ? { project, text, ...(lang ? { lang } : {}) } : null);
    return () => link.publish(null);
  }, [link, project, text, lang]);

  useEffect(
    () =>
      link?.onInsert((snippet) => {
        insertIntoText(core, snippet).catch((err) => {
          console.error("quick insert: the snippet could not be inserted", err);
        });
      }),
    [link, core],
  );

  return null;
}
