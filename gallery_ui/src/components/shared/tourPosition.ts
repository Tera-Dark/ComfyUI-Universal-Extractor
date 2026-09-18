export interface TourRect { left: number; top: number; width: number; height: number }
export type TourSide = "top" | "bottom" | "left" | "right" | "center";
const edge = 12;
const gap = 14;
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(n, Math.max(min, max)));

/** Measure the actual card, then prefer a non-overlapping side. No fixed height assumptions. */
export function placeTourCard(target: TourRect | null, card: {width: number; height: number}, viewport: {width: number; height: number}) {
  const width = Math.min(card.width, viewport.width - edge * 2);
  const height = Math.min(card.height, viewport.height - edge * 2);
  if (!target) return { left: (viewport.width - width) / 2, top: (viewport.height - height) / 2, side: "center" as TourSide };
  const horizontalCenter = target.left + target.width / 2 - width / 2;
  const verticalCenter = target.top + target.height / 2 - height / 2;
  const candidates: Array<{left: number; top: number; side: TourSide}> = [
    { left: horizontalCenter, top: target.top + target.height + gap, side: "bottom" as TourSide },
    { left: horizontalCenter, top: target.top - height - gap, side: "top" as TourSide },
    { left: target.left + target.width + gap, top: verticalCenter, side: "right" as TourSide },
    { left: target.left - width - gap, top: verticalCenter, side: "left" as TourSide },
  ].map(p => ({ ...p, left: clamp(p.left, edge, viewport.width - width - edge), top: clamp(p.top, edge, viewport.height - height - edge) }));
  const overlap = (p: TourRect) => Math.max(0, Math.min(p.left + p.width, target.left + target.width) - Math.max(p.left, target.left)) *
    Math.max(0, Math.min(p.top + p.height, target.top + target.height) - Math.max(p.top, target.top));
  return candidates.sort((a, b) => overlap({...a, width, height}) - overlap({...b, width, height}))[0];
}

/** On short phones, scroll the explanation rather than covering the highlighted control. */
export function tourCardMaxHeight(target: TourRect | null, cardWidth: number, viewport: {width:number; height:number}) {
  if (!target) return viewport.height - edge * 2;
  const sideSpace = Math.max(target.left - edge - gap, viewport.width - target.left - target.width - edge - gap);
  if (sideSpace >= cardWidth) return viewport.height - edge * 2;
  return Math.max(140, Math.max(target.top - edge - gap, viewport.height - target.top - target.height - edge - gap));
}
