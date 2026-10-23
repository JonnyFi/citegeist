function scalar(v: unknown): string {
  return typeof v === "string" ? v : JSON.stringify(v);
}

function isScalar(v: unknown): boolean {
  return v === null || typeof v !== "object";
}

/** Readable text for a result: `key: value` lines, nested values as indented JSON. */
export function formatHuman(value: unknown): string {
  if (isScalar(value)) return scalar(value);
  if (Array.isArray(value)) return JSON.stringify(value, null, 2);
  const lines: string[] = [];
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (v === undefined) continue;
    if (isScalar(v)) {
      lines.push(`${key}: ${scalar(v)}`);
    } else {
      const body = JSON.stringify(v, null, 2).split("\n").join("\n  ");
      lines.push(`${key}: ${body}`);
    }
  }
  return lines.join("\n");
}
