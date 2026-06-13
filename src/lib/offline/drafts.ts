const VERSION = 1;
const MAX_AGE = 7 * 86400_000;

export function encodeDraft<T extends Record<string, unknown>>(value: T, now = new Date()) {
  return JSON.stringify({ version: VERSION, savedAt: now.toISOString(), value });
}

export function decodeDraft<T>(encoded: string | null, now = new Date()): T | null {
  if (!encoded) return null;
  try {
    const parsed = JSON.parse(encoded);
    if (parsed.version !== VERSION || now.getTime() - new Date(parsed.savedAt).getTime() > MAX_AGE) return null;
    return parsed.value as T;
  } catch { return null; }
}
