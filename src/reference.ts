import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { run, runBuffer } from "./lib/exec.js";
import { ffprobe } from "./lib/ffmpeg.js";
import { readJson, WORK_DIR, writeJson } from "./lib/project.js";

/**
 * "Edit it like this one": the energy of a reference video measured on the machine (cuts, white flashes, strobes,
 * zoom punches, jump-zoom ladders, shakes, whip pans) and its look, turned into style overrides. Higgsfield's Katana
 * reads a reference frame by frame before it edits; this is the local, model-free version: FFmpeg decodes small grey
 * frames, and plain pixel arithmetic (frame differences, a brute-force global motion search) finds the events.
 * Captions are not measured (that would need OCR): the questionnaire picks their look.
 *
 * Measured on our own renders (ground truth from their beats): on a talking-head edit 6 of 8 jump cuts found and no
 * false one; on a raw rush with no cut, 2 false cuts in 25 s; on a graphics-heavy reel 18 cuts reported for 13, the
 * extra ones being full-frame switches (colour pop to black and white with a punch): they read as cuts, and are
 * counted as such.
 */

export const EVENT_KINDS = ["cuts", "flashes", "strobes", "punches", "ladders", "shakes", "whips"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];
export type Events = Record<EventKind, number[]>;

export interface ReferenceReport {
  file: string;
  duration: number;
  /** Seconds actually read (long videos are read for their first `MAX_SECONDS`). */
  analysedSeconds: number;
  width: number;
  height: number;
  events: Events;
  /** Events per 10 s of analysed video. */
  per10s: Record<EventKind, number>;
  /** Mean shot length (s). */
  meanShot: number;
  /** Mean zoom of the punches (1.12 = 12 % in), and mean shake jolt (per-frame move, |dx| + |dy|) in % of the width. */
  punchZoom: number | null;
  shakeAmp: number | null;
  /** Fraction of the cuts that carry a white flash, and that are whip pans. */
  flashCuts: number;
  whipCuts: number;
  look: { luma: number; saturation: number; contrast: number; letterbox: number | null };
}

export const ANALYSIS_FPS = 30;
export const MAX_SECONDS = 120;
/** Analysis frames are this wide (portrait 96×170, landscape 96×54). */
const SIZE = 96;

const r2 = (x: number) => Math.round(x * 100) / 100;
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

// ---------------------------------------------------------------- motion

/**
 * Mean absolute difference between frame `b` and frame `a` moved by (dx, dy) and scaled by `s` about the centre,
 * on every other pixel of the inner area. b(x, y) ≈ a(c + (x − c − d) / s).
 */
function sad(a: Uint8Array, b: Uint8Array, w: number, h: number, dx: number, dy: number, s: number): number {
  const cx = w / 2, cy = h / 2, m = 6;
  let sum = 0, n = 0;
  for (let y = m; y < h - m; y += 2) {
    for (let x = m; x < w - m; x += 2) {
      const sx = Math.round(cx + (x - cx - dx) / s), sy = Math.round(cy + (y - cy - dy) / s);
      if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
      sum += Math.abs(b[y * w + x] - a[sy * w + sx]);
      n++;
    }
  }
  return n ? sum / n : 255;
}

export interface Motion {
  dx: number;
  dy: number;
  scale: number;
  /** Error left after the best move, and with no move at all. */
  err: number;
  still: number;
}

const SCALES = [0.84, 0.88, 0.92, 0.95, 0.97, 0.985, 1.015, 1.03, 1.05, 1.08, 1.1, 1.12, 1.15, 1.18, 1.22];

