import type { Style } from "../lib/style.js";
import { norm, type Word } from "../lib/words.js";
import type { Beats } from "./beats.js";

type Fx = Beats["fx"][number];
type Kind = Fx["kind"];

/** How long each effect lasts on screen (s). */
export const FX_DURATION: Record<Kind, number> = {
  shake: 0.4,
  zoomPunch: 0.45,
  flash: 0.28,
  whip: 0.24,
  lightLeak: 1.4,
  colorPop: 0,
  rgbSplit: 0.3,
  glitch: 0.32,
  strobe: 0.4,
  ladder: 1,
};

/**
 * What each effect drives: two effects on one layer must not overlap (a ladder and a punch both scale `.shake`; a
 * strobe and a flash both drive `#flash`). Baked effects are drawn into the footage by FFmpeg (`fxBakeFilter`).
 */
const LAYER: Record<Kind, "camera" | "overlay" | "baked" | "free"> = {
  shake: "camera", zoomPunch: "camera", ladder: "camera", whip: "camera",
  flash: "overlay", strobe: "overlay",
  rgbSplit: "baked", glitch: "baked",
  lightLeak: "free", colorPop: "free",
};

interface Candidate {
  kind: Kind;
  at: number;
  duration?: number;
  reason: string;
  /** Lower goes first when the density budget runs out. */
  priority: number;
}

/**
 * Pick the visual effects, CapCut-style but rationed. Candidates come from the edit itself: strong words (behind-words,
 * counters, callouts), jump cuts, spoken keywords, and light leaks spread over the video. A density budget
 * (`maxPer10s`) and a minimum spacing keep the edit from flickering; colour pops ride on behind-words and are free.
 */
