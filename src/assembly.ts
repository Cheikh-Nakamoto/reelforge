import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parse } from "yaml";
import { z } from "zod";
import { run } from "./lib/exec.js";
import { ffprobe } from "./lib/ffmpeg.js";
import { cached, Project, readJson, writeJson } from "./lib/project.js";
import { deepMerge, loadStyle } from "./lib/style.js";
import type { Word } from "./lib/words.js";
import type { Beats } from "./steps/beats.js";
import { likeReference } from "./reference.js";
import { applyCut, proposeCut } from "./steps/cut.js";
import type { CutPlan } from "./steps/cutplan.js";
import { matteSurvey } from "./steps/matte.js";
import { createProject, type Log } from "./pipeline.js";

/**
 * Several rushes edited as one video: e.g. a face-cam intro, an explanation where the speaker shrinks into a bubble
 * over a screen recording, then the screen recording with its own voice-over.
 */
export const AssemblySchema = z.object({
  name: z.string().regex(/^[a-z0-9-]+$/, "lowercase letters, digits and dashes"),
  style: z.string(),
  parts: z.array(z.object({
    /** An existing project, or a rush to create one from (`source`, with an optional project `name`). */
    project: z.string().optional(),
    source: z.string().optional(),
    name: z.string().optional(),
    /** face or screen (a screen recording: no speaker to cut out). Detected from the matte survey when absent. */
    kind: z.enum(["face", "screen"]).optional(),
    /** Shrink this part's footage into a bubble or card, over B-roll (another part or a file) or the stage. */
    reduce: z.object({
      mode: z.enum(["card", "bubble"]).default("bubble"),
      broll: z.string().optional(),
      /** Seconds into the B-roll. */
      from: z.number().default(0),
      /** Window inside the part, in its cut timeline; the whole part by default. */
      start: z.number().optional(),
      end: z.number().optional(),
    }).optional(),
  }).refine((p) => p.project || p.source, "each part needs a project or a source")).min(1),
  /**
   * FFmpeg xfade transition at each junction, in order (cycled): smoothleft, zoomin, slideup, circleopen, hblur…
   * or "cut" for a hard cut. One direction by default: a film rides one current, and a junction that switches
   * direction each time reads as an error (motion-doctrine).
   */
  transitions: z.array(z.string()).default(["smoothleft"]),
  transitionDuration: z.number().min(0.1).max(1.5).default(0.45),
  /** Style overrides for the joined video (same structure as styles/*.yaml). */
  overrides: z.record(z.string(), z.unknown()).optional(),
  /** A reference video to edit like (its measured energy and look, over `overrides`). */
  like: z.string().optional(),
});

export type Assembly = z.infer<typeof AssemblySchema>;