/** Global move from `a` to `b`: translation (coarse ±8 px, then ±1), then scale, then translation again at that scale. */
export function estimateMotion(a: Uint8Array, b: Uint8Array, w: number, h: number): Motion {
  const still = sad(a, b, w, h, 0, 0, 1);
  let best = { dx: 0, dy: 0, scale: 1, err: still };
  const tryMove = (dx: number, dy: number, scale: number) => {
    const e = sad(a, b, w, h, dx, dy, scale);
    if (e < best.err - 1e-9) best = { dx, dy, scale, err: e };
  };
  for (let dy = -6; dy <= 6; dy += 2) for (let dx = -8; dx <= 8; dx += 2) tryMove(dx, dy, 1);
  const c = { ...best };
  for (let dy = c.dy - 1; dy <= c.dy + 1; dy++) for (let dx = c.dx - 1; dx <= c.dx + 1; dx++) tryMove(dx, dy, 1);
  for (const s of SCALES) tryMove(best.dx, best.dy, s);
  if (best.scale !== 1) {
    const z = { ...best };
    for (let dy = z.dy - 2; dy <= z.dy + 2; dy++) for (let dx = z.dx - 2; dx <= z.dx + 2; dx++) tryMove(dx, dy, z.scale);
  }
  return { ...best, still };
}

const lumaOf = (f: Uint8Array) => {
  let s = 0;
  for (let i = 0; i < f.length; i++) s += f[i];
  return s / f.length;
};

// ---------------------------------------------------------------- events

/**
 * Events of a reference from its grey frames. Rules, per frame i against i−1:
 * - flash: the picture jumps ≥ 35 levels brighter and comes back within 8 frames (three within 0.6 s: a strobe);
 * - cut: even the best global move leaves a large error (≥ 18 and ≥ 3× the local median), or a one-frame peak
 *   ≥ 7 and ≥ 2.2× the local median (a jump cut on a talking head);
 * - jump zoom: a sudden plain difference that a scale of ≥ 4 % explains (three within 1.5 s: a ladder, else a punch);
 * - punch: ≥ 8 % zoom-in over 3 frames with no cut;
 * - shake: in 0.5 s, ≥ 4 frames moving ≥ 2 % of the width with ≥ 3 reversals;
 * - whip: a cut with a lateral move ≥ 6 % of the width per frame next to it.
 */
