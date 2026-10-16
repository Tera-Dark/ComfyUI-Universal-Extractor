export const GALLERY_EVENTS_CHANNEL = "universal-extractor-gallery-events";
export const GALLERY_OUTPUT_EVENT = "outputs-changed";
export interface GalleryOutputEvent {
  version: 1;
  type: typeof GALLERY_OUTPUT_EVENT;
  prompt_id: string;
}

export const isGalleryOutputEvent = (value: unknown): value is GalleryOutputEvent => {
  if (!value || typeof value !== "object") return false;
  const event = value as Partial<GalleryOutputEvent>;
  return event.version === 1 && event.type === GALLERY_OUTPUT_EVENT &&
    typeof event.prompt_id === "string" && event.prompt_id.length > 0 && event.prompt_id.length <= 200;
};
