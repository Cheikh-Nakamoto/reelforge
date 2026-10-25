import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { run } from "./exec.js";
import { readJson, writeJson } from "./project.js";

/**
 * Measured shape of each sound effect, so a cue places the sound by its attack (or a whoosh by its peak) rather than
 * by the start of the file: library files open with 0–300 ms of silence or swell, which used to land every sound
 * late by that much. Levels let one category play at one loudness whatever file the rotation picks.
 */
export interface SfxInfo {
  /** Seconds from the file start to the attack: the first 10 ms window within 20 dB of the loudest one. */
  onset: number;
  /** Seconds from the file start to the loudest 10 ms window. */
  peak: number;
  /** RMS level of the loudest 10 ms window, dBFS. */
  level: number;
  duration: number;
  /** size:mtime of the measured file: a changed file is measured again. */
  stamp: string;
}

const WINDOW = 0.01;
const AUDIO_EXT = /\.(wav|mp3|m4a|aac|flac|ogg|opus)$/i;
const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** Per-window RMS levels (dBFS) from `astats … ametadata=print` output; silence reads as −120. */
export function parseWindows(stdout: string): number[] {
  return [...stdout.matchAll(/Overall\.RMS_level=(-?inf|-?[\d.]+)/g)].map((m) => (m[1].endsWith("inf") ? -120 : Number(m[1])));
}

/** Attack, peak and level from 10 ms RMS windows. */
export function shapeOf(rms: number[]): Pick<SfxInfo, "onset" | "peak" | "level"> {
  if (!rms.length) return { onset: 0, peak: 0, level: -120 };
  let p = 0;
  rms.forEach((v, i) => {
    if (v > rms[p]) p = i;
  });
  const onset = rms.findIndex((v) => v >= rms[p] - 20);
  return { onset: r3(onset * WINDOW), peak: r3(p * WINDOW), level: Math.round(rms[p] * 10) / 10 };
}

export async function measureSfx(file: string): Promise<Omit<SfxInfo, "stamp">> {
  const { stdout } = await run("ffmpeg", [
    "-v", "error", "-i", file, "-af",
    `aformat=channel_layouts=mono,aresample=48000,asetnsamples=n=${48000 * WINDOW}:p=0,astats=metadata=1:reset=1,` +
      "ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-",
    "-f", "null", "-",
  ]);
  const rms = parseWindows(stdout);
  return { ...shapeOf(rms), duration: r3(rms.length * WINDOW) };
}

const stampOf = (file: string) => {
  const st = statSync(file);
  return `${st.size}:${Math.round(st.mtimeMs)}`;
};

/** Every sound under `dir` (one folder per kind), keyed "kind/file", cached in `dir`/catalog.json. */
export async function sfxCatalog(dir: string): Promise<Record<string, SfxInfo>> {
  if (!existsSync(dir)) return {};
  const path = join(dir, "catalog.json");
  const old: Record<string, SfxInfo> = existsSync(path) ? readJson(path) : {};
  const out: Record<string, SfxInfo> = {};
  let changed = false;
  for (const kind of readdirSync(dir).filter((k) => statSync(join(dir, k)).isDirectory())) {
    for (const f of readdirSync(join(dir, kind)).filter((x) => AUDIO_EXT.test(x)).sort()) {
      const file = join(dir, kind, f);
      const key = relative(dir, file);
      const stamp = stampOf(file);
      if (old[key]?.stamp === stamp) out[key] = old[key];
      else {
        out[key] = { ...(await measureSfx(file)), stamp };
        changed = true;
      }
    }
  }
  if (changed || Object.keys(old).length !== Object.keys(out).length) writeJson(path, out);
  return out;
}

/** Median loudest-window level of each kind: the level a rotation of that kind is brought to. */
export function kindLevels(catalog: Record<string, SfxInfo>): Record<string, number> {
  const by: Record<string, number[]> = {};
  for (const [key, info] of Object.entries(catalog)) (by[key.split("/")[0]] ??= []).push(info.level);
  return Object.fromEntries(Object.entries(by).map(([k, v]) => {
    const s = [...v].sort((a, b) => a - b);
    return [k, s[Math.floor(s.length / 2)]];
  }));
}