export function detectEvents(frames: Uint8Array[], w: number, h: number, fps: number): Events & { punchZooms: number[]; shakeAmps: number[] } {
  const n = frames.length;
  const luma = frames.map(lumaOf);
  const moves: Motion[] = frames.map((f, i) => (i ? estimateMotion(frames[i - 1], f, w, h) : { dx: 0, dy: 0, scale: 1, err: 0, still: 0 }));
  const t = (i: number) => r3(i / fps);
  const out = { cuts: [] as number[], flashes: [] as number[], strobes: [] as number[], punches: [] as number[], ladders: [] as number[],
    shakes: [] as number[], whips: [] as number[], punchZooms: [] as number[], shakeAmps: [] as number[] };

  // Flashes first: their frames are not cuts.
  const flashFrame = new Set<number>();
  const flashAt: number[] = [];
  for (let i = 1; i < n; i++) {
    if (flashFrame.has(i) || luma[i] - luma[i - 1] < 35) continue;
    for (let j = i + 1; j <= Math.min(n - 1, i + 8); j++) {
      if (luma[j] <= luma[i - 1] + 15) {
        for (let k = i; k <= j; k++) flashFrame.add(k);
        flashAt.push(i);
        break;
      }
    }
  }
  for (let k = 0; k < flashAt.length; ) {
    let e = k;
    while (e + 1 < flashAt.length && flashAt[e + 1] - flashAt[k] <= 0.6 * fps) e++;
    if (e - k >= 2) out.strobes.push(t(flashAt[k]));
    else for (let q = k; q <= e; q++) out.flashes.push(t(flashAt[q]));
    k = e + 1;
  }

  // Cuts and hard jump zooms.
  const half = Math.round(fps / 2);
  const jumps: { i: number; scale: number }[] = [];
  const cutIdx: number[] = [];
  for (let i = 1; i < n; i++) {
    if (flashFrame.has(i)) continue;
    const m = moves[i];
    const around = moves.slice(Math.max(1, i - half), Math.min(n, i + half + 1));
    const local = median(around.map((x) => x.err));
    // A jump zoom is sudden: its plain difference stands out from the frames around it (a slow zoom does not).
    const localStill = median(around.map((x) => x.still));
    // A hard cut leaves a large error whatever the move; a jump cut on a talking head (same face, same light) only
    // a one-frame peak, 2–5× the local level (measured on real rushes: 9–17 against 2–7), that no global move
    // explains (55–100 % of the plain difference left, where a shake or a punch leaves far less).
    const peak = m.err >= (moves[i - 1]?.err ?? 0) && m.err >= (moves[i + 1]?.err ?? 0);
    let soft = peak && m.err >= 7 && m.err >= 2.2 * local && m.still >= 1.5 * localStill && m.err >= 0.55 * m.still;
    if (soft) {
      // …and that holds: four frames on, no move from the old shot explains the new one either (a punch or an
      // animated title passing through is explained by then).
      const on = estimateMotion(frames[i - 1], frames[Math.min(n - 1, i + 4)], w, h);
      soft = on.err >= 7 && on.err >= 0.55 * on.still;
    }
    if ((m.err >= 18 && m.err >= 3 * local) || soft) cutIdx.push(i);
    else if (m.still >= 8 && m.still >= 3 * localStill && Math.abs(m.scale - 1) >= 0.04 && m.err <= m.still * 0.5) jumps.push({ i, scale: m.scale });
  }
  // A flash that lands on a different shot is a flash on a cut: the shot after it differs from the one before.
  for (const i of flashAt) {
    let j = i;
    while (flashFrame.has(j) && j < n - 1) j++;
    const m = estimateMotion(frames[i - 1], frames[j], w, h);
    if (m.err >= 18) cutIdx.push(j);
  }
  for (let k = 0; k < jumps.length; ) {
    let e = k;
    while (e + 1 < jumps.length && jumps[e + 1].i - jumps[k].i <= 1.5 * fps) e++;
    if (e - k >= 2) out.ladders.push(t(jumps[k].i));
    else for (let q = k; q <= e; q++) {
      const i = jumps[q].i, j = Math.min(n - 1, i + 3), back = Math.min(n - 1, i + Math.round(0.5 * fps));
      // A punch goes back to its framing within half a second; a zoom that holds is a jump cut reframed (the
      // alternate framing of talking-head edits): a cut.
      const later = estimateMotion(frames[i - 1], frames[back], w, h);
      if (cutIdx.some((c) => c > i && c <= back) || Math.abs(later.scale - 1) > 0.03 || later.err > later.still * 0.8 + 4) {
        cutIdx.push(i);
        continue;
      }
      // The punch's size is its deepest zoom over the next frames, not its first step.
      let whole = 1;
      for (let k = i; k <= j; k++) whole = Math.max(whole, estimateMotion(frames[i - 1], frames[k], w, h).scale);
      out.punches.push(t(i));
      out.punchZooms.push(Math.max(whole, 1 / whole));
    }
    k = e + 1;
  }

  // Consecutive cut frames are one transition (a whip pan or a blur swish lasts several frames): one cut, and three
  // frames or more make it a whip.
  cutIdx.sort((a, b) => a - b);
  const runs: number[][] = [];
  for (const c of [...new Set(cutIdx)]) {
    const last = runs[runs.length - 1];
    if (last && c - last[last.length - 1] <= 2) last.push(c);
    else runs.push([c]);
  }
  out.cuts = runs.map((r) => t(r[0]));
  const transitionWhips = runs.filter((r) => r[r.length - 1] - r[0] >= 2).map((r) => r[0]);

  // Smooth punches: a fast zoom-in over three frames, inside one shot.
  const cutSet = new Set(cutIdx);
  out.punches = out.punches.filter((p) => !runs.some((r) => Math.abs(t(r[0]) - p) < 0.05));
  for (let i = 3; i < n; i++) {
    if ([i - 2, i - 1, i].some((k) => cutSet.has(k) || flashFrame.has(k))) continue;
    if (out.punches.some((p) => Math.abs(p - i / fps) < 0.6) || out.ladders.some((p) => i / fps - p >= -0.2 && i / fps - p < 1.6)) continue;
    const s = moves[i - 2].scale * moves[i - 1].scale * moves[i].scale;
    if (s >= 1.08 && moves.slice(i - 2, i + 1).every((m) => m.scale >= 1)) {
      const m3 = estimateMotion(frames[i - 3], frames[i], w, h);
      if (m3.scale >= 1.07 && m3.err <= m3.still * 0.6) {
        out.punches.push(t(i - 2));
        out.punchZooms.push(m3.scale);
      }
    }
  }
  out.punches.sort((a, b) => a - b);

  // Shakes: jittery global moves with reversals.
  const amp = (m: Motion) => Math.abs(m.dx) + Math.abs(m.dy);
  const jitter = (k: number) => !cutSet.has(k) && !flashFrame.has(k) && amp(moves[k]) >= 0.02 * w && moves[k].scale > 0.97 && moves[k].scale < 1.03;
  for (let i = 1; i + half <= n; ) {
    // Windows start on a jittering frame, so a shake is dated by its first jolt.
    if (!jitter(i)) {
      i++;
      continue;
    }
    const big = moves.slice(i, i + half).filter((_, k) => jitter(i + k));
    let rev = 0;
    for (let k = 1; k < big.length; k++) {
      if (Math.sign(big[k].dx) * Math.sign(big[k - 1].dx) < 0 || Math.sign(big[k].dy) * Math.sign(big[k - 1].dy) < 0) rev++;
    }
    if (big.length >= 4 && rev >= 3) {
      out.shakes.push(t(i));
      out.shakeAmps.push((100 * median(big.map(amp))) / w);
      i += Math.round(0.6 * fps);
    } else i++;
  }

  // Whips: a transition several frames long, or a cut with a fast lateral move beside it, one way for two frames
  // (a shake goes back and forth).
  for (const c of transitionWhips) out.whips.push(t(c));
  for (const c of runs.filter((r) => r.length === 1).map((r) => r[0])) {
    const near = moves.slice(Math.max(1, c - 3), Math.min(n, c + 4)).filter((_, k) => !cutSet.has(Math.max(1, c - 3) + k));
    const fast = (m: Motion) => Math.abs(m.dx) >= 0.06 * w;
    if (near.some((m, k) => k > 0 && fast(m) && fast(near[k - 1]) && Math.sign(m.dx) === Math.sign(near[k - 1].dx))) out.whips.push(t(c));
  }
  return out;
}

