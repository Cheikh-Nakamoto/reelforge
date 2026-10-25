import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { hyperframes, run } from "../lib/exec.js";
import { ffprobe, rmsEnvelope } from "../lib/ffmpeg.js";
import { cached, invalidateFrom, Project, readJson, ROOT, writeJson, codeOf } from "../lib/project.js";
import type { Style } from "../lib/style.js";
import type { Word } from "../lib/words.js";
import type { CutPlan } from "./cutplan.js";
import { beatsSummary, BeatsSchema, behindWhooshAt, matteWindowFor, proposeBeats, type Beats } from "./beats.js";
import { buildComposition, computeLayout, FORMATS, type Format } from "./html.js";
import { alphaMask, assembleSubject, matteWindow, recordWindows, type MatteReport, type MatteWindow } from "./matte.js";
import type { Mask, Placement } from "./placement.js";
import type { DeviceSlot } from "./stage.js";
import { fxBakeFilter } from "./effects.js";
import { gradeCutout, gradeVideo, grainTexture, lookFilter } from "./look.js";

function loadMatte(project: Project): MatteReport | null {
  const p = project.path("matte", "matte.json");
  return existsSync(p) ? readJson<MatteReport>(p) : null;
}

/**
 * Heuristic beats (captions, behind-words, graphics, sfx) written to beats.json for review. Each behind-word candidate
 * is matted at full rate first; unstable ones are swapped for the next best word.
 */
export async function proposeCompose(project: Project, style: Style, log: (m: string) => void = () => {}) {
  const words = readJson<Word[]>(project.path("cut", "words.json"));
  const video = project.path("cut", "cut.mp4");
  const { duration } = await ffprobe(video);
  const rms = await rmsEnvelope(video);
  const windows: MatteWindow[] = [];
  const beats = await proposeBeats(words, rms, duration, style, loadMatte(project), async (s, e) => {
    log(`[matte] fenêtre ${s.toFixed(2)}–${e.toFixed(2)} s…`);
    const w = await matteWindow(project, s, e);
    windows.push(w);
    log(`[matte] fenêtre ${s.toFixed(2)}–${e.toFixed(2)} s : ${w.verdict} (${w.seconds}s, oscillation ${w.meanOscillation})`);
    return { ok: w.verdict === "ok", why: w.verdict === "lost" ? "sujet perdu" : w.verdict === "flicker" ? "scintillement" : undefined };
  }, cutInstants(project), loadAssembly(project));
  if (windows.length) recordWindows(project, windows);
  const path = project.path("compose", "beats.json");
  writeJson(path, beats);
  invalidateFrom(project, "compose");
  return { beats, summary: beatsSummary(beats), path };
}

export interface AssemblyLayout {
  parts: Beats["parts"];
  frames: Beats["frames"];
  /** Centres of the transitions between parts (a whoosh goes there). */
  transitions?: number[];
}

/** Parts and frame reductions of an assembled video (written by assembly.ts), or none for a single rush. */
export function loadAssembly(project: Project): AssemblyLayout {
  const p = project.path("cut", "assembly.json");
  return existsSync(p) ? readJson<AssemblyLayout>(p) : { parts: [], frames: [], transitions: [] };
}

/** A B-roll source: another project's cut (or ingested) video, or a file path. */
export function resolveBroll(src: string): string {
  const proj = new Project(src);
  for (const f of [proj.path("cut", "cut.mp4"), proj.path("ingest", "source.mp4")]) if (proj.exists() && existsSync(f)) return f;
  if (existsSync(src)) return src;
  throw new Error(`B-roll "${src}" is neither a project with a video nor a file`);
}

/** Where the rush was cut, on the cut timeline (the start of every kept segment after the first). */
function cutInstants(project: Project): number[] {
  const plan = readJson<CutPlan>(project.path("cut", "cutplan.json"));
  // An assembly's segments already sit on the joined timeline (and overlap at transitions): read their starts.
  if (project.meta.assembly) return plan.keep.slice(1).map((s) => s.start);
  const out: number[] = [];
  let t = 0;
  plan.keep.forEach((s, i) => {
    if (i > 0) out.push(t);
    t += s.end - s.start;
  });
  return out;
}

