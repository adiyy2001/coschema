export function isOriginAllowed(
  origin: string | undefined,
  allowedOrigins: readonly string[],
): boolean {
  if (origin === undefined) return true;
  if (allowedOrigins.includes('*')) return true;
  if (!URL.canParse(origin)) return false;
  return allowedOrigins.includes(new URL(origin).origin);
}
