/**
 * The address as a link target, or undefined when it is not a plain web address. Metadata comes
 * from resolvers, imports and agents, so a `javascript:` or `file:` address must stay text.
 */
export function webUrl(value: string | undefined | null): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}