/** Matte every behind-word's window (cached), drop the ones that flicker, and build the full-length cutout. */
async function ensureCutout(project: Project, beats: Beats) {
  const notes: string[] = [];
  const windows: MatteWindow[] = [];
  const kept: Beats["behind"] = [];
  for (const b of beats.behind) {
    const mw = matteWindowFor(b);
    const w = await matteWindow(project, mw.start, mw.end);
    windows.push(w);
    if (w.verdict === "ok") kept.push(b);
    else notes.push(`Mot derrière « ${b.text} » (${b.start.toFixed(1)} s) retiré : détourage ${w.verdict === "lost" ? "perdu" : "instable"}.`);
  }
  // A colour pop needs the subject matted over its whole window, or the subject would turn grey with the world.
  const fx: Beats["fx"] = [];
  for (const f of beats.fx) {
    if (f.kind !== "colorPop") {
      fx.push(f);
      continue;
    }
    const inBehind = kept.some((b) => b.start <= f.at + 0.01 && b.end >= f.at + f.duration - 0.01);
    const mw = matteWindowFor({ start: f.at, end: f.at + f.duration });
    const w = inBehind ? null : await matteWindow(project, mw.start, mw.end);
    if (w) windows.push(w);
    if (inBehind || w?.verdict === "ok") fx.push(f);
    else notes.push(`Colour pop à ${f.at.toFixed(1)} s retiré : détourage ${w?.verdict === "lost" ? "perdu" : "instable"}.`);
  }
  if (windows.length) recordWindows(project, windows);
  const needsCutout = kept.length || fx.some((f) => f.kind === "colorPop");
  const subject = needsCutout ? await assembleSubject(project, windows) : null;
  return { behind: kept, fx, subject, notes };
}

/** Replace beats.json with an edited version (validated), e.g. from the reviewing LLM. */
export function setBeats(project: Project, beats: unknown) {
  const parsed = BeatsSchema.parse(beats);
  writeJson(project.path("compose", "beats.json"), parsed);
  invalidateFrom(project, "compose");
  return { beats: parsed, summary: beatsSummary(parsed) };
}

export interface ComposeCheck {
  format: Format["id"];
  dir: string;
  lint: { ok: boolean; output: string };
  check: { ok: boolean; errors: number; warnings: number; output: string; incomplete?: boolean };
}

