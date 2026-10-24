import { run } from "../lib/exec.js";
import type { Style } from "../lib/style.js";

/**
 * Colour looks as FFmpeg filters, baked once into the footage, the cutout and the blurred plate.
 *
 * HyperFrames can grade in the browser (`data-color-grading`), but without a GPU that costs every frame of every
 * video layer: 962 s instead of 180 s for a 17 s vertical render on a 4-core laptop. Baked here it is one FFmpeg
 * pass. The same chain on every layer keeps the cutout pixel-identical to the footage it covers.
 *
 * Grain is not baked: per-frame noise is incompressible (a 20 s clip grew from 16 MB to 358 MB and rendered 2.5x
 * slower). It is a texture overlay in the composition instead, see `grainTexture` and html.ts.
 */
const PRESETS: Record<string, { contrast?: number; saturation?: number; brightness?: number; gamma?: number; balance?: string; mono?: boolean }> = {
  "deep-contrast": { contrast: 1.18, saturation: 0.92, gamma: 0.97, balance: "rh=0.03:bh=-0.03:rs=-0.02:bs=0.03" },
  "clean-studio": { contrast: 1.05, saturation: 1.04, brightness: 0.015 },
  "bright-pop": { contrast: 1.1, saturation: 1.3, brightness: 0.02 },
  "muted-editorial": { contrast: 1.05, saturation: 0.75 },
  "warm-daylight": { saturation: 1.05, balance: "rm=0.05:bm=-0.05:rh=0.03:bh=-0.03" },
  "mono-clean": { contrast: 1.1, mono: true },
};

export const LOOK_PRESETS = Object.keys(PRESETS);

/** The FFmpeg video filter chain of a style's look, or null when the look is neutral. */
export function lookFilter(style: Style): string | null {
  const l = style.look;
  const parts: string[] = [];
  if (l.grade !== "none") {
    const p = PRESETS[l.grade];
    if (!p) throw new Error(`Unknown look.grade "${l.grade}". Available: none, ${LOOK_PRESETS.join(", ")}`);
    const k = l.gradeIntensity;
    // Intensity blends each parameter between neutral and the preset.
    const mix = (v: number | undefined, neutral: number) => (v === undefined ? neutral : neutral + (v - neutral) * k);
    if (p.mono) parts.push(`hue=s=${(1 - k).toFixed(3)}`);
    parts.push(
      `eq=contrast=${mix(p.contrast, 1).toFixed(3)}:saturation=${mix(p.saturation, 1).toFixed(3)}` +
        `:brightness=${mix(p.brightness, 0).toFixed(3)}:gamma=${mix(p.gamma, 1).toFixed(3)}`,
    );
    if (p.balance) {
      const scaled = p.balance.replace(/(-?[\d.]+)/g, (n) => (Number(n) * k).toFixed(3));
      parts.push(`colorbalance=${scaled}`);
    }
  }
  if (l.vignette > 0) parts.push(`vignette=angle=${(0.15 + 0.55 * l.vignette).toFixed(3)}`);
  return parts.length ? parts.join(",") : null;
}

/** A 512 px grey noise tile (fixed seed) for the grain overlay. */
export async function grainTexture(output: string): Promise<void> {
  await run("ffmpeg", [
    "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=gray:s=512x512:d=1",
    "-vf", "noise=alls=60:allf=u:all_seed=7,format=gray", "-frames:v", "1", output,
  ]);
}

/** Grade opaque footage. */
export async function gradeVideo(input: string, output: string, filter: string): Promise<void> {
  await run("ffmpeg", [
    "-v", "error", "-y", "-i", input, "-vf", `${filter},format=yuv420p`,
    "-c:v", "libx264", "-preset", "medium", "-crf", "15", "-c:a", "copy", "-movflags", "+faststart", output,
  ]);
}

/** Grade the colour of a transparent VP9 cutout and keep its alpha untouched. */
export async function gradeCutout(input: string, output: string, filter: string): Promise<void> {
  await run("ffmpeg", [
    "-v", "error", "-y", "-c:v", "libvpx-vp9", "-i", input,
    "-filter_complex", `[0:v]format=yuva420p,split[c][a];[a]alphaextract[al];[c]${filter}[g];[g][al]alphamerge,format=yuva420p[out]`,
    "-map", "[out]", "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-crf", "16", "-b:v", "0", "-auto-alt-ref", "0",
    "-deadline", "good", "-cpu-used", "4", "-row-mt", "1", output,
  ]);
}