// ---------------------------------------------------------------- analysis

/** Grey frames of the first `MAX_SECONDS`, `SIZE` px wide, at most `ANALYSIS_FPS`. */
async function greyFrames(file: string, width: number, height: number, fps: number) {
  const w = SIZE, h = 2 * Math.round((SIZE * height) / width / 2);
  const rate = Math.min(ANALYSIS_FPS, Math.round(fps) || ANALYSIS_FPS);
  const buf = await runBuffer("ffmpeg", [
    "-v", "error", "-t", String(MAX_SECONDS), "-i", file, "-an",
    "-vf", `fps=${rate},scale=${w}:${h}:flags=area,format=gray`, "-f", "rawvideo", "-",
  ]);
  const frames: Uint8Array[] = [];
  for (let o = 0; o + w * h <= buf.length; o += w * h) frames.push(new Uint8Array(buf.buffer, buf.byteOffset + o, w * h));
  return { frames, w, h, fps: rate };
}

/** Mean luma, saturation and contrast (signalstats, 0–255) and letterbox bars (cropdetect), twice a second. */
async function lookOf(file: string, width: number, height: number): Promise<ReferenceReport["look"]> {
  const { stdout } = await run("ffmpeg", [
    "-v", "error", "-t", String(MAX_SECONDS), "-i", file, "-an",
    "-vf", "fps=2,scale=160:-2,signalstats,metadata=print:file=-", "-f", "null", "-",
  ]);
  const avg = (key: string) => {
    const xs = [...stdout.matchAll(new RegExp(`signalstats\\.${key}=([\\d.]+)`, "g"))].map((m) => Number(m[1]));
    return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
  };
  const { stderr } = await run("ffmpeg", [
    "-v", "info", "-t", String(MAX_SECONDS), "-i", file, "-an", "-vf", "fps=2,cropdetect=limit=24:round=2:reset=0", "-f", "null", "-",
  ]);
  const crop = [...stderr.matchAll(/crop=(\d+):(\d+):\d+:\d+/g)].pop();
  // Bars: the picture area is clearly shorter than the frame (landscape letterbox).
  const letterbox = crop && Number(crop[2]) < height * 0.9 && Number(crop[1]) > width * 0.9 ? r2(Number(crop[1]) / Number(crop[2])) : null;
  return { luma: Math.round(avg("YAVG")), saturation: Math.round(avg("SATAVG")), contrast: Math.round(avg("YHIGH") - avg("YLOW")), letterbox };
}

