import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { hyperframes, run } from "../lib/exec.js";
import { ffprobe, rmsEnvelope } from "../lib/ffmpeg.js";
import { cached, invalidateFrom, Project, readJson, ROOT, writeJson } from "../lib/project.js";
import type { Style } from "../lib/style.js";
import type { Word } from "../lib/words.js";
import type { CutPlan } from "./cutplan.js";
import { beatsSummary, BeatsSchema, matteWindowFor, proposeBeats, type Beats } from "./beats.js";
import { buildComposition, computeLayout, FORMATS, type Format } from "./html.js";
import { alphaMask, assembleSubject, matteWindow, recordWindows, type MatteReport, type MatteWindow } from "./matte.js";
import type { Mask, Placement } from "./placement.js";
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
  }, cutInstants(project));
  if (windows.length) recordWindows(project, windows);
  const path = project.path("compose", "beats.json");
  writeJson(path, beats);
  invalidateFrom(project, "compose");
  return { beats, summary: beatsSummary(beats), path };
}

/** Where the rush was cut, on the cut timeline (the start of every kept segment after the first). */
function cutInstants(project: Project): number[] {
  const plan = readJson<CutPlan>(project.path("cut", "cutplan.json"));
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
  if (windows.length) recordWindows(project, windows);
  const subject = kept.length ? await assembleSubject(project, windows) : null;
  return { behind: kept, subject, notes };
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
  check: { ok: boolean; errors: number; warnings: number; output: string };
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
    inputs: [cut, beatsPath],
    params: { formats, style, check: opts.check !== false },
    version: 6,
    outputs: [report, ...dirs.map((d) => join(d, "index.html"))],
    force: opts.force,
  }, async () => {
    const beats = BeatsSchema.parse(readJson<Beats>(beatsPath));
    const cutout = beats.behind.length ? await ensureCutout(project, beats) : { behind: [], subject: null, notes: [] };
    beats.behind = cutout.behind;
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
      writeJson(join(dir, "hyperframes.json"), { paths: { blocks: "compositions", components: "compositions/components", assets: "assets" }, media: { autoProxy: true } });
      const comp = buildComposition({ beats, style, format: f, src, matte, hasCutout, masks });
      placements[fid] = comp.placements;
      for (const [id, p] of Object.entries(comp.placements)) {
        if (p.ok) continue;
        const word = beats.behind.find((b) => b.id === id)?.text;
        cutout.notes.push(`${fid}: « ${word} » mal placé derrière le sujet (couvert à ${Math.round(p.coverage * 100)} %, pire image ${Math.round(p.worst * 100)} %).`);
      }
      writeFileSync(join(dir, "index.html"), comp.html);
      results.push(opts.check === false ? skipped(fid, dir) : await lintAndCheck(fid, dir));
    }
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

async function lintAndCheck(format: Format["id"], dir: string): Promise<ComposeCheck> {
  const lint = await hyperframes(["lint"], { cwd: dir, allowFail: true });
  const check = await hyperframes(["check", "--json"], { cwd: dir, allowFail: true });
  let errors = 0, warnings = 0;
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
    check: { ok: check.code === 0 && errors === 0, errors, warnings, output: findings.slice(0, 40).join("\n") || check.stderr.trim().slice(-2000) },
  };
}
