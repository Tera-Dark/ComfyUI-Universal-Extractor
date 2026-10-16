import { readStorageItem, writeStorageItem } from "./safeStorage";

let sessionVersions: string[] | null = null;
export const consumeReleaseNotice = (version: string) => {
  if (!version) return false;
  let seen = sessionVersions ?? [];
  try {
    const stored: unknown = JSON.parse(readStorageItem("universal-extractor:seen-releases") || "null");
    if (Array.isArray(stored)) seen = stored.filter((item): item is string => typeof item === "string").slice(-20);
  } catch { /* Session fallback also handles unavailable storage. */ }
  const upgraded = seen.length > 0 && !seen.includes(version);
  sessionVersions = [...seen.filter((item) => item !== version), version].slice(-20);
  writeStorageItem("universal-extractor:seen-releases", JSON.stringify(sessionVersions));
  return upgraded;
};