/** Rates and ratios from the events of `seconds` of video. */
export function summarize(events: Events & { punchZooms: number[]; shakeAmps: number[] }, seconds: number) {
  const per10s = Object.fromEntries(EVENT_KINDS.map((k) => [k, r2((events[k].length * 10) / Math.max(1, seconds))])) as Record<EventKind, number>;
  const near = (x: number, ys: number[], d: number) => ys.some((y) => Math.abs(x - y) <= d);
  const cuts = events.cuts;
  const mean = (xs: number[]) => (xs.length ? r2(xs.reduce((s, x) => s + x, 0) / xs.length) : null);
  return {
    per10s,
    meanShot: r2(seconds / (cuts.length + 1)),
    punchZoom: mean(events.punchZooms),
    shakeAmp: mean(events.shakeAmps),
    flashCuts: cuts.length ? r2(cuts.filter((c) => near(c, events.flashes, 0.3)).length / cuts.length) : 0,
    whipCuts: cuts.length ? r2(events.whips.length / cuts.length) : 0,
  };
}

/** Identity of a video file: size plus its first megabyte (cheap on a large file). */
function fileKey(file: string): string {
  const h = createHash("sha1").update(String(statSync(file).size));
  const fd = openSync(file, "r");
  const chunk = Buffer.alloc(Math.min(1 << 20, statSync(file).size));
  readSync(fd, chunk, 0, chunk.length, 0);
  closeSync(fd);
  return h.update(chunk).digest("hex").slice(0, 16);
}

export const REFERENCES_DIR = join(WORK_DIR, "_references");

/** The cached analysis of a reference, or null when it has not been read yet. */
export function cachedReference(file: string): (ReferenceReport & { dir: string; sheet: string }) | null {
  const src = resolve(file);
  if (!existsSync(src)) throw new Error(`Reference not found: ${file}`);
  const dir = join(REFERENCES_DIR, fileKey(src));
  const sheet = join(dir, "sheet.jpg");
  return existsSync(join(dir, "report.json")) && existsSync(sheet) ? { ...readJson<ReferenceReport>(join(dir, "report.json")), dir, sheet } : null;
}

/**
 * Analyse a reference video (cached per file under work/_references/<key>/): report.json and sheet.jpg (one frame per
 * shot, for the reviewing agent to see the look).
 */
