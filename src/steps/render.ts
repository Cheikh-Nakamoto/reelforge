import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { hyperframes, run } from "../lib/exec.js";
import { cached, Project, readJson, ROOT, STEPS, writeJson, type StepManifest, codeOf } from "../lib/project.js";
import { STYLES_DIR } from "../lib/style.js";
import type { Format } from "./html.js";

export interface RenderOptions {
  formats?: Format["id"][];
  quality?: "draft" | "standard" | "high";
  force?: boolean;
  onProgress?: (line: string) => void;
}

export const STUDIO_VERSION: string = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
const HYPERFRAMES_VERSION: string = JSON.parse(
  readFileSync(join(ROOT, "node_modules", "hyperframes", "package.json"), "utf8"),
).version;

/**
 * Container tag on every export. Plain metadata (no pixel changes, strippable with `-map_metadata -1`): it says
 * which tool and licence produced the file, so a published video can be traced back to the project's terms.
 */
export const PROVENANCE = `Edited with studio ${STUDIO_VERSION} (PolyForm Noncommercial 1.0.0; commercial use needs a licence, see COMMERCIAL.md)`;

/** Render each composed format with HyperFrames (silent picture), then mux the mastered mix. */
export async function render(project: Project, opts: RenderOptions = {}) {
  const formats = opts.formats ?? ["16x9", "9x16"];
  const quality = opts.quality ?? "standard";
  const mix = project.path("audio", "mix.wav");
  const outputs = formats.map((f) => project.path("render", `${project.name}_${f}.mp4`));
  const sources = formats.map((f) => join(project.stepDir("compose"), f, "index.html"));
  for (const s of sources) if (!existsSync(s)) throw new Error(`Not composed yet: ${s}`);
  const receiptPath = project.path("render", "receipt.json");

  const res = await cached(project, "render", {
    code: codeOf(import.meta.url),
    inputs: [mix, ...sources],
    params: { formats, quality },
    version: 2,
    outputs: [...outputs, receiptPath],
    force: opts.force,
  }, async () => {
    for (const [i, f] of formats.entries()) {
      const dir = join(project.stepDir("compose"), f);
      const picture = project.path("render", `picture_${f}.mp4`);
      opts.onProgress?.(`render ${f}…`);
      await hyperframes(["render", "--output", picture, "--quality", quality], {
        cwd: dir,
        onStderr: (s) => opts.onProgress?.(s.trim().split("\n").pop() ?? ""),
      });
      await run("ffmpeg", [
        "-v", "error", "-y", "-i", picture, "-i", mix, "-map", "0:v:0", "-map", "1:a:0",
        "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-shortest",
        "-movflags", "+faststart", "-map_metadata", "-1",
        "-metadata", `comment=${PROVENANCE}`, "-metadata", "encoder=studio", outputs[i],
      ]);
    }
    writeJson(receiptPath, await receipt(project, outputs, quality));
  });
  return { ...res, outputs: Object.fromEntries(formats.map((f, i) => [f, outputs[i]])), receipt: receiptPath };
}

const sha1 = (file: string) => createHash("sha1").update(readFileSync(file)).digest("hex");

/** What produced these files: tool and model versions, style, parameters and time spent per step. */
async function receipt(project: Project, outputs: string[], quality: string) {
  const meta = project.meta;
  const steps: Record<string, unknown> = {};
  for (const s of STEPS) {
    const mf = join(project.dir, `${String(STEPS.indexOf(s) + 1).padStart(2, "0")}-${s}`, "manifest.json");
    if (!existsSync(mf)) continue;
    const m = readJson<Partial<StepManifest>>(mf);
    if (m.key) steps[s] = { params: m.params, seconds: m.seconds, finishedAt: m.finishedAt };
  }
  const ffmpeg = (await run("ffmpeg", ["-version"])).stdout.split("\n")[0];
  const styleFile = join(STYLES_DIR, `${meta.style}.yaml`);
  return {
    studio: STUDIO_VERSION,
    licence: "PolyForm-Noncommercial-1.0.0",
    hyperframes: HYPERFRAMES_VERSION,
    ffmpeg,
    source: meta.source,
    style: { name: meta.style, sha1: existsSync(styleFile) ? sha1(styleFile) : null },
    quality,
    outputs: outputs.map((o) => ({ file: o, sha1: sha1(o) })),
    steps,
    renderedAt: new Date().toISOString(),
  };
}
