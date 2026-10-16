import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n/I18nProvider";
import type { ImageRecord } from "../../types/universal-gallery";
import { GalleryCardImage } from "./GalleryCardImage";
import { getGalleryImageUrl, isGalleryImageLoaded, prefetchGalleryImage } from "./galleryImagePrefetch";

const image: ImageRecord = {
  relative_path: "example.png", filename: "example.png", subfolder: "", asset_id: "test-image", content_revision: 1,
  url: "/original", thumb_url: "/thumb", original_url: "/original", size: 42, created_at: 1,
  favorite: false, pinned: false, boards: [], category: "", title: "", notes: "",
};
const renderImage = (record = image) => <I18nProvider><GalleryCardImage image={record} onOpenDetail={vi.fn()} /></I18nProvider>;
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("stable card image loading", () => {
  it("only marks a prefetched image ready after decode, without cancelling the successful source", async () => {
    let decoded!: () => void;
    const instances: PreparedImage[] = [];
    class PreparedImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      src = "";
      decoding = "";
      decode = () => new Promise<void>((resolve) => { decoded = resolve; });
      constructor() { instances.push(this); }
    }
    vi.stubGlobal("Image", PreparedImage);
    const prefetched = { ...image, thumb_url: "/decode-before-ready" };
    prefetchGalleryImage(prefetched);
    const current = instances[0];
    current.onload?.();
    expect(isGalleryImageLoaded(getGalleryImageUrl(prefetched))).toBe(false);
    decoded(); await Promise.resolve();
    expect(isGalleryImageLoaded(getGalleryImageUrl(prefetched))).toBe(true);
    expect(current.src).toBe(getGalleryImageUrl(prefetched));
  });
  it("replaces a failed request immediately when content changes and resets retry state", () => {
    const { rerender } = render(renderImage());
    fireEvent.error(screen.getByRole("button", { name: "example.png" }));
    fireEvent.click(screen.getByRole("button", { name: "重试加载" }));
    const retried = screen.getByRole("button", { name: "example.png" });
    expect(retried).toHaveAttribute("src", expect.stringContaining("_retry=1"));
    fireEvent.error(retried);
    rerender(renderImage({ ...image, content_revision: 2 }));
    const next = screen.getByRole("button", { name: "example.png" });
    expect(next.tagName).toBe("IMG");
    expect(next).not.toHaveAttribute("src", expect.stringContaining("_retry="));
    expect(next).toHaveAttribute("src", getGalleryImageUrl({ ...image, content_revision: 2 }));
  });

  it("recognizes cached complete images without waiting for another load event", () => {
    vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(true);
    vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(480);
    const cached = { ...image, thumb_url: "/already-decoded" };
    const { container, unmount } = render(renderImage(cached));
    expect(container.querySelector(".ue-gallery-image-shell")).toHaveClass("is-loaded");
    expect(isGalleryImageLoaded(getGalleryImageUrl(cached))).toBe(true);
    unmount();
    const again = render(renderImage(cached));
    expect(again.container.querySelector(".ue-gallery-image-shell")).toHaveClass("is-loaded");
  });

  it("retains the actual image element during annotation and dimension updates", () => {
    const { rerender } = render(renderImage({ ...image, thumb_url: "/unchanged-content" }));
    const node = screen.getByRole("button", { name: "example.png" });
    fireEvent.load(node);
    rerender(renderImage({ ...image, thumb_url: "/unchanged-content", notes: "note", pinned: true, width: 600, height: 800 }));
    expect(screen.getByRole("button", { name: "example.png" })).toBe(node);
    expect(node.parentElement).toHaveClass("is-loaded");
  });

  it("does not let an obsolete load event mark replacement content ready", () => {
    const { rerender } = render(renderImage({ ...image, thumb_url: "/obsolete" }));
    const old = screen.getByRole("button", { name: "example.png" });
    const next = { ...image, thumb_url: "/replacement", content_revision: 7 };
    rerender(renderImage(next));
    fireEvent.load(old);
    expect(isGalleryImageLoaded(getGalleryImageUrl(next))).toBe(false);
    expect(screen.getByRole("button", { name: "example.png" }).parentElement).not.toHaveClass("is-loaded");
  });
});
