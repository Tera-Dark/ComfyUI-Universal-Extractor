import type { GalleryContext, ImageRecord } from "../types/universal-gallery";

const sameValue = (one: unknown, two: unknown) => Object.is(one, two) ||
  Array.isArray(one) && Array.isArray(two) && one.length === two.length && one.every((value, index) => Object.is(value, two[index]));

/** Reuse card objects and the page array when a refresh returned the same
 * snapshot. Request completion is not itself a reason to rebuild the grid. */
export const reconcileImageRecords = (current: ImageRecord[], next: ImageRecord[]) => {
  const previous = new Map(current.map((image) => [image.asset_id || image.relative_path, image]));
  const merged = next.map((image) => {
    const before = previous.get(image.asset_id || image.relative_path);
    return before && Object.keys(before).length === Object.keys(image).length &&
      Object.entries(image).every(([key, value]) => sameValue(before[key as keyof ImageRecord], value)) ? before : image;
  });
  return merged.length === current.length && merged.every((image, index) => image === current[index]) ? current : merged;
};

export const sameImageContent = (current: ImageRecord[], next: ImageRecord[]) => current.length === next.length &&
  current.every((image, index) => (["relative_path", "filename", "asset_id", "content_revision", "created_at", "size"] as const)
    .every((key) => image[key] === next[index][key]));

const sameContextValue = (one: unknown, two: unknown): boolean => {
  if (Object.is(one, two)) return true;
  if (!one || !two || typeof one !== "object" || typeof two !== "object" || Array.isArray(one) !== Array.isArray(two)) return false;
  const left = one as Record<string, unknown>, right = two as Record<string, unknown>;
  return Object.keys(left).length === Object.keys(right).length && Object.entries(right)
    .every(([key, value]) => Object.hasOwn(left, key) && sameContextValue(left[key], value));
};

/** A new source count must not invalidate unchanged folder trees and move
 * targets. Context is a bounded JSON API snapshot, with no opaque objects. */
export const reconcileGalleryContext = (current: GalleryContext | null, next: GalleryContext): GalleryContext => {
  if (!current) return next;
  const entries = Object.entries(next).map(([key, value]) => {
    const before = current[key as keyof GalleryContext];
    return [key, sameContextValue(before, value) ? before : value];
  });
  return Object.keys(current).length === entries.length && entries.every(([key, value]) => current[key as keyof GalleryContext] === value)
    ? current : Object.fromEntries(entries) as GalleryContext;
};
