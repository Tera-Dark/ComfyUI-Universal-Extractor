import { describe, expect, it } from "vitest";

import { getActiveFilterControlCount, getColorFamilyShortLabel, getStoredViewMode } from "./galleryWorkspaceModel";

describe("galleryWorkspaceModel", () => {
  it("reads only supported gallery view modes from localStorage", () => {
    window.localStorage.setItem("view", "list");
    expect(getStoredViewMode("view", "grid")).toBe("list");

    window.localStorage.setItem("view", "table");
    expect(getStoredViewMode("view", "grid")).toBe("grid");
  });

  it("counts active filters and non-default sorting controls", () => {
    expect(
      getActiveFilterControlCount({
        selectedCategory: "",
        dateFrom: "",
        dateTo: "",
        favoritesOnly: false,
        selectedColorFamily: "",
        sortBy: "created_at",
        sortOrder: "desc",
      }),
    ).toBe(0);

    expect(
      getActiveFilterControlCount({
        selectedCategory: "portrait",
        dateFrom: "2026-05-01",
        dateTo: "",
        favoritesOnly: true,
        selectedColorFamily: "blue",
        sortBy: "filename",
        sortOrder: "asc",
      }),
    ).toBe(5);
  });

  it("keeps compact color labels readable", () => {
    expect(getColorFamilyShortLabel("red", "红色")).toBe("红");
    expect(getColorFamilyShortLabel("low_saturation", "Low saturation")).toBe("Low");
    expect(getColorFamilyShortLabel("blue", "Blue")).toBe("Blue");
  });
});
