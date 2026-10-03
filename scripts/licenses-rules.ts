const ALLOWED = new Set([
  'MIT',
  'MIT-0',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  '0BSD',
  'BlueOak-1.0.0',
  'Python-2.0',
  'CC0-1.0',
]);

const DEV_TOOL_EXCEPTIONS: readonly { namePattern: RegExp; license: string }[] = [
  { namePattern: /^lightningcss(-[a-z0-9-]+)?$/u, license: 'MPL-2.0' },
  { namePattern: /^caniuse-lite$/u, license: 'CC-BY-4.0' },
];

export interface PackageInfo {
  name: string;
  version: string;
  license: string;
}

export function licenseIsAllowed(expression: string): boolean {
  const cleaned = expression.replace(/[()]/gu, ' ').trim();
  return cleaned
    .split(/\s+OR\s+/u)
    .some((alternative) =>
      alternative.split(/\s+AND\s+/u).every((identifier) => ALLOWED.has(identifier.trim())),
    );
}

export function isExcepted(name: string, license: string): boolean {
  return DEV_TOOL_EXCEPTIONS.some(
    (exception) => exception.namePattern.test(name) && exception.license === license,
  );
}