export function proposeEffects(
  words: Word[],
  beats: Pick<Beats, "behind" | "mographs" | "cuts" | "duration"> & Partial<Pick<Beats, "scenes">>,
  style: Style,
): Fx[] {
  const e = style.effects;
  const D = beats.duration;
  const cands: Candidate[] = [];

  // Strong words: the moments the edit already says matter.
  const strong = [
    ...beats.behind.map((b) => ({ at: b.start, why: `mot derrière « ${b.text} »` })),
    ...beats.mographs.filter((m) => m.kind === "counter" || m.kind === "callout").map((m) => ({ at: m.start, why: `${m.kind} « ${m.text} »` })),
  ];
  for (const s of strong) {
    if (e.strongWord === "zoomPunch" || e.strongWord === "both") cands.push({ kind: "zoomPunch", at: s.at, reason: s.why, priority: 1 });
    if (e.strongWord === "shake" || e.strongWord === "both") cands.push({ kind: "shake", at: s.at + 0.05, reason: s.why, priority: 2 });
  }

  // Spoken keywords.
  const lexicon = e.keywords.flatMap((k) => k.words.map((w) => ({ key: norm(w), kind: k.kind })));
  for (const [i, w] of words.entries()) {
    const hit = lexicon.find((l) => l.key === norm(w.text));
    if (hit && words.slice(Math.max(0, i - 4), i).some((x) => ["pas", "jamais", "aucun", "sans", "rien"].includes(norm(x.text)))) continue;
    if (hit) cands.push({ kind: hit.kind, at: w.start, reason: `mot-clé « ${w.text} »`, priority: 0 });
  }

  // Jump cuts: every Nth cut that opens a take long enough to land the effect.
  const cutMode = e.cuts;
  if (cutMode !== "none") {
    const usable = beats.cuts.filter((c, i) => (beats.cuts[i + 1] ?? D) - c >= 1 && c > 0.5 && c < D - 1);
    // A cut effect inside a behind-word would shake the word's cutout apart: skip those cuts.
    const busy = beats.behind.map((b) => ({ start: b.start - 0.3, end: b.end + 0.3 }));
    usable.filter((c) => !busy.some((b) => c > b.start && c < b.end)).forEach((c, i) => {
      if (i % e.cutEvery !== e.cutEvery - 1) return;
      const kind: Kind = cutMode === "mix" ? (["whip", "flash", "glitch"] as const)[Math.floor(i / e.cutEvery) % 3] : cutMode;
      // Whip and flash straddle the cut: they start just before it.
      cands.push({ kind, at: Math.max(0, c - FX_DURATION[kind] / 2), reason: "coupe", priority: 3 });
    });
  }

  // Zoom ladders: the longest takes open on hard zoom steps (the 16th-note "jump zooms" of fast edits). Not under a
  // full-screen scene (nothing of the footage shows) nor on a behind-word (its cutout would step out of register).
  if (e.ladder > 0) {
    const blocked = [...beats.behind, ...(beats.scenes ?? [])].map((b) => ({ start: b.start - 0.3, end: b.end + 0.3 }));
    const starts = [0, ...beats.cuts].map((c, i, all) => ({ at: c + 0.15, len: (all[i + 1] ?? D) - c }))
      .filter((s) => s.len >= 2.5 && !blocked.some((b) => s.at < b.end && s.at + FX_DURATION.ladder > b.start))
      .sort((a, b) => b.len - a.len)
      .slice(0, e.ladder);
    for (const s of starts) cands.push({ kind: "ladder", at: s.at, reason: `prise longue (${s.len.toFixed(1)} s)`, priority: 3.5 });
  }

  // Light leaks: spread evenly, snapped to the nearest cut when one is close (a leak hides a cut nicely).
  for (let k = 0; k < e.lightLeaks; k++) {
    const ideal = (D * (k + 1)) / (e.lightLeaks + 1);
    const near = beats.cuts.reduce((b, c) => (Math.abs(c - ideal) < Math.abs(b - ideal) ? c : b), Infinity);
    const at = Math.abs(near - ideal) < 2 ? near - 0.4 : ideal;
    if (at > 0.3 && at + FX_DURATION.lightLeak < D) cands.push({ kind: "lightLeak", at, reason: "light leak", priority: 4 });
  }

  // Ration: keyword > punch > shake > cut > ladder > leak, never two effects within 0.8 s nor two overlapping on one
  // layer, at most maxPer10s per 10 s.
  const out: Fx[] = [];
  for (const c of cands.sort((a, b) => a.priority - b.priority || a.at - b.at)) {
    const dur = c.duration ?? FX_DURATION[c.kind];
    if (c.at < 0 || c.at + dur > D) continue;
    if (out.some((o) => Math.abs(o.at - c.at) < 0.8)) continue;
    const layer = LAYER[c.kind];
    if (layer !== "free" && out.some((o) => LAYER[o.kind] === layer && c.at < o.at + o.duration + 0.15 && o.at < c.at + dur + 0.15)) continue;
    // The budget holds around every effect, not just the new one: adding c must not crowd a neighbour's 10 s either.
    const trial = [...out, { at: c.at }];
    const crowded = trial.filter((f) => Math.abs(f.at - c.at) < 5)
      .some((f) => trial.filter((g) => Math.abs(g.at - f.at) < 5).length > e.maxPer10s);
    if (crowded) continue;
    out.push({ id: "", kind: c.kind, at: r(c.at), duration: r(dur), reason: c.reason });
  }

  // RGB split rides on every punch and shake (the chromatic jolt of CapCut impacts), outside the budget.
  if (e.rgbSplit) {
    for (const o of out.filter((x) => x.kind === "zoomPunch" || x.kind === "shake")) {
      if (!out.some((x) => x.kind === "rgbSplit" && Math.abs(x.at - o.at) < 0.3)) {
        out.push({ id: "", kind: "rgbSplit", at: o.at, duration: r(Math.min(FX_DURATION.rgbSplit, o.duration)), reason: `avec ${o.kind}` });
      }
    }
  }

  // Colour pop: the world goes black and white under each behind-word (the cutout keeps the subject in colour).
  if (e.colorPop) {
    for (const b of beats.behind) {
      out.push({ id: "", kind: "colorPop", at: r(b.start), duration: r(b.end - b.start), reason: `mot derrière « ${b.text} »` });
    }
  }
  return out.sort((a, b) => a.at - b.at).map((f, i) => ({ ...f, id: `fx${i}` }));
}

/** Sound cue that goes with an effect, if any. */
export function fxSound(kind: Kind): Beats["sfx"][number]["kind"] | null {
  if (kind === "whip") return "whoosh";
  if (kind === "flash" || kind === "shake" || kind === "strobe") return "hit";
  if (kind === "zoomPunch") return "pop";
  if (kind === "glitch") return "glitch";
  if (kind === "ladder") return "click";
  return null;
}

