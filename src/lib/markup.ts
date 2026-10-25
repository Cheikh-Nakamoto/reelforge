/** Small helpers shared by the composition builders (html.ts, stage.ts). */

/** Rough advance width per character (em) for the display faces, used to fit a word to the frame. */
export const CHAR_EM: Record<string, number> = {
  "League Gothic": 0.4, Oswald: 0.5, "Archivo Black": 0.72, "Playfair Display": 0.58, Montserrat: 0.68,
  Inter: 0.6, Poppins: 0.64, "EB Garamond": 0.5,
};

export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
export const r1 = (x: number) => Math.round(x * 10) / 10;
export const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** Extruded 3D face for display type: stacked 1 px offsets of a darker colour, then a soft drop shadow. */
export function extrude(color: string, depthPx: number): string {
  const layers = Array.from({ length: Math.max(1, depthPx) }, (_, k) => `0 ${k + 1}px 0 ${color}`);
  return [...layers, `0 ${depthPx + 6}px ${depthPx * 2 + 8}px rgba(0,0,0,0.45)`].join(", ");
}