/** Write one HyperFrames project per format, then lint and check each. */
export async function applyCompose(
  project: Project,
  style: Style,
  opts: { formats?: Format["id"][]; force?: boolean; check?: boolean } = {},
) {
  const formats = opts.formats ?? ["16x9", "9x16"];
  const beatsPath = project.path("compose", "beats.json");
  if (!existsSync(beatsPath)) throw new Error("No beats yet: run compose propose first");
  const cut = project.path("cut", "cut.mp4");
  const report = project.path("compose", "compose.json");
  const dirs = formats.map((f) => join(project.stepDir("compose"), f));

  await cached(project, "compose", {
    code: codeOf(import.meta.url, "./beats.js", "./html.js", "./placement.js", "./look.js", "./effects.js", "./stage.js", "./contextual.js"),
    inputs: [cut, beatsPath],
    params: { formats, style, check: opts.check !== false },
    version: 6,
    outputs: [report, project.path("compose", "final-beats.json"), ...dirs.map((d) => join(d, "index.html"))],
    force: opts.force,
  }, async () => {
    const beats = BeatsSchema.parse(readJson<Beats>(beatsPath));
    const needsMatte = beats.behind.length || beats.fx.some((f) => f.kind === "colorPop");
    const cutout = needsMatte ? await ensureCutout(project, beats) : { behind: [], fx: beats.fx, subject: null, notes: [] };
    beats.behind = cutout.behind;
    beats.fx = cutout.fx;
    const subject = cutout.subject;
    const hasCutout = !!subject;
    const matte = loadMatte(project);
    const src = await ffprobe(cut);
    // Alpha samples per behind-word: the placement measures how much of the word the subject hides on the real
    // matte.
    const masks: Record<string, Mask[]> = {};
    if (subject) {
      const mw = 108, mh = Math.round((108 * src.height) / src.width);
      for (const b of beats.behind) {
        // Six samples across the visible part of the word; the placement is judged on the worst one, because a hand
        // or a held object crossing the word for a few frames is what makes it unreadable.
        const ts = Array.from({ length: 6 }, (_, k) => b.start + 0.3 + ((b.end - 0.25 - (b.start + 0.3)) * k) / 5);
        masks[b.id] = await Promise.all(ts.map((t) => alphaMask(subject, t, mw, mh)));
      }
    }
    const placements: Record<string, Record<string, Placement>> = {};
    // Behind-words dropped in every format lose their sound too (final-beats.json feeds the audio step).
    const keptBehind = new Set<string>();
    // Bake the style's look once into the footage and the cutout, with the same filter chain.
    let footage = cut;
    let cutoutFile = subject;
    const look = lookFilter(style);
    if (look) {
      footage = project.path("compose", "graded.mp4");
      await gradeVideo(cut, footage, look);
      if (subject) {
        cutoutFile = project.path("compose", "graded-subject.webm");
        await gradeCutout(subject, cutoutFile, look);
      }
    }
    // RGB splits and glitches are drawn into the footage here, inside their windows only (see fxBakeFilter).
    const bake = fxBakeFilter(beats.fx, src.width, src.height, style.effects.intensity);
    if (bake) {
      const baked = project.path("compose", "fx.mp4");
      await run("ffmpeg", [
        "-v", "error", "-y", "-i", footage, "-filter_complex", bake, "-map", "[fx]", "-an",
        "-c:v", "libx264", "-preset", "fast", "-crf", "16", baked,
      ]);
      footage = baked;
    }
    const results: ComposeCheck[] = [];
    for (const fid of formats) {
      const f = FORMATS[fid];
      const dir = join(project.stepDir("compose"), fid);
      const assets = join(dir, "assets");
      mkdirSync(assets, { recursive: true });
      linkOrCopy(footage, join(assets, "cut.mp4"));
      if (cutoutFile) linkOrCopy(cutoutFile, join(assets, "subject.webm"));
      copyFileSync(join(ROOT, "node_modules", "gsap", "dist", "gsap.min.js"), join(assets, "gsap.min.js"));
      const layout = computeLayout(src, f, matte?.centerX ?? 0.5);
      if (layout.mode === "pillar") await blurredBackground(footage, join(assets, "bg.mp4"), f);
      if (style.look.grain > 0) await grainTexture(join(assets, "grain.png"));
      for (const [i, fr] of beats.frames.entries()) if (fr.broll) linkOrCopy(resolveBroll(fr.broll.src), join(assets, `broll-${i}.mp4`));
      if (style.motion.blur) copyFileSync(join(ROOT, "templates", "vendor", "motion-blur.js"), join(assets, "motion-blur.js"));
      // Screen recordings in a 3D phone: each screen part (its own cut video) and each B-roll under a bubble.
      const devices: DeviceSlot[] = [];
      if (style.frame.device) {
        beats.parts.forEach((p, i) => {
          if (p.kind !== "screen") return;
          linkOrCopy(resolveBroll(p.name), join(assets, `part-${i}.mp4`));
          devices.push({ src: `assets/part-${i}.mp4`, start: p.start, end: p.end, from: 0, role: "screen" });
        });
        beats.frames.forEach((fr, i) => {
          if (fr.broll) devices.push({ src: `assets/broll-${i}.mp4`, start: fr.start, end: fr.end, from: fr.broll.from, role: "broll" });
        });
      }
      if (subject && beats.fx.some((f) => f.kind === "colorPop")) await blackAndWhite(footage, join(assets, "bw.mp4"));
      writeJson(join(dir, "hyperframes.json"), { paths: { blocks: "compositions", components: "compositions/components", assets: "assets" }, media: { autoProxy: true } });
      let comp = buildComposition({ beats, style, format: f, src, matte, hasCutout, masks, devices });
      // A word with no readable place (too small, an end letter hidden…) is dropped, not shipped badly.
      const bad = Object.entries(comp.placements).filter(([, p]) => !p.ok).map(([id]) => id);
      if (bad.length) {
        for (const id of bad) {
          const b = beats.behind.find((x) => x.id === id);
          const p = comp.placements[id];
          cutout.notes.push(
            `${fid}: mot derrière « ${b?.text} » retiré — pas de place lisible derrière le sujet ` +
              `(au mieux ${Math.round(p.fs / f.height * 100)} % de la hauteur, ${p.lostLetters} lettre(s) cachée(s)). Plan trop serré ?`,
          );
        }
        const dropped = beats.behind.filter((b) => bad.includes(b.id));
        // Its colour pop goes too: without the cutout the speaker would turn grey with the world.
        const fewer = {
          ...beats,
          behind: beats.behind.filter((b) => !bad.includes(b.id)),
          fx: beats.fx.filter((x) => x.kind !== "colorPop" || !dropped.some((b) => Math.abs(b.start - x.at) < 0.05)),
        };
        comp = buildComposition({ beats: fewer, style, format: f, src, matte, hasCutout, masks, devices });
      }
      placements[fid] = comp.placements;
      for (const b of beats.behind) if (!bad.includes(b.id)) keptBehind.add(b.id);
      writeFileSync(join(dir, "index.html"), comp.html);
      results.push(opts.check === false ? skipped(fid, dir) : await lintAndCheck(fid, dir, src.duration));
    }
    const gone = beats.behind.filter((b) => !keptBehind.has(b.id));
    writeJson(project.path("compose", "final-beats.json"), {
      ...beats,
      behind: beats.behind.filter((b) => keptBehind.has(b.id)),
      sfx: beats.sfx.filter((x) => !(x.kind === "whoosh" && gone.some((b) => Math.abs(behindWhooshAt(b.start) - x.at) < 0.06))),
      fx: beats.fx.filter((x) => !gone.some((b) => Math.abs(b.start - x.at) < 0.06)),
    });
    writeJson(report, {
      results,
      notes: cutout.notes,
      behindUsed: beats.behind.map((b) => b.text),
      placements,
      layout: formats.map((fid) => ({ fid, ...computeLayout(src, FORMATS[fid], matte?.centerX ?? 0.5) })),
    });
  });
  const r = readJson<{ results: ComposeCheck[]; notes: string[] }>(report);
  return { results: r.results, notes: r.notes, dirs: Object.fromEntries(formats.map((f, i) => [f, dirs[i]])) };
}