export function loadAssemblySpec(file: string): Assembly {
  const parsed = AssemblySchema.safeParse(parse(readFileSync(file, "utf8")));
  if (!parsed.success) throw new Error(`${file} is invalid:\n${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

export type AssemblyOutcome =
  | { status: "awaiting-cut-approval"; pending: { project: string; plan: string }[] }
  | { status: "assembled"; project: string; duration: number; parts: Beats["parts"]; frames: Beats["frames"] };

/**
 * Prepare every part (ingest, transcribe, cut plan), stop while any plan is unreviewed, then cut and join them into
 * a project whose `03-cut/` holds the joined video, words and layout. From there the usual steps run unchanged.
 */
export async function buildAssembly(spec: Assembly, opts: { log?: Log } = {}): Promise<AssemblyOutcome> {
  const log = opts.log ?? (() => {});
  const out = new Project(spec.name);
  let overrides: Record<string, unknown> = deepMerge(out.exists() ? out.meta.overrides ?? {} : {}, spec.overrides ?? {});
  let reference = out.exists() ? out.meta.reference : undefined;
  if (spec.like) {
    const like = await likeReference(spec.like, log);
    overrides = deepMerge(overrides, like.overrides);
    reference = like.reference;
  }
  // The parts are cut with the joined video's rhythm.
  const style = loadStyle(spec.style, overrides);
  const parts: Project[] = [];
  for (const p of spec.parts) {
    if (p.source) parts.push((await createProject(p.source, spec.style, { name: p.name ?? p.project, log })).project);
    else {
      const proj = new Project(p.project!);
      if (!proj.exists()) throw new Error(`Unknown project "${p.project}"`);
      parts.push(proj);
    }
  }
  const pending: { project: string; plan: string }[] = [];
  for (const proj of parts) {
    if (!existsSync(proj.path("cut", "cutplan.json"))) await proposeCut(proj, style);
    if (!readJson<CutPlan>(proj.path("cut", "cutplan.json")).approved) {
      pending.push({ project: proj.name, plan: proj.path("cut", "cutplan.md") });
    }
  }
  if (pending.length) return { status: "awaiting-cut-approval", pending };

  for (const proj of parts) {
    const c = await applyCut(proj);
    log(`[assembly] ${proj.name}: cut ${c.cached ? "cache" : `${c.manifest.seconds}s`}`);
  }

  // Kind of each part: given, or a screen recording when the matte survey finds no person most of the time.
  const kinds: ("face" | "screen")[] = [];
  for (const [i, proj] of parts.entries()) {
    const given = spec.parts[i].kind;
    if (given) kinds.push(given);
    else {
      const m = await matteSurvey(proj);
      kinds.push(m.report.presence < 0.4 ? "screen" : "face");
      log(`[assembly] ${proj.name}: ${kinds[i]} (personne sur ${Math.round(m.report.presence * 100)} % des images)`);
    }
  }

  out.meta = {
    name: spec.name,
    source: `assembly: ${parts.map((p) => p.name).join(" + ")}`,
    style: spec.style,
    createdAt: out.exists() ? out.meta.createdAt : new Date().toISOString(),
    assembly: true,
    ...(Object.keys(overrides).length ? { overrides } : {}),
    ...(reference ? { reference } : {}),
  };
  writeFileSync(out.path("cut", "assembly.yaml"), JSON.stringify(spec, null, 2));

  const videos = parts.map((p) => p.path("cut", "cut.mp4"));
  const probes = await Promise.all(videos.map((v) => ffprobe(v)));
  // One canvas for all parts: vertical when most parts are, at 1080 px on the short side.
  const vertical = probes.filter((p) => p.height > p.width).length * 2 >= probes.length;
  const W = vertical ? 1080 : 1920, H = vertical ? 1920 : 1080;
  const joined = out.path("cut", "cut.mp4");
  const wordsOut = out.path("cut", "words.json");
  const planOut = out.path("cut", "cutplan.json");
  const layoutOut = out.path("cut", "assembly.json");

  await cached(out, "cut", {
    // Part transcripts too: a word fixed in a part (studio fix) must reach the joined captions.
    inputs: [...videos, ...parts.map((p) => p.path("cut", "words.json"))],
    params: { spec, kinds, W, H },
    version: 2,
    outputs: [joined, wordsOut, planOut, layoutOut],
  }, async () => {
    // Each part fitted to the canvas over a blurred copy of itself (a 720×1600 screen recording in 1080×1920),
    // then concatenated with its audio.
    const inputs = videos.flatMap((v) => ["-i", v]);
    const chains = videos.map((_, i) =>
      `[${i}:v]fps=30,split[a${i}][b${i}];` +
      `[a${i}]scale=${W / 4}:${H / 4}:force_original_aspect_ratio=increase,crop=${W / 4}:${H / 4},boxblur=12:2,eq=brightness=-0.12,scale=${W}:${H}[bg${i}];` +
      `[b${i}]scale=${W}:${H}:force_original_aspect_ratio=decrease[fg${i}];` +
      `[bg${i}][fg${i}]overlay=(W-w)/2:(H-h)/2,setsar=1,format=yuv420p[v${i}];` +
      `[${i}:a]aformat=sample_rates=48000:channel_layouts=stereo[s${i}]`);
    // Junctions: xfade (picture) + acrossfade (sound) overlap the parts by `d`; "cut" joins them hard.
    const kindAt = (k: number) => spec.transitions[(k - 1) % spec.transitions.length] ?? "cut";
    const d = spec.transitionDuration;
    const overlap = (k: number) => (k > 0 && kindAt(k) !== "cut" ? d : 0);
    const starts: number[] = [];
    probes.reduce((t, p, k) => {
      starts.push(t - overlap(k));
      return t - overlap(k) + p.duration;
    }, 0);
    const joins: string[] = [];
    let lv = "[v0]", la = "[s0]";
    for (let k = 1; k < videos.length; k++) {
      const [ov, oa] = [`[jv${k}]`, `[ja${k}]`];
      if (kindAt(k) === "cut") {
        joins.push(`${lv}${la}[v${k}][s${k}]concat=n=2:v=1:a=1${ov}${oa}`);
      } else {
        joins.push(`${lv}[v${k}]xfade=transition=${kindAt(k)}:duration=${d}:offset=${starts[k].toFixed(3)}${ov}`);
        joins.push(`${la}[s${k}]acrossfade=d=${d}${oa}`);
      }
      [lv, la] = [ov, oa];
    }
    const tail = videos.length > 1 ? [...joins, `${lv}null[v]`, `${la}anull[a]`] : ["[v0]null[v]", "[s0]anull[a]"];
    await run("ffmpeg", [
      "-v", "error", "-y", ...inputs, "-filter_complex", [...chains.map((c) => c.replace(/fps=30,split/, "fps=30,settb=AVTB,split")), ...tail].join(";"), "-map", "[v]", "-map", "[a]",
      "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-g", "30", "-c:a", "aac", "-b:a", "256k",
      "-movflags", "+faststart", joined,
    ]);

    // Words, cut segments and layout on the joined timeline.
    const words: Word[] = [];
    const keep: CutPlan["keep"] = [];
    const layoutParts: Beats["parts"] = [];
    const frames: Beats["frames"] = [];
    const transitions: number[] = [];
    for (const [i, proj] of parts.entries()) {
      const dur = probes[i].duration;
      const offset = starts[i];
      if (i > 0 && kindAt(i) !== "cut") transitions.push(r(offset + d / 2));
      for (const w of readJson<Word[]>(proj.path("cut", "words.json"))) {
        words.push({ ...w, id: `p${i}${w.id}`, start: r(w.start + offset), end: r(w.end + offset) });
      }
      // Segment lengths only matter downstream (jump-cut instants); part boundaries become cuts too.
      let t = offset;
      for (const s of readJson<CutPlan>(proj.path("cut", "cutplan.json")).keep) {
        const len = s.end - s.start;
        keep.push({ start: r(t), end: r(Math.min(t + len, offset + dur)) });
        t += len;
      }
      layoutParts.push({ name: proj.name, kind: kinds[i], start: r(offset), end: r(offset + dur) });
      const red = spec.parts[i].reduce;
      if (red) {
        const start = offset + (red.start ?? 0.2);
        const end = offset + Math.min(dur, red.end ?? dur - 0.2);
        frames.push({
          id: `fr${frames.length}`, mode: red.mode, start: r(start), end: r(end),
          broll: red.broll ? { src: red.broll, from: red.from } : undefined,
          reason: `assemblage : ${proj.name}`,
        });
      }
    }
    const total = starts[starts.length - 1] + probes[probes.length - 1].duration;
    writeJson(wordsOut, words);
    const plan: CutPlan = {
      version: 1, sourceDuration: r(total),
      params: { minPause: style.rhythm.minPause, keep: style.rhythm.keep, removeFillers: true, removeRetakes: true },
      words: [], keep, keptDuration: r(total), approved: true,
    };
    writeJson(planOut, plan);
    writeFileSync(out.path("cut", "cutplan.md"), `# Assemblage\n\nParties déjà coupées et relues : ${parts.map((p) => p.name).join(", ")}.\n`);
    writeJson(layoutOut, { parts: layoutParts, frames, transitions });
  });

  const layout = readJson<{ parts: Beats["parts"]; frames: Beats["frames"] }>(layoutOut);
  return { status: "assembled", project: spec.name, duration: (await ffprobe(joined)).duration, ...layout };
}

const r = (t: number) => Math.round(t * 1000) / 1000;