/**
 * FFmpeg filter that draws the baked effects into the footage, active only inside their windows: an RGB split
 * (red and blue planes pulled apart, halved over its second half) and a glitch (horizontal bands torn sideways,
 * re-drawn three times, with a colour split). Done once per video in FFmpeg instead of per frame in Chrome, where
 * channel filters on a full-frame video would cost minutes of render on a CPU (decision 8). Seeded: one layout.
 */
export function fxBakeFilter(fx: Pick<Fx, "kind" | "at" | "duration">[], W: number, H: number, intensity = 1): string | null {
  const baked = fx.filter((f) => f.kind === "rgbSplit" || f.kind === "glitch");
  if (!baked.length) return null;
  let seed = 11;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const win = (a: number, b: number) => `between(t,${r(a)},${r(b)})`;
  const even = (x: number) => Math.max(2, 2 * Math.round(x / 2));
  const bands: { y: number; h: number; dx: number; a: number; b: number }[] = [];
  const split: { a: number; b: number; px: number }[] = [];
  for (const f of baked) {
    const px = even(W * 0.012 * intensity);
    if (f.kind === "rgbSplit") {
      split.push({ a: f.at, b: f.at + f.duration / 2, px }, { a: f.at + f.duration / 2, b: f.at + f.duration, px: even(px / 2) });
      continue;
    }
    split.push({ a: f.at, b: f.at + f.duration, px: even(px * 1.5) });
    for (let s = 0; s < 3; s++) {
      const a = f.at + (s * f.duration) / 3, b = f.at + ((s + 1) * f.duration) / 3;
      for (let k = 0; k < 3; k++) {
        const h = even(H * (0.02 + rnd() * 0.07));
        bands.push({ y: even(rnd() * (H - h)), h, dx: Math.round((rnd() < 0.5 ? -1 : 1) * W * (0.03 + rnd() * 0.06) * intensity), a, b });
      }
    }
  }
  const chain: string[] = [];
  let cur = "0:v";
  if (bands.length) {
    chain.push(`[0:v]split=${bands.length + 1}[g0]${bands.map((_, i) => `[c${i}]`).join("")}`);
    cur = "g0";
    bands.forEach((band, i) => {
      chain.push(`[c${i}]crop=${W}:${band.h}:0:${band.y}[b${i}]`);
      chain.push(`[${cur}][b${i}]overlay=x=${band.dx}:y=${band.y}:enable='${win(band.a, band.b)}'[g${i + 1}]`);
      cur = `g${i + 1}`;
    });
  }
  // One rgbashift per amount (the timeline expression sums the windows that use it).
  const amounts = [...new Set(split.map((x) => x.px))];
  amounts.forEach((px, i) => {
    const when = split.filter((x) => x.px === px).map((x) => win(x.a, x.b)).join("+");
    chain.push(`[${cur}]rgbashift=rh=${-px}:bh=${px}:edge=smear:enable='${when}'[s${i}]`);
    cur = `s${i}`;
  });
  chain.push(`[${cur}]format=yuv420p[fx]`);
  return chain.join(";");
}

const r = (t: number) => Math.round(t * 1000) / 1000;

/**
 * Hand-edited camera effects that move the rush under a behind-word. `proposeEffects` never places a whip or a ladder
 * there, but beats.json is editable (decision 2): a whip slides and grows `.shake`, a ladder steps its scale, so the
 * subject slips out of the placement measured at the word's start (decision 7) and pushes against the word's pull.
 * The composition neutralizes them (a whip keeps only its flash, a ladder is dropped) and says so.
 */
export function behindFxClashes(beats: Pick<Beats, "behind" | "fx">): { fx: Fx; word: Beats["behind"][number]; note: string }[] {
  const out: { fx: Fx; word: Beats["behind"][number]; note: string }[] = [];
  for (const f of beats.fx) {
    if (f.kind !== "whip" && f.kind !== "ladder") continue;
    const word = beats.behind.find((b) => f.at < b.end && f.at + f.duration > b.start);
    if (!word) continue;
    const done = f.kind === "whip" ? "joué en flash seul" : "ignoré";
    out.push({
      fx: f, word,
      note: `Effet ${f.id} (${f.kind}, ${f.at.toFixed(2)} s) pendant le mot derrière « ${word.text} » ` +
        `(${word.start.toFixed(2)}–${word.end.toFixed(2)} s) : ${done}, le rush glisserait sous le mot. ` +
        `Déplace-le hors du mot ou retire-le de beats.json.`,
    });
  }
  return out;
}
