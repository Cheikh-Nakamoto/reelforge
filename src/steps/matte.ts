import { existsSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { hyperframes, run } from "../lib/exec.js";
import { ffprobe, runBinary } from "../lib/ffmpeg.js";
import { streamGrayFrames } from "../lib/frames.js";
import { cached, Project, readJson, writeJson } from "../lib/project.js";

export interface Range {
  start: number;
  end: number;
  score: number;
}

export interface Box {
  t: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Where the subject is, from a 1 fps pass: enough to frame the shot and place text. */
export interface MatteSurvey {
  fps: number;
  /** Subject box in normalized coordinates (5th–95th percentile over time). */
  bbox: { x0: number; y0: number; x1: number; y1: number };
  /** Median horizontal centre and median top of the head, normalized. */
  centerX: number;
  headTop: number;
  /** Share of sampled frames where a person was found. */
  presence: number;
  track: Box[];
}

/** Full-rate matte of one time window (cut-timeline seconds) and its stability. */
export interface MatteWindow {
  start: number;
  end: number;
  file: string;
  verdict: "ok" | "flicker" | "lost";
  flicker: Range[];
  lost: Range[];
  meanOscillation: number;
  seconds: number;
}

export interface MatteReport extends MatteSurvey {
  windows: MatteWindow[];
  /** Ranges where the matte must not be used (from the windows' analysis). */
  flicker: Range[];
  lost: Range[];
  /** "bad": no person found reliably; "degraded": some windows rejected; "ok". */
  verdict: "ok" | "degraded" | "bad";
  flaggedShare: number;
  thresholds: { oscillation: number; minRun: number };
}

const OSC_THRESHOLD = 0.06;
const MIN_RUN = 3;

/**
 * Step 4a — survey. Matte a 1 fps copy of the cut (u2net_human_seg via `hyperframes remove-background`, CPU):
 * ~1 s of compute per second of video instead of ~30, and it tells compose where the head is.
 */
export async function matteSurvey(project: Project, opts: { force?: boolean } = {}) {
  const src = project.path("cut", "cut.mp4");
  const sampled = project.path("matte", "survey.mp4");
  const cutout = project.path("matte", "survey.webm");
  const reportPath = project.path("matte", "matte.json");
  const preview = project.path("matte", "matte-preview.png");
  const res = await cached(project, "matte", {
    inputs: [src],
    params: { survey: 1 },
    version: 2,
    outputs: [reportPath, preview],
    force: opts.force,
  }, async () => {
    await run("ffmpeg", ["-v", "error", "-y", "-i", src, "-an", "-vf", "fps=1", "-c:v", "libx264", "-crf", "14", "-pix_fmt", "yuv420p", sampled]);
    await hyperframes(["remove-background", sampled, "-o", cutout, "--quality", "fast", "--device", "auto"]);
    const survey = await analyzeSurvey(src, cutout);
    const report: MatteReport = {
      ...survey,
      windows: [],
      flicker: [],
      lost: [],
      verdict: survey.presence < 0.6 ? "bad" : "ok",
      flaggedShare: 0,
      thresholds: { oscillation: OSC_THRESHOLD, minRun: MIN_RUN },
    };
    writeJson(reportPath, report);
    await mattePreview(cutout, preview);
  });
  return { ...res, report: readJson<MatteReport>(reportPath), preview };
}

async function analyzeSurvey(src: string, cutout: string): Promise<MatteSurvey> {
  const probe = await ffprobe(src);
  const W = 128;
  const H = Math.round((W * probe.height) / probe.width / 2) * 2;
  const boxes: Box[] = [];
  await streamGrayFrames(cutout, "alphaextract", W, H, (a, i) => {
    boxes.push({ t: i, ...bboxOf(a, W, H) });
  }, ["-c:v", "libvpx-vp9"]);
  const present = boxes.filter((b) => b.x1 > b.x0);
  return {
    fps: 1,
    bbox: {
      x0: round(pct(present.map((b) => b.x0), 0.05)),
      y0: round(pct(present.map((b) => b.y0), 0.05)),
      x1: round(pct(present.map((b) => b.x1), 0.95)),
      y1: round(pct(present.map((b) => b.y1), 0.95)),
    },
    centerX: round(pct(present.map((b) => (b.x0 + b.x1) / 2), 0.5) || 0.5),
    headTop: round(pct(present.map((b) => b.y0), 0.5)),
    presence: round(present.length / Math.max(1, boxes.length)),
    track: boxes.map((b) => ({ t: b.t, x0: round(b.x0), y0: round(b.y0), x1: round(b.x1), y1: round(b.y1) })),
  };
}

function bboxOf(a: Uint8Array, W: number, H: number) {
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let i = 0; i < a.length; i++) {
    if (a[i] > 127) {
      const x = i % W, y = (i / W) | 0;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? { x0: 0, y0: 0, x1: 0, y1: 0 } : { x0: x0 / W, y0: y0 / H, x1: (x1 + 1) / W, y1: (y1 + 1) / H };
}

/**
 * Step 4b — full-rate matte of one window (cached per window). A clean matte moves smoothly, so each alpha frame sits
 * close to the mean of its neighbours; a flickering one oscillates. Frames above the threshold group into ranges.
 */
export async function matteWindow(project: Project, start: number, end: number): Promise<MatteWindow> {
  const src = project.path("cut", "cut.mp4");
  const { fps } = await ffprobe(src);
  const snap = (t: number) => Math.max(0, Math.round(t * fps) / fps);
  const s = snap(start), e = snap(end);
  const dir = join(project.stepDir("matte"), "windows");
  mkdirSync(dir, { recursive: true });
  const key = `${s.toFixed(3)}-${e.toFixed(3)}`;
  const meta = join(dir, `${key}.json`);
  // A window is only valid for the cut it was matted from: a new cut plan moves different frames to these times.
  const st = statSync(src);
  const source = `${st.size}:${st.mtimeMs}`;
  if (existsSync(meta)) {
    const prev = readJson<MatteWindow & { source?: string }>(meta);
    if (prev.source === source) return prev;
  }

  const t0 = Date.now();
  const clip = join(dir, `${key}.mp4`);
  const file = join(dir, `${key}.webm`);
  await run("ffmpeg", [
    "-v", "error", "-y", "-ss", s.toFixed(3), "-i", src, "-t", (e - s).toFixed(3), "-an",
    "-c:v", "libx264", "-crf", "12", "-pix_fmt", "yuv420p", clip,
  ]);
  await hyperframes(["remove-background", clip, "-o", file, "--quality", "best", "--device", "auto"]);
  const a = await analyzeStability(clip, file);
  const shift = (r: Range) => ({ ...r, start: round(r.start + s), end: round(r.end + s) });
  const win: MatteWindow = {
    start: s,
    end: e,
    file,
    verdict: a.lost.length ? "lost" : a.flicker.length ? "flicker" : "ok",
    flicker: a.flicker.map(shift),
    lost: a.lost.map(shift),
    meanOscillation: a.meanOscillation,
    seconds: Math.round((Date.now() - t0) / 100) / 10,
  };
  writeJson(meta, { ...win, source });
  return win;
}

async function analyzeStability(src: string, cutout: string) {
  const probe = await ffprobe(src);
  const fps = probe.fps;
  const W = 128;
  const H = Math.round((W * probe.height) / probe.width / 2) * 2;
  const N = W * H;
  const osc: number[] = [];
  const area: number[] = [];
  let a2: Uint8Array | null = null;
  let a1: Uint8Array | null = null;
  await streamGrayFrames(cutout, "alphaextract", W, H, (a0) => {
    let on = 0;
    for (let i = 0; i < N; i++) if (a0[i] > 127) on++;
    area.push(on / N);
    if (a2 && a1) {
      let sum = 0, cnt = 0;
      for (let i = 0; i < N; i++) {
        const p = a2[i], c = a1[i], n = a0[i];
        if (p > 25 || c > 25 || n > 25) {
          sum += Math.abs(c - (p + n) / 2);
          cnt++;
        }
      }
      osc.push(cnt ? sum / cnt / 255 : 0);
    } else if (a1) osc.push(0);
    a2 = a1;
    a1 = a0;
  }, ["-c:v", "libvpx-vp9"]);
  osc.push(0);
  return {
    flicker: groupRanges(osc.map((o) => o > OSC_THRESHOLD), osc, fps),
    lost: groupRanges(area.map((x, i) => x < 0.01 && (area[i - 1] ?? 0) > 0.03), area.map((x) => 1 - x), fps, 1),
    meanOscillation: round(osc.reduce((s, o) => s + o, 0) / Math.max(1, osc.length)),
  };
}

/**
 * One full-length transparent subject.webm with each window's matte at its own time, so the composition mounts the
 * cutout at data-start=0 alongside the footage (a late-mounted cutout lands a frame off).
 */
export async function assembleSubject(project: Project, windows: MatteWindow[]): Promise<string | null> {
  const out = project.path("matte", "subject.webm");
  const usable = windows.filter((w) => w.verdict === "ok").sort((a, b) => a.start - b.start);
  const sig = project.path("matte", "subject.json");
  // Times and the window files themselves: a re-matted window (new cut) must rebuild the assembly.
  const key = usable.map((w) => `${w.start}-${w.end}@${statSync(w.file).mtimeMs}`).join(",");
  if (!usable.length) return null;
  if (existsSync(out) && existsSync(sig) && readJson<{ key: string }>(sig).key === key) return out;

  const src = project.path("cut", "cut.mp4");
  const p = await ffprobe(src);
  const inputs: string[] = [
    "-f", "lavfi", "-i", `color=c=black@0.0:s=${p.width}x${p.height}:r=${p.fps}:d=${p.duration.toFixed(3)},format=yuva420p`,
  ];
  const chain: string[] = [];
  let last = "[0:v]";
  usable.forEach((w, i) => {
    inputs.push("-c:v", "libvpx-vp9", "-i", w.file);
    chain.push(`[${i + 1}:v]format=yuva420p,setpts=PTS-STARTPTS+${w.start.toFixed(3)}/TB[w${i}]`);
    chain.push(`${last}[w${i}]overlay=eof_action=pass:format=auto[o${i}]`);
    last = `[o${i}]`;
  });
  chain.push(`${last}format=yuva420p[out]`);
  await run("ffmpeg", [
    "-v", "error", "-y", ...inputs, "-filter_complex", chain.join(";"), "-map", "[out]",
    "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-crf", "16", "-b:v", "0", "-auto-alt-ref", "0",
    "-deadline", "good", "-cpu-used", "4", "-row-mt", "1", "-t", p.duration.toFixed(3), out,
  ]);
  writeJson(sig, { key });
  return out;
}

/** The cutout's alpha at time t, scaled to w×h (gray bytes). */
export async function alphaMask(file: string, t: number, w: number, h: number) {
  const data = await runBinary("ffmpeg", [
    "-v", "error", "-c:v", "libvpx-vp9", "-ss", t.toFixed(3), "-i", file, "-frames:v", "1",
    "-vf", `alphaextract,scale=${w}:${h}:flags=area,format=gray`, "-f", "rawvideo", "-pix_fmt", "gray", "-",
  ]);
  return { w, h, data: new Uint8Array(data.subarray(0, w * h)) };
}

/** Record the windows (and their rejected ranges) in matte.json. */
export function recordWindows(project: Project, windows: MatteWindow[]): MatteReport {
  const path = project.path("matte", "matte.json");
  const report = readJson<MatteReport>(path);
  report.windows = windows;
  report.flicker = windows.flatMap((w) => w.flicker);
  report.lost = windows.flatMap((w) => w.lost);
  const total = windows.reduce((s, w) => s + (w.end - w.start), 0);
  const bad = [...report.flicker, ...report.lost].reduce((s, r) => s + (r.end - r.start), 0);
  report.flaggedShare = round(total ? bad / total : 0);
  if (report.verdict !== "bad") report.verdict = windows.some((w) => w.verdict !== "ok") ? "degraded" : "ok";
  writeJson(path, report);
  return report;
}

/** Consecutive flagged frames (gaps under 0.3 s bridged) of at least `minRun` frames, as time ranges. */
function groupRanges(flags: boolean[], score: number[], fps: number, minRun = MIN_RUN): Range[] {
  const out: Range[] = [];
  const bridge = Math.round(0.3 * fps);
  let i = 0;
  while (i < flags.length) {
    if (!flags[i]) {
      i++;
      continue;
    }
    let j = i, last = i, count = 0, peak = 0;
    while (j < flags.length && j - last <= bridge) {
      if (flags[j]) {
        last = j;
        count++;
        peak = Math.max(peak, score[j]);
      }
      j++;
    }
    if (count >= minRun) out.push({ start: round(i / fps), end: round((last + 1) / fps), score: round(peak) });
    i = last + 1;
  }
  return out;
}

/** Contact sheet of the 1 fps cutout over magenta, to judge edges by eye. */
async function mattePreview(cutout: string, out: string): Promise<void> {
  const p = await ffprobe(cutout).catch(() => null);
  const n = Math.max(1, Math.round(p?.duration ?? 12));
  const cols = 6;
  const rows = Math.ceil(n / cols);
  await run("ffmpeg", [
    "-v", "error", "-y", "-c:v", "libvpx-vp9", "-i", cutout,
    "-filter_complex",
    `color=c=0xff00ff:s=16x16[bg];[0:v]scale=240:-2[fg];[bg][fg]scale2ref[bg2][fg2];` +
      `[bg2][fg2]overlay=format=auto:shortest=1,tile=${cols}x${rows}:padding=4:color=white`,
    "-frames:v", "1", out,
  ]);
}

const pct = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : 0;
};
const round = (x: number) => Math.round(x * 1000) / 1000;
