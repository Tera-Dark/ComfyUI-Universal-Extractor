/** Best-effort browser preferences; blocked localStorage must not break browsing. */

export const readStorageItem = (key: string): string | null => {
  try {
    return typeof window === "undefined" ? null : window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

export const writeStorageItem = (key: string, value: string): boolean => {
  try {
    if (typeof window === "undefined") return false;
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
};
