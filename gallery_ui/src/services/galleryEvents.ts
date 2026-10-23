export const GALLERY_EVENTS_CHANNEL = "universal-extractor-gallery-events";
export const GALLERY_OUTPUT_EVENT = "outputs-changed";
export interface GalleryOutputEvent {
  version: 1;
  type: typeof GALLERY_OUTPUT_EVENT;
  prompt_id: string;
  scopes?: string[];
  created_at?: number;
}

export const isGalleryOutputEvent = (value: unknown): value is GalleryOutputEvent => {
  if (!value || typeof value !== "object") return false;
  const event = value as Partial<GalleryOutputEvent>;
  return event.version === 1 && event.type === GALLERY_OUTPUT_EVENT &&
    typeof event.prompt_id === "string" && event.prompt_id.length > 0 && event.prompt_id.length <= 200 &&
    (event.scopes === undefined || Array.isArray(event.scopes) && event.scopes.length <= 32 && event.scopes.every((scope) => typeof scope === "string" && scope.length <= 2000));
};

/** A burst of save nodes is one refresh scope, not one job per saved folder. */
export const commonGalleryScope = (scopes: string[]): string => {
  if (!scopes.length || scopes.includes("")) return "";
  const parts = scopes.map((scope) => scope.includes("::") ? scope.split("::", 2) : ["default_output", scope]);
  const source = parts[0][0];
  if (parts.some(([id]) => id !== source)) return "";
  const common = parts[0][1].split("/").filter(Boolean);
  for (const [, folder] of parts.slice(1)) {
    const segments = folder.split("/").filter(Boolean);
    while (common.some((segment, index) => segment !== segments[index])) common.pop();
  }
  return `${source}::${common.join("/")}`;
};
