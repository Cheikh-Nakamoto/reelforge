import type { Layout } from "./html.js";

/** A low-resolution alpha frame of the cutout, in source pixels scaled to w×h. */
export interface Mask {
  w: number;
  h: number;
  data: Uint8Array;
}

export interface Placement {
  /** Centre y and font size of the word, in composition pixels. */
  cy: number;
  fs: number;
  /** Share of the word's box hidden by the subject (mean over the sampled frames), and the worst frame. */
  coverage: number;
  worst: number;
  /** Letters more than 60 % hidden on the worst frame. */
  lostLetters: number;
  ok: boolean;
}

export interface PlaceInput {
  masks: Mask[];
  layout: Layout;
  W: number;
  H: number;
  /** Camera framing scale and its origin (the .cam transform), to map frame pixels back onto the footage. */
  scale: number;
  origin: { x: number; y: number };
  /** Rough advance width per character in em, for the display face. */
  em: number;
  chars: number;
  fsMax: number;
  /** The word's bottom must stay above this y (caption zone). */
  maxBottom: number;
  /** Wanted share hidden by the head: the word reads, and clearly sits behind. */
  target?: number;
}

/**
 * Share of the word box (cap height ≈ 0.72 em) covered by the matte, averaged and worst over the masks, and how
 * many letters are lost (more than 60 % hidden) on the worst frame. Area alone misleads: 40 % hidden on one side
 * takes the end of the word with it.
 */
export function coverage(p: PlaceInput, cy: number, fs: number): { mean: number; worst: number; lost: number; lostRun: number } {
  const width = Math.min(p.W * 0.96, p.chars * p.em * fs);
  const capH = fs * 0.72;
  const x0 = (p.W - width) / 2, y0 = cy - capH / 2;
  const NX = Math.max(48, p.chars * 8), NY = 12;
  const per = p.masks.map((m) => {
    let hit = 0;
    const col = new Array<number>(NX).fill(0);
    for (let j = 0; j < NY; j++) {
      for (let i = 0; i < NX; i++) {
        // Frame point → footage point (undo the camera scale) → normalized source point → mask pixel.
        const fx = x0 + ((i + 0.5) / NX) * width;
        const fy = y0 + ((j + 0.5) / NY) * capH;
        const sx = p.origin.x + (fx - p.origin.x) / p.scale;
        const sy = p.origin.y + (fy - p.origin.y) / p.scale;
        const u = (sx - p.layout.box.x) / p.layout.box.w;
        const v = (sy - p.layout.box.y) / p.layout.box.h;
        if (u < 0 || u >= 1 || v < 0 || v >= 1) continue;
        if (m.data[Math.floor(v * m.h) * m.w + Math.floor(u * m.w)] > 127) {
          hit++;
          col[i]++;
        }
      }
    }
    // Letters as equal slices of the word.
    const lostFlags = Array.from({ length: p.chars }, (_, k) => {
      const a = Math.floor((k * NX) / p.chars), b = Math.floor(((k + 1) * NX) / p.chars);
      let c = 0;
      for (let i = a; i < b; i++) c += col[i];
      return c / ((b - a) * NY) > 0.6;
    });
    let run = 0, longest = 0;
    for (const f of lostFlags) longest = Math.max(longest, (run = f ? run + 1 : 0));
    return { area: hit / (NX * NY), lost: lostFlags.filter(Boolean).length, run: longest };
  });
  const worst = per.reduce((a, b) => (b.lost > a.lost || (b.lost === a.lost && b.area > a.area) ? b : a), per[0] ?? { area: 0, lost: 0, run: 0 });
  return {
    mean: per.reduce((s, x) => s + x.area, 0) / Math.max(1, per.length),
    worst: Math.max(0, ...per.map((x) => x.area)),
    lost: worst.lost,
    lostRun: worst.run,
  };
}

/**
 * Size and height of a behind-word chosen on the real matte: about `target` of it hidden by the subject (under
 * ~15 % it floats, over ~65 % it is eaten), as large as possible, clear of the captions and inside the frame.
 */
export function placeBehind(p: PlaceInput): Placement {
  const target = p.target ?? 0.4;
  const margin = p.H * 0.03;
  let best: Placement | null = null;
  let bestCost = Infinity;
  for (let k = 0; k < 6; k++) {
    const fs = p.fsMax * (1 - k * 0.1);
    if (fs < p.H * 0.08) break;
    const top = fs / 2 + margin;
    const bottom = Math.min(p.maxBottom - fs / 2, p.H - fs / 2 - margin);
    for (let cy = top; cy <= bottom; cy += p.H * 0.015) {
      const c = coverage(p, cy, fs);
      // Readable: at most one letter in four lost, and never two lost letters side by side ("BUD__T" does not read).
      const maxLost = Math.max(1, Math.floor(p.chars / 4));
      const readable = c.lost <= maxLost && c.lostRun <= 1;
      const ok = readable && c.mean >= 0.15 && c.mean <= 0.58 && c.worst <= 0.68;
      // Readability first, then distance to the target share, then prefer the larger word.
      const cost = (readable ? 0 : 2 + c.lost) + Math.abs(c.mean - target) + (c.worst > 0.68 ? 1 : 0) + k * 0.02;
      if (cost < bestCost) {
        bestCost = cost;
        best = { cy: Math.round(cy), fs: Math.round(fs), coverage: round(c.mean), worst: round(c.worst), lostLetters: c.lost, ok };
      }
    }
  }
  return best ?? { cy: Math.round(p.H * 0.3), fs: Math.round(p.fsMax), coverage: 0, worst: 0, lostLetters: 0, ok: false };
}

const round = (x: number) => Math.round(x * 100) / 100;
