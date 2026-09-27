import { describe, expect, it } from "vitest";
import { buildWorkspaceUrl, isSearchOnlyLocationChange, readWorkspaceLocation } from "./workspaceLocation";

describe("workspace URLs", () => {
  it("round-trips a cross-source filtered page without losing unrelated host query or hash", () => {
    const state = readWorkspaceLocation("?tab=gallery&folder=custom_source%3A%3Atoday&category=portrait&q=%E5%85%89&page=2&sort=size&order=asc");
    const url = buildWorkspaceUrl("https://example.test/gallery/?host=preview#gallery", state);
    expect(url).toContain("host=preview");
    expect(url).toContain("folder=custom_source%3A%3Atoday");
    expect(url).toContain("page=2");
    expect(url).toContain("#gallery");
    expect(readWorkspaceLocation(new URL(url, "https://example.test").search)).toEqual(state);
  });

  it("defaults and bounds malformed page, sort, date and workspace values", () => {
    const state = readWorkspaceLocation("?tab=unknown&folder=default_input%3A%3A&page=-5&sort=bogus&order=wrong&from=yesterday");
    expect(state.tab).toBe("gallery");
    expect(state.gallery.folder).toBe("default_input::");
    expect(state.gallery.page).toBe(1);
    expect(state.gallery.sort).toBe("created_at");
    expect(state.gallery.order).toBe("desc");
    expect(state.gallery.dateFrom).toBe("");
  });

  it("resolves a board and library correctly and separates query typing from navigable scope", () => {
    const first = readWorkspaceLocation("?tab=library&library=artists.json&board=board1");
    expect(first.gallery.folder).toBe("");
    expect(buildWorkspaceUrl("https://example.test/gallery/", first)).toContain("library=artists.json");
    const typing = { ...first, gallery: { ...first.gallery, query: "soft" } };
    expect(isSearchOnlyLocationChange(first, typing)).toBe(true);
    expect(isSearchOnlyLocationChange(first, { ...first, gallery: { ...first.gallery, page: 3 } })).toBe(false);
  });
});
