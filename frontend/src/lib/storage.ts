// localStorage can be missing, full, or throw (private windows, blocked site data),
// so every access is wrapped and callers get a plain fallback instead of an exception.

export function readString(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Returns false when the browser refused to store it. */
export function writeString(key: string, value: string): boolean {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function readJson(key: string): unknown {
  const raw = readString(key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function writeJson(key: string, value: unknown): boolean {
  return writeString(key, JSON.stringify(value));
}
