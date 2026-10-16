export type InterfaceDensity = "standard" | "compact";
// CSS receives the same values on the workspace; virtual and offscreen box
// geometry must use these metrics rather than reading mounted cards only.
export const galleryDensityMetrics = (density: InterfaceDensity = "standard") =>
  density === "compact" ? { gap: 10, chrome: 44, bodyHeight: 42, padding: 3 } : { gap: 14, chrome: 50, bodyHeight: 48, padding: 6 };
