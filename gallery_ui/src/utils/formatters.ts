export const PAGE_SIZE = 60;

export const formatFileSize = (size: number) => {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} KB`;
  return `${(size / (1024 * 1024)).toFixed(2)} MB`;
};

export const formatCompactDate = (timestampSeconds: number) =>
  new Date(timestampSeconds * 1000).toLocaleDateString();

export const formatLongDateTime = (timestampSeconds: number) =>
  new Date(timestampSeconds * 1000).toLocaleString();

export const formatTitleCase = (value: string) =>
  value
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
