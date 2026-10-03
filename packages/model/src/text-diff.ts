export interface TextEdit {
  readonly index: number;
  readonly deleteCount: number;
  readonly insert: string;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

function commonPrefixLength(before: string, after: string): number {
  const limit = Math.min(before.length, after.length);
  let length = 0;
  while (length < limit && before.charCodeAt(length) === after.charCodeAt(length)) length += 1;
  if (length > 0 && isHighSurrogate(before.charCodeAt(length - 1))) length -= 1;
  return length;
}

function commonSuffixLength(before: string, after: string, prefix: number): number {
  const limit = Math.min(before.length, after.length) - prefix;
  let length = 0;
  while (
    length < limit &&
    before.charCodeAt(before.length - 1 - length) === after.charCodeAt(after.length - 1 - length)
  ) {
    length += 1;
  }
  if (length > 0 && isLowSurrogate(before.charCodeAt(before.length - length))) length -= 1;
  return length;
}

export function diffText(before: string, after: string): TextEdit | undefined {
  if (before === after) return undefined;
  const prefix = commonPrefixLength(before, after);
  const suffix = commonSuffixLength(before, after, prefix);
  return {
    index: prefix,
    deleteCount: before.length - prefix - suffix,
    insert: after.slice(prefix, after.length - suffix),
  };
}
