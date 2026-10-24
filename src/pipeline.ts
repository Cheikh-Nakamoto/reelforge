import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { Project, readJson, STEPS, type StepManifest } from "./lib/project.js";
import { loadStyle, type Style } from "./lib/style.js";
import { applyCompose, proposeCompose } from "./steps/compose.js";
import { applyCut, proposeCut } from "./steps/cut.js";
import type { CutPlan } from "./steps/cutplan.js";
import type { Format } from "./steps/html.js";
import { ingest } from "./steps/ingest.js";
import { matteSurvey } from "./steps/matte.js";
import { qa } from "./steps/qa.js";
import { render } from "./steps/render.js";
import { audio } from "./steps/audio.js";
import { transcribe, type Engine } from "./steps/transcribe.js";

export type Log = (msg: string) => void;

export function openProject(name: string): { project: Project; style: Style } {
  const project = new Project(name);
  if (!project.exists()) throw new Error(`Unknown project "${name}". Known: ${listProjects().join(", ") || "(none)"}`);
  return { project, style: loadStyle(project.meta.style) };
}

export function listProjects(): string[] {
  const dir = new Project("x").dir.replace(/\/x$/, "");
  return existsSync(dir) ? readdirSync(dir).filter((d) => existsSync(join(dir, d, "project.json"))) : [];
}

/** Create (or reopen) the project for a rush and run ingest + transcribe. */
export async function createProject(
  source: string,
  styleName: string,
  opts: { name?: string; engine?: Engine; language?: string; model?: string; log?: Log } = {},
) {
  const log = opts.log ?? (() => {});
  const style = loadStyle(styleName);
  const project = new Project(opts.name ?? Project.nameFromSource(source));
  project.meta = { name: project.name, source: resolve(source), style: style.name, createdAt: project.exists() ? project.meta.createdAt : new Date().toISOString() };
  log(`[ingest] ${source}`);
  const ing = await ingest(project, source);
  log(`[ingest] ${ing.cached ? "cache" : `${ing.manifest.seconds}s`} — ${ing.result.normalized.width}x${ing.result.normalized.height} @${ing.result.normalized.fps}fps, ${ing.result.normalized.duration.toFixed(1)}s`);
  const engine = opts.engine ?? "parakeet";
  log(`[transcribe] ${engine === "whisper" ? `whisper.cpp ${opts.model ?? "large-v3-turbo"} (${opts.language ?? "fr"})` : "Parakeet TDT v3"}`);
  const tr = await transcribe(project, { engine, language: opts.language, model: opts.model });
  log(`[transcribe] ${tr.cached ? "cache" : `${tr.manifest.seconds}s`} — ${tr.words.length} mots`);
  return { project, style };
}

export interface RunOptions {
  approveCut?: boolean;
  formats?: Format["id"][];
  quality?: "draft" | "standard" | "high";
  /** Recompute the heuristic cut plan / beats even if one exists (drops manual edits). */
  repropose?: boolean;
  /** Render even when hyperframes lint reports errors. */
  ignoreLint?: boolean;
  log?: Log;
}

export type RunOutcome =
  | { status: "awaiting-cut-approval"; project: string; plan: string; markdown: string }
  | { status: "done"; project: string; outputs: Record<string, string>; qa: Awaited<ReturnType<typeof qa>> };

/** Everything after transcription. Stops at the cut plan unless it is approved (or approveCut). */
export async function continuePipeline(project: Project, style: Style, opts: RunOptions = {}): Promise<RunOutcome> {
  const log = opts.log ?? (() => {});
  const planPath = project.path("cut", "cutplan.json");
  if (opts.repropose || !existsSync(planPath)) {
    const p = await proposeCut(project, style);
    log(`[cut] plan : ${p.plan.sourceDuration}s → ${p.plan.keptDuration}s (${p.plan.keep.length} plans)`);
  }
  const plan = readJson<CutPlan>(planPath);
  if (!plan.approved && !opts.approveCut) {
    return { status: "awaiting-cut-approval", project: project.name, plan: project.path("cut", "cutplan.md"), markdown: "" };
  }
  const cut = await applyCut(project);
  log(`[cut] ${cut.cached ? "cache" : `${cut.manifest.seconds}s`} — cut.mp4`);

  const needsMatte = style.behind.enabled && style.behind.max > 0;
  if (needsMatte) {
    log(`[matte] relevé du sujet à 1 img/s…`);
    const m = await matteSurvey(project);
    log(`[matte] ${m.cached ? "cache" : `${m.manifest.seconds}s`} — sujet présent sur ${Math.round(m.report.presence * 100)} % des images`);
  }
  if (opts.repropose || !existsSync(project.path("compose", "beats.json"))) {
    const b = await proposeCompose(project, style, log);
    log(`[compose] ${b.summary.split("\n")[0]}`);
  }
  const formats = opts.formats ?? ["16x9", "9x16"];
  const comp = await applyCompose(project, style, { formats });
  for (const n of comp.notes) log(`[compose] ⚠ ${n}`);
  for (const r of comp.results) log(`[compose] ${r.format}: lint ${r.lint.ok ? "ok" : "ÉCHEC"}, check ${r.check.errors} err / ${r.check.warnings} warn`);
  // A lint error is a known defect (e.g. a property that stutters under frame capture): stop before a long render.
  const broken = comp.results.filter((r) => !r.lint.ok);
  if (broken.length && !opts.ignoreLint) {
    throw new Error(
      `hyperframes lint failed for ${broken.map((r) => r.format).join(", ")}; not rendering.\n` +
        broken.map((r) => r.check.output.split("\n").filter((l) => l.startsWith("[lint/error]")).join("\n")).join("\n"),
    );
  }
  const au = await audio(project, style);
  log(`[audio] ${au.cached ? "cache" : `${au.manifest.seconds}s`} — ${au.report.final.integrated} LUFS, TP ${au.report.final.truePeak}`);
  const rn = await render(project, { formats, quality: opts.quality, onProgress: (l) => l && log(`[render] ${l}`) });
  log(`[render] ${rn.cached ? "cache" : `${rn.manifest.seconds}s`}`);
  const report = await qa(project, style, rn.outputs);
  for (const w of report.warnings) log(`[qa] ⚠ ${w}`);
  return { status: "done", project: project.name, outputs: rn.outputs, qa: report };
}

export function status(project: Project) {
  const steps = STEPS.map((s) => {
    const mf = join(project.dir, `${String(STEPS.indexOf(s) + 1).padStart(2, "0")}-${s}`, "manifest.json");
    const m = existsSync(mf) ? readJson<Partial<StepManifest>>(mf) : null;
    return { step: s, done: !!m?.key, seconds: m?.seconds ?? null, finishedAt: m?.finishedAt ?? null };
  });
  const planPath = project.path("cut", "cutplan.json");
  const plan = existsSync(planPath) ? readJson<CutPlan>(planPath) : null;
  return {
    project: project.name,
    meta: project.meta,
    steps,
    cutPlan: plan ? { approved: plan.approved, sourceDuration: plan.sourceDuration, keptDuration: plan.keptDuration } : null,
    dir: project.dir,
  };
}
