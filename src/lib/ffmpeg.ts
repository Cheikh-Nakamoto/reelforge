import { spawn } from "node:child_process";
import { run } from "./exec.js";

export interface Probe {
  duration: number;
  width: number;
  height: number;
  /** Display rotation in degrees from the displaymatrix side data (0, 90, 180, 270). */
  rotation: number;
  fps: number;
  hasAudio: boolean;
  videoCodec: string;
}

export async function ffprobe(file: string): Promise<Probe> {
  const { stdout } = await run("ffprobe", [
    "-v", "error", "-show_format", "-show_streams", "-of", "json", file,
  ]);
  const j = JSON.parse(stdout);
  const v = j.streams.find((s: any) => s.codec_type === "video");
  if (!v) throw new Error(`${file}: no video stream`);
  const [n, d] = String(v.avg_frame_rate || v.r_frame_rate).split("/").map(Number);
  let rotation = 0;
  for (const sd of v.side_data_list ?? []) if (typeof sd.rotation === "number") rotation = sd.rotation;
  if (v.tags?.rotate) rotation = Number(v.tags.rotate);
  rotation = ((Math.round(rotation) % 360) + 360) % 360;
  return {
    duration: Number(j.format.duration),
    width: v.width,
    height: v.height,
    rotation,
    fps: d ? n / d : n,
    hasAudio: j.streams.some((s: any) => s.codec_type === "audio"),
    videoCodec: v.codec_name,
  };
}

export interface Silence {
  start: number;
  end: number;
}

export interface Loudness {
  integrated: number;
  truePeak: number;
  lra: number;
}

/** EBU R128 measurement of a file's audio. */
export async function measureLoudness(file: string): Promise<Loudness> {
  const { stderr } = await run("ffmpeg", [
    "-hide_banner", "-nostats", "-i", file, "-af", "ebur128=peak=true", "-f", "null", "-",
  ]);
  const summary = stderr.slice(stderr.lastIndexOf("Summary:"));
  const num = (re: RegExp) => Number(re.exec(summary)?.[1] ?? NaN);
  return {
    integrated: num(/I:\s+(-?[\d.]+) LUFS/),
    truePeak: num(/Peak:\s+(-?[\d.]+) dBFS/),
    lra: num(/LRA:\s+(-?[\d.]+) LU/),
  };
}

export interface SilenceAnalysis {
  silences: Silence[];
  /** Threshold used, noise floor (10th percentile) and speech level (90th percentile), in dB. */
  threshold: number;
  floor: number;
  speech: number;
}

/**
 * Pauses measured against the rush's own noise floor. A fixed threshold fails on real phone recordings: room noise
 * sat at −32 to −42 dB on the first real rushes, only 10–16 dB under the voice, so `silencedetect=-35dB` found no
 * pause at all. Here the threshold sits a third of the way from the floor (10th percentile of 50 ms RMS windows)
 * to the voice (90th percentile), and a 3-window median smooths out clicks and breaths. A number forces the threshold.
 */
export async function findSilences(wav: string, minDur: number, threshold: number | "auto" = "auto"): Promise<SilenceAnalysis> {
  const win = 0.05;
  const env = await rmsEnvelope(wav, win);
  const sorted = env.filter((x) => x > -100).sort((a, b) => a - b);
  const q = (f: number) => (sorted.length ? sorted[Math.floor(f * (sorted.length - 1))] : -60);
  const floor = q(0.1), speech = q(0.9);
  const thr = threshold === "auto" ? floor + Math.max(3, (speech - floor) / 3) : threshold;
  const smooth = env.map((_, i) => {
    const w = [env[i - 1] ?? env[i], env[i], env[i + 1] ?? env[i]].sort((a, b) => a - b);
    return w[1];
  });
  const silences: Silence[] = [];
  let start = -1;
  smooth.forEach((v, i) => {
    if (v < thr && start < 0) start = i;
    if ((v >= thr || i === smooth.length - 1) && start >= 0) {
      const end = v >= thr ? i : i + 1;
      if ((end - start) * win >= minDur) silences.push({ start: start * win, end: end === smooth.length ? Infinity : end * win });
      start = -1;
    }
  });
  const r = (x: number) => Math.round(x * 10) / 10;
  return { silences, threshold: r(thr), floor: r(floor), speech: r(speech) };
}

/** Per-window RMS level in dB, used to score how strongly a word is spoken. */
export async function rmsEnvelope(wav: string, windowSec = 0.05): Promise<number[]> {
  const buf = await readPcm(wav);
  const win = Math.round(16000 * windowSec);
  const out: number[] = [];
  for (let i = 0; i + win <= buf.length; i += win) {
    let sum = 0;
    for (let j = i; j < i + win; j++) sum += buf[j] * buf[j];
    out.push(10 * Math.log10(sum / win + 1e-12));
  }
  return out;
}

/** Raw binary stdout of a command (run() decodes stdout as text). */
export function runBinary(cmd: string, args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let err = "";
    p.stdout.on("data", (d) => chunks.push(d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (code) =>
      code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`${cmd} failed: ${err.slice(-800)}`)),
    );
  });
}

async function readPcm(file: string): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    const p = spawn("ffmpeg", ["-v", "error", "-i", file, "-ac", "1", "-ar", "16000", "-f", "f32le", "-"]);
    const chunks: Buffer[] = [];
    p.stdout.on("data", (d) => chunks.push(d));
    p.on("error", reject);
    p.on("close", (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg pcm decode failed for ${file}`));
      const b = Buffer.concat(chunks);
      resolve(new Float32Array(b.buffer, b.byteOffset, Math.floor(b.length / 4)));
    });
  });
}
