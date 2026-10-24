import { existsSync, writeFileSync } from "node:fs";
import { run } from "../lib/exec.js";
import { silencedetect } from "../lib/ffmpeg.js";
import { cached, invalidateFrom, Project, readJson, writeJson } from "../lib/project.js";
import type { Style } from "../lib/style.js";
import type { Word } from "../lib/words.js";
import type { IngestResult } from "./ingest.js";
import { makePlan, planMarkdown, remapWords, type CutParams, type CutPlan } from "./cutplan.js";

export interface ProposeOptions {
  remove?: string[];
  restore?: string[];
  /** Overrides of the style's rhythm settings. */
  minPause?: number;
  keep?: number;
}

/** Build (or rebuild with reviewer edits) the cut plan. Never touches video: cheap, re-run freely. */
export async function proposeCut(project: Project, style: Style, opts: ProposeOptions = {}) {
  const words = readJson<Word[]>(project.path("transcribe", "words.json"));
  const { normalized } = readJson<IngestResult>(project.path("ingest", "probe.json"));
  const planPath = project.path("cut", "cutplan.json");
  // Edits accumulate: a second propose with `remove: [w9]` keeps the first call's removals.
  const prev: CutParams | undefined = existsSync(planPath) ? readJson<CutPlan>(planPath).params : undefined;
  const merge = (a: string[] = [], b: string[] = [], drop: string[] = []) =>
    [...new Set([...a, ...b])].filter((id) => !drop.includes(id));
  const params: CutParams = {
    minPause: opts.minPause ?? prev?.minPause ?? style.rhythm.minPause,
    keep: opts.keep ?? prev?.keep ?? style.rhythm.keep,
    removeFillers: style.rhythm.removeFillers,
    removeRetakes: style.rhythm.removeRetakes,
    remove: merge(prev?.remove, opts.remove, opts.restore),
    restore: merge(prev?.restore, opts.restore, opts.remove),
  };
  const silences = await silencedetect(project.path("ingest", "audio16k.wav"), style.rhythm.silenceDb, 0.2);
  const plan = makePlan(words, silences, normalized.duration, params);
  writeJson(planPath, plan);
  const md = planMarkdown(plan);
  writeFileSync(project.path("cut", "cutplan.md"), md);
  invalidateFrom(project, "cut");
  return { plan, markdown: md, path: planPath };
}

/** Render cut.mp4 from the plan and re-time the transcript onto it. Marks the plan approved. */
export async function applyCut(project: Project, opts: { force?: boolean } = {}) {
  const planPath = project.path("cut", "cutplan.json");
  if (!existsSync(planPath)) throw new Error("No cut plan yet: run cut propose first");
  const plan = readJson<CutPlan>(planPath);
  if (!plan.keep.length) throw new Error("The cut plan keeps nothing");
  const src = project.path("ingest", "source.mp4");
  const { normalized } = readJson<IngestResult>(project.path("ingest", "probe.json"));
  const out = project.path("cut", "cut.mp4");
  const wordsOut = project.path("cut", "words.json");
  const fps = Math.round(normalized.fps) || 30;

  // Snap to the frame grid so audio (sample exact) and video (frame exact) segments have equal lengths.
  const snap = (t: number) => Math.round(t * fps) / fps;
  const segs = plan.keep.map((s) => ({ start: snap(s.start), end: snap(s.end) })).filter((s) => s.end > s.start);

  const res = await cached(project, "cut", {
    // The plan file itself is not an input: applying rewrites its `approved` flag. Its segments are the key.
    inputs: [src],
    params: { segs, v: plan.version },
    version: 2,
    outputs: [out, wordsOut],
    force: opts.force,
  }, async () => {
    const fade = 0.012;
    const parts: string[] = [];
    segs.forEach((s, i) => {
      const len = s.end - s.start;
      parts.push(`[0:v]trim=start=${s.start}:end=${s.end},setpts=PTS-STARTPTS[v${i}]`);
      parts.push(
        `[0:a]atrim=start=${s.start}:end=${s.end},asetpts=PTS-STARTPTS,` +
          `afade=t=in:d=${fade},afade=t=out:st=${Math.max(0, len - fade).toFixed(4)}:d=${fade}[a${i}]`,
      );
    });
    parts.push(`${segs.map((_, i) => `[v${i}][a${i}]`).join("")}concat=n=${segs.length}:v=1:a=1[v][a]`);
    const script = project.path("cut", "filter.txt");
    writeFileSync(script, parts.join(";\n"));
    await run("ffmpeg", [
      "-v", "error", "-y", "-i", src, "-filter_complex_script", script, "-map", "[v]", "-map", "[a]",
      "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-g", String(fps), "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "256k", "-ar", "48000", "-movflags", "+faststart", out,
    ]);
    writeJson(wordsOut, remapWords({ ...plan, keep: segs }));
    plan.approved = true;
    writeJson(planPath, plan);
    writeFileSync(project.path("cut", "cutplan.md"), planMarkdown(plan));
  });
  return { ...res, video: out, words: readJson<Word[]>(wordsOut) };
}
