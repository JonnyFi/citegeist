const DROP = "script,style,iframe,object,embed,link,meta,base,form,input,button,textarea,select";

/**
 * Remove active content from `doc.html` before it is rendered: scripts, frames, forms, event
 * handler attributes and `javascript:` URLs. Parsing happens in an inert `<template>`.
 */
export function sanitizeHtml(html: string): string {
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  for (const el of tpl.content.querySelectorAll(DROP)) el.remove();
  for (const el of tpl.content.querySelectorAll("*")) {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim().toLowerCase();
      if (
        name.startsWith("on") ||
        name === "srcdoc" ||
        ((name === "href" || name === "src" || name === "xlink:href") &&
          /^(javascript|data:text\/html|vbscript):/.test(value.replace(/\s+/g, "")))
      ) {
        el.removeAttribute(attr.name);
      }
    }
  }
  return tpl.innerHTML;
}
