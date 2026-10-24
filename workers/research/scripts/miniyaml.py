"""Minimal YAML subset parser (stdlib only).

Supports what Research Pipeline's config files use:
  - nested mappings by indentation (`key: value`, `key:` + indented block)
  - block lists of scalars (`- item`)
  - flow lists (`[a, b, "c, d"]`)
  - scalars: int, float, true/false, null/~, quoted or plain strings
  - comments (`# ...`) on their own line or after a value
"""

import re


def _strip_comment(line):
    out, quote = [], None
    for i, ch in enumerate(line):
        if quote:
            if ch == quote:
                quote = None
        elif ch in "\"'":
            quote = ch
        elif ch == "#" and (i == 0 or line[i - 1].isspace()):
            break
        out.append(ch)
    return "".join(out).rstrip()


def _scalar(text):
    t = text.strip()
    if t == "":
        return None
    if (t[0] == t[-1]) and t[0] in "\"'" and len(t) >= 2:
        return t[1:-1]
    low = t.lower()
    if low in ("null", "~", "none"):
        return None
    if low in ("true", "yes"):
        return True
    if low in ("false", "no"):
        return False
    if re.fullmatch(r"[-+]?\d+", t):
        return int(t)
    if re.fullmatch(r"[-+]?\d*\.\d+", t):
        return float(t)
    if t.startswith("[") and t.endswith("]"):
        return _flow_list(t[1:-1])
    return t


def _flow_list(inner):
    items, buf, quote = [], [], None
    for ch in inner:
        if quote:
            buf.append(ch)
            if ch == quote:
                quote = None
        elif ch in "\"'":
            quote = ch
            buf.append(ch)
        elif ch == ",":
            items.append("".join(buf))
            buf = []
        else:
            buf.append(ch)
    if "".join(buf).strip():
        items.append("".join(buf))
    return [_scalar(i) for i in items if i.strip()]


def _split_key(content):
    """Split 'key: value' at the first colon outside quotes."""
    quote = None
    for i, ch in enumerate(content):
        if quote:
            if ch == quote:
                quote = None
        elif ch in "\"'":
            quote = ch
        elif ch == ":" and (i + 1 == len(content) or content[i + 1] == " "):
            return _scalar(content[:i]), content[i + 1:].strip()
    raise ValueError(f"expected 'key: value', got: {content!r}")


def loads(text):
    lines = []
    for raw in text.splitlines():
        line = _strip_comment(raw)
        if line.strip():
            lines.append((len(line) - len(line.lstrip(" ")), line.strip()))
    if not lines:
        return None
    value, _ = _parse_block(lines, 0, lines[0][0])
    return value


def _parse_block(lines, i, indent):
    if lines[i][1].startswith("- ") or lines[i][1] == "-":
        result = []
        while i < len(lines) and lines[i][0] == indent and lines[i][1].startswith("-"):
            result.append(_scalar(lines[i][1][1:]))
            i += 1
        return result, i
    result = {}
    while i < len(lines) and lines[i][0] == indent:
        key, rest = _split_key(lines[i][1])
        i += 1
        if rest == "":
            if i < len(lines) and lines[i][0] > indent:
                result[key], i = _parse_block(lines, i, lines[i][0])
            elif i < len(lines) and lines[i][0] == indent and lines[i][1].startswith("-"):
                result[key], i = _parse_block(lines, i, indent)
            else:
                result[key] = None
        else:
            result[key] = _scalar(rest)
    return result, i


def load(path):
    with open(path, encoding="utf-8") as f:
        return loads(f.read())