export async function analyzeReference(file: string, log: (m: string) => void = () => {}): Promise<ReferenceReport & { dir: string; sheet: string }> {
  const cached = cachedReference(file);
  if (cached) return cached;
  const src = resolve(file);
  const dir = join(REFERENCES_DIR, fileKey(src));
  const reportPath = join(dir, "report.json");
  const sheet = join(dir, "sheet.jpg");
  mkdirSync(dir, { recursive: true });
  const p = await ffprobe(src);
  // FFmpeg applies the rotation tag when decoding: a phone video tagged 90° decodes upright, sides swapped.
  const probe = p.rotation % 180 ? { ...p, width: p.height, height: p.width } : p;
  log(`[référence] ${basename(src)} — ${probe.width}x${probe.height}, ${probe.duration.toFixed(1)} s`);
  const g = await greyFrames(src, probe.width, probe.height, probe.fps);
  const seconds = g.frames.length / g.fps;
  const ev = detectEvents(g.frames, g.w, g.h, g.fps);
  const look = await lookOf(src, probe.width, probe.height);
  const s = summarize(ev, seconds);
  const report: ReferenceReport = {
    file: src, duration: r2(probe.duration), analysedSeconds: r2(seconds), width: probe.width, height: probe.height,
    events: Object.fromEntries(EVENT_KINDS.map((k) => [k, ev[k]])) as Events,
    ...s, look,
  };
  writeJson(reportPath, report);
  // One frame from the middle of each shot (at most 12), tiled.
  const bounds = [0, ...ev.cuts, seconds];
  const mids = bounds.slice(0, -1).map((b, i) => (b + bounds[i + 1]) / 2).filter((_, i, a) => a.length <= 12 || i % Math.ceil(a.length / 12) === 0).slice(0, 12);
  const cols = Math.min(6, mids.length);
  await run("ffmpeg", [
    "-v", "error", "-y", "-t", String(MAX_SECONDS), "-i", src, "-an", "-vf",
    `select='${mids.map((m) => `eq(n,${Math.round(m * probe.fps)})`).join("+")}',scale=${probe.height > probe.width ? 180 : 320}:-2,` +
      `tile=${cols}x${Math.ceil(mids.length / cols)}:padding=4:color=black`,
    "-frames:v", "1", "-fps_mode", "vfr", sheet,
  ]);
  log(`[référence] ${ev.cuts.length} coupes, ${ev.flashes.length} flashs, ${ev.punches.length} punchs, ${ev.ladders.length} échelles, ` +
    `${ev.shakes.length} secousses, ${ev.whips.length} whips, ${ev.strobes.length} strobes sur ${seconds.toFixed(0)} s`);
  return { ...report, dir, sheet };
}

// ---------------------------------------------------------------- to a style

