const DEFAULT_AUTH_REDIRECT = "/";

export function safeNextPath(
  value: string | null | undefined,
  fallback = DEFAULT_AUTH_REDIRECT,
): string {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\")
  ) {
    return fallback;
  }

  return value;
}
