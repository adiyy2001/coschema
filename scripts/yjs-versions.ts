export function yjsVersionsIn(storeEntries: readonly string[]): string[] {
  const versions = new Set<string>();
  for (const entry of storeEntries) {
    const match = /^yjs@([^_]+)/u.exec(entry);
    if (match?.[1] !== undefined) versions.add(match[1]);
  }
  return [...versions].sort();
}