/** Style overrides that reproduce a reference's energy and look, with the reasons (in French, for the user). */
export function overridesFrom(r: Pick<ReferenceReport, "per10s" | "punchZoom" | "shakeAmp" | "flashCuts" | "whipCuts" | "look" | "meanShot">) {
  const why: string[] = [];
  const o: { rhythm?: Record<string, number>; motion?: Record<string, number>; effects?: Record<string, unknown>; look?: Record<string, unknown> } = {};
  const fr = (x: number) => x.toFixed(1).replace(".", ",");
  const p = r.per10s;

  const cps = p.cuts / 10;
  if (cps >= 0.6) {
    o.rhythm = { minPause: 0.25, keep: 0.07 };
    o.motion = { jumpZoom: 1.1 };
    why.push(`${fr(cps)} coupe/s (plans de ${fr(r.meanShot)} s) : coupes serrées et cadrage alterné à chaque coupe.`);
  } else if (cps >= 0.3) {
    o.rhythm = { minPause: 0.4, keep: 0.12 };
    why.push(`${fr(cps)} coupe/s : rythme naturel.`);
  } else {
    o.rhythm = { minPause: 0.7, keep: 0.22 };
    o.motion = { jumpZoom: 1 };
    why.push(`${fr(cps)} coupe/s : on laisse respirer.`);
  }

  const fx: Record<string, unknown> = {};
  const accents = p.flashes + p.strobes + p.punches + p.ladders + p.shakes + p.whips;
  fx.maxPer10s = Math.max(0, Math.min(6, Math.round(accents)));
  why.push(`${fr(accents)} effets par 10 s (flashs, punchs, secousses, whips, échelles) : budget de ${fx.maxPer10s}.`);
  fx.strongWord = p.punches > 0 && p.shakes > 0 ? "both" : p.punches > 0 ? "zoomPunch" : p.shakes > 0 ? "shake" : "none";
  const flashCut = r.flashCuts >= 0.15, whipCut = r.whipCuts >= 0.15;
  fx.cuts = flashCut && whipCut ? "mix" : flashCut ? "flash" : whipCut ? "whip" : "none";
  if (fx.cuts !== "none") {
    fx.cutEvery = Math.max(1, Math.min(10, Math.round(1 / Math.max(r.flashCuts, r.whipCuts))));
    why.push(`Coupes : ${Math.round(r.flashCuts * 100)} % avec flash, ${Math.round(r.whipCuts * 100)} % en whip → ${fx.cuts} toutes les ${fx.cutEvery} coupes.`);
  }
  fx.ladder = Math.min(4, Math.round(p.ladders * 3));
  if (fx.ladder) why.push(`Zooms en escalier : ${fx.ladder} par vidéo.`);
  if (r.punchZoom) {
    fx.intensity = r2(Math.max(0.5, Math.min(1.6, 0.4 + (r.punchZoom - 1) * 6)));
    why.push(`Punchs de ${Math.round((r.punchZoom - 1) * 100)} % : intensité ${fx.intensity}.`);
  } else if (r.shakeAmp) {
    // studio's shake at intensity 1 jolts about 4.5 % of the width per frame (|dx| + |dy|).
    fx.intensity = r2(Math.max(0.5, Math.min(1.6, r.shakeAmp / 4.5)));
  }
  if (p.strobes > 0) why.push("Stroboscope repéré : ajoute des mots-clés « strobe » dans effects.keywords pour le placer.");
  o.effects = fx;

  const lk = r.look;
  let grade: string | null = null;
  if (lk.saturation < 4) grade = "mono-clean";
  else if (lk.saturation >= 48) grade = "bright-pop";
  else if (lk.saturation < 16) grade = "muted-editorial";
  else if (lk.contrast >= 175 && lk.luma < 100) grade = "deep-contrast";
  if (grade) {
    o.look = { grade };
    why.push(`Image : luminance ${lk.luma}, saturation ${lk.saturation}, contraste ${lk.contrast} → étalonnage ${grade}.`);
  }
  if (lk.letterbox && lk.letterbox >= 2) {
    o.look = { ...(o.look ?? {}), letterbox: lk.letterbox };
    why.push(`Bandes noires au format ${fr(lk.letterbox)}.`);
  }
  return { overrides: o, why };
}

/** A reference analysed and turned into overrides, ready to store on a project. */
export async function likeReference(file: string, log: (m: string) => void = () => {}) {
  const ref = await analyzeReference(file, log);
  const { overrides, why } = overridesFrom(ref);
  for (const w of why) log(`[référence] ${w}`);
  return { overrides, why, sheet: ref.sheet, reference: { file: ref.file, report: join(ref.dir, "report.json") } };
}

/**
 * The QA energy check (Katana's `energy.py check`, locally): the render's cut and effect rates against the
 * reference's. Our cuts follow speech, so only a clear gap is reported.
 */
export function compareEnergy(ref: Pick<ReferenceReport, "per10s">, ours: Pick<ReferenceReport, "per10s">): string[] {
  const out: string[] = [];
  const fr = (x: number) => x.toFixed(1).replace(".", ",");
  const accents = (p: ReferenceReport["per10s"]) => p.flashes + p.strobes + p.punches + p.ladders + p.shakes + p.whips;
  const pairs: [string, number, number][] = [["coupes", ours.per10s.cuts, ref.per10s.cuts], ["effets", accents(ours.per10s), accents(ref.per10s)]];
  for (const [what, o, r] of pairs) {
    if (r >= 0.5 && o < r * 0.6) out.push(`Énergie : ${fr(o)} ${what} par 10 s contre ${fr(r)} dans la référence — montage plus calme qu'elle.`);
    else if (o > Math.max(1, r * 1.7)) out.push(`Énergie : ${fr(o)} ${what} par 10 s contre ${fr(r)} dans la référence — montage plus chargé qu'elle.`);
  }
  return out;
}
