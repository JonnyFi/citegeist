/**
 * Elements that never survive. Compared with the lower-cased local name, because SVG elements such
 * as `foreignObject` and `animateMotion` keep their camel case in the DOM and a CSS selector would
 * miss them. MathML stays: converted papers use it for formulas.
 */
const DROP = new Set([
  "script",
  "style",
  "iframe",
  "frame",
  "frameset",
  "object",
  "embed",
  "applet",
  "portal",
  "link",
  "meta",
  "base",
  "form",
  "input",
  "button",
  "textarea",
  "select",
  "template",
  "noscript",
  "noembed",
  "noframes",
  "xmp",
  "plaintext",
  // SVG elements that run script or rewrite an attribute (`<animate attributeName="href" ...>`),
  // pull in other documents or host HTML
  "animate",
  "animatemotion",
  "animatetransform",
  "set",
  "discard",
  "use",
  "foreignobject",
  "handler",
  "listener",
  // MathML element that switches to an HTML or SVG parse of its content (mutation XSS)
  "annotation-xml",
]);

/** Attributes whose value is a URL or a list of URLs. */
const URL_ATTRS = new Set([
  "href",
  "src",
  "xlink:href",
  "action",
  "formaction",
  "poster",
  "data",
  "background",
  "cite",
  "longdesc",
  "ping",
  "manifest",
  "srcset",
  "imagesrcset",
]);

/** Schemes a link or image in a converted document may use. */
const SAFE_SCHEME = /^(https?|mailto|tel):/i;
/** A raster image in a data: URL is inert; SVG and HTML are not. */
const SAFE_DATA_IMAGE = /^data:image\/(png|jpe?g|gif|webp|avif);/i;

function safeUrl(raw: string): boolean {
  // Browsers ignore whitespace and control characters inside a scheme (`java\tscript:`).
  // biome-ignore lint/suspicious/noControlCharactersInRegex: that is exactly what is removed
  const value = raw.replace(/[\u0000- \u007f-\u009f]+/g, "");
  if (value === "") return true;
  if (SAFE_SCHEME.test(value) || SAFE_DATA_IMAGE.test(value)) return true;
  // No scheme at all: a fragment, a path or a relative URL.
  return !/^[a-z][a-z0-9+.-]*:/i.test(value);
}

function safeSrcset(raw: string): boolean {
  return raw.split(",").every((candidate) => safeUrl(candidate.trim().split(/\s+/)[0] ?? ""));
}

/**
 * Remove active content from `doc.html` before it is rendered. The HTML comes from converted web
 * pages and papers, so it is attacker-controlled, and the renderer holds the token of the core.
 * Parsing happens in an inert `<template>`. Elements are dropped by deny list, URLs by allow list:
 * only http(s), mailto, tel, raster data images and scheme-less (relative) values survive, and no
 * event handler attribute does.
 */
export function sanitizeHtml(html: string): string {
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  for (const el of [...tpl.content.querySelectorAll("*")]) {
    if (DROP.has(el.localName.toLowerCase())) el.remove();
  }
  for (const el of tpl.content.querySelectorAll("*")) {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      const drop =
        name.startsWith("on") ||
        name === "srcdoc" ||
        name === "attributename" ||
        (URL_ATTRS.has(name) &&
          !(name === "srcset" || name === "imagesrcset"
            ? safeSrcset(attr.value)
            : safeUrl(attr.value)));
      if (drop) el.removeAttribute(attr.name);
    }
  }
  return tpl.innerHTML;
}
