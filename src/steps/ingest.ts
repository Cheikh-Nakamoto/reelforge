import { copyFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { run } from "../lib/exec.js";
import { ffprobe, type Probe } from "../lib/ffmpeg.js";
import { cached, Project, readJson, writeJson } from "../lib/project.js";

export interface IngestResult {
  probe: Probe;
  /** Probe of the normalized source.mp4. */
  normalized: Probe;
}

export interface IngestOptions {
  fps?: number;
  /** Longest side cap: 4K rushes are scaled down, matting at 4K costs 4x for no visible gain. */
  maxSide?: number;
  force?: boolean;
}

/**
 * Normalize the rush: rotation baked in (ffmpeg autorotates on decode and drops the display matrix on encode),
 * constant frame rate, long side capped, AAC 48 kHz. Also extracts the 16 kHz mono WAV used by analysis.
 */
export async function ingest(project: Project, source: string, opts: IngestOptions = {}) {
  const src = resolve(source);
  if (!existsSync(src)) throw new Error(`Source not found: ${src}`);
  const fps = opts.fps ?? 30;
  const maxSide = opts.maxSide ?? 1920;
  const out = project.path("ingest", "source.mp4");
  const wav = project.path("ingest", "audio16k.wav");
  const info = project.path("ingest", "probe.json");

  const res = await cached(project, "ingest", {
    inputs: [src],
    params: { fps, maxSide },
    version: 1,
    outputs: [out, wav, info],
    force: opts.force,
  }, async () => {
    const probe = await ffprobe(src);
    if (!probe.hasAudio) throw new Error(`${src}: no audio stream — a face-cam rush needs its voice track`);
    const rotated = probe.rotation === 90 || probe.rotation === 270;
    const w = rotated ? probe.height : probe.width;
    const h = rotated ? probe.width : probe.height;
    const scale = Math.min(1, maxSide / Math.max(w, h));
    // Even dimensions for yuv420p.
    const ow = Math.round((w * scale) / 2) * 2;
    const oh = Math.round((h * scale) / 2) * 2;
    await run("ffmpeg", [
      "-v", "error", "-y", "-i", src,
      "-vf", `scale=${ow}:${oh}:flags=lanczos,fps=${fps},format=yuv420p,setsar=1`,
      "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-g", String(fps),
      "-c:a", "aac", "-b:a", "256k", "-ar", "48000",
      "-movflags", "+faststart", "-map_metadata", "-1", out,
    ]);
    await run("ffmpeg", ["-v", "error", "-y", "-i", out, "-vn", "-ac", "1", "-ar", "16000", wav]);
    const normalized = await ffprobe(out);
    writeJson(info, { probe, normalized } satisfies IngestResult);
  });
  return { ...res, result: readJson<IngestResult>(info), source: out, wav };
}

/** Copy of the rush kept next to the project, so a moved original does not break re-runs. */
export function keepOriginal(project: Project, source: string): string {
  const dst = project.path("ingest", "original" + source.slice(source.lastIndexOf(".")));
  if (!existsSync(dst)) copyFileSync(source, dst);
  return dst;
}
