export const PAGE_SIZE = 48;

export const formatFileSize = (size: number) => {
  const safeSize = Number.isFinite(size) ? Math.max(0, size) : 0;
  if (safeSize < 1024) return `${safeSize} B`;
  if (safeSize < 1024 * 1024) return `${(safeSize / 1024).toFixed(0)} KB`;
  return `${(safeSize / (1024 * 1024)).toFixed(2)} MB`;
};

const toValidDate = (timestampSeconds: number) => {
  if (!Number.isFinite(timestampSeconds) || timestampSeconds <= 0) {
    return null;
  }
  const date = new Date(timestampSeconds * 1000);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const formatCompactDate = (timestampSeconds: number) =>
  toValidDate(timestampSeconds)?.toLocaleDateString() ?? "--";

export const formatPreciseDateTime = (timestampSeconds: number) => {
  const date = toValidDate(timestampSeconds);
  if (!date) {
    return "--";
  }
  const pad = (value: number) => String(value).padStart(2, "0");

  return [
    `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())}`,
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`,
  ].join(" ");
};

export const formatLongDateTime = (timestampSeconds: number) =>
  toValidDate(timestampSeconds)?.toLocaleString() ?? "--";

export const formatTitleCase = (value: string) =>
  value
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
