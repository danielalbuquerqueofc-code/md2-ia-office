/** Fit the native canvas map with breathing room for labels and the toolbar. */
export function fitOfficeZoom(
  requested: number,
  width: number,
  height: number,
  cols: number,
  rows: number,
  tileSize: number,
): number {
  if (width <= 0 || height <= 0) return requested;
  const fit = Math.min(requested, width / (cols * tileSize + 32), height / (rows * tileSize + 80));
  // Whole-pixel tile edges prevent seams in the original sprite cache on mobile.
  return Math.max(1 / tileSize, Math.floor(fit * tileSize) / tileSize);
}