/** The step cache decides when to rebuild, so assets are always refreshed here. */
function linkOrCopy(from: string, to: string) {
  copyFileSync(from, to);
}

/** Contrasted black-and-white copy of the footage for the colour pop (shown under the cutout). */
async function blackAndWhite(src: string, out: string) {
  await run("ffmpeg", [
    "-v", "error", "-y", "-i", src, "-an", "-vf", "hue=s=0,eq=contrast=1.12:brightness=-0.02,format=yuv420p",
    "-c:v", "libx264", "-preset", "fast", "-crf", "18", out,
  ]);
}

/** Full-frame blurred, darkened copy of the footage behind a pillar layout. */
async function blurredBackground(src: string, out: string, f: Format) {
  await run("ffmpeg", [
    "-v", "error", "-y", "-i", src, "-an",
    "-vf", `scale=${f.width / 4}:${f.height / 4}:force_original_aspect_ratio=increase,crop=${f.width / 4}:${f.height / 4},` +
      `boxblur=10:2,eq=brightness=-0.08:saturation=0.8,scale=${f.width}:${f.height}`,
    "-c:v", "libx264", "-preset", "fast", "-crf", "24", "-pix_fmt", "yuv420p", out,
  ]);
}

function skipped(format: Format["id"], dir: string): ComposeCheck {
  return { format, dir, lint: { ok: true, output: "skipped" }, check: { ok: true, errors: 0, warnings: 0, output: "skipped" } };
}

const SECTIONS = ["lint", "runtime", "layout", "motion", "contrast", "craft"] as const;

async function lintAndCheck(format: Format["id"], dir: string, duration: number): Promise<ComposeCheck> {
  const lint = await hyperframes(["lint"], { cwd: dir, allowFail: true });
  // check has a fixed 120 s budget once Chrome is up; a long, dense composition gets fewer samples to fit in it.
  const samples = duration > 40 ? 5 : 9;
  const check = await hyperframes(["check", "--json", "--samples", String(samples)], { cwd: dir, allowFail: true });
  let errors = 0, warnings = 0;
  let incomplete = false;
  const findings: string[] = [];
  try {
    // A single pretty-printed report: { ok, lint, runtime, layout, motion, contrast, craft } sections with counts.
    const j = JSON.parse(check.stdout.slice(check.stdout.indexOf("{")));
    for (const key of SECTIONS) {
      const s = j[key];
      if (!s) continue;
      errors += s.errorCount ?? 0;
      warnings += s.warningCount ?? 0;
      for (const f of s.findings ?? []) {
        // Running out of check's time budget says nothing about the composition: reported, not counted as an error.
        if (f.code === "check_runtime_failure") {
          incomplete = true;
          errors -= f.severity === "error" ? 1 : 0;
          findings.push(`[check incomplet] ${f.message ?? ""}`.trim());
          continue;
        }
        if (f.severity === "error" || f.severity === "warning") {
          findings.push(`[${key}/${f.severity}] ${f.code ?? f.rule ?? ""} ${f.message ?? ""}`.trim());
        }
      }
    }
  } catch {
    errors = check.code === 0 ? 0 : 1;
  }
  return {
    format,
    dir,
    lint: { ok: lint.code === 0, output: (lint.stdout + lint.stderr).trim().slice(-3000) },
    check: {
      ok: errors === 0 && (check.code === 0 || incomplete), errors, warnings, incomplete,
      output: findings.slice(0, 40).join("\n") || check.stderr.trim().slice(-2000),
    },
  };
}
