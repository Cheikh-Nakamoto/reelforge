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

/** Silences quieter than `noiseDb` lasting at least `minDur` seconds. */
export async function silencedetect(file: string, noiseDb: number, minDur: number): Promise<Silence[]> {
  const { stderr } = await run("ffmpeg", [
    "-hide_banner", "-nostats", "-i", file, "-af", `silencedetect=noise=${noiseDb}dB:d=${minDur}`, "-f", "null", "-",
  ]);
  const out: Silence[] = [];
  let start: number | null = null;
  for (const line of stderr.split("\n")) {
    const s = /silence_start: (-?[\d.]+)/.exec(line);
    if (s) start = Math.max(0, Number(s[1]));
    const e = /silence_end: ([\d.]+)/.exec(line);
    if (e && start !== null) {
      out.push({ start, end: Number(e[1]) });
      start = null;
    }
  }
  if (start !== null) out.push({ start, end: Infinity });
  return out;
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
