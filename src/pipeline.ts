import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { Project, readJson, STEPS, type StepManifest } from "./lib/project.js";
import { deepMerge, loadStyle, type Style } from "./lib/style.js";
import { likeReference } from "./reference.js";
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
import { ensureTickets, recordQa } from "./tickets.js";
import type { Assembly } from "./assembly.js";

export type Log = (msg: string) => void;

export function openProject(name: string): { project: Project; style: Style } {
  const project = new Project(name);
  if (!project.exists()) throw new Error(`Unknown project "${name}". Known: ${listProjects().join(", ") || "(none)"}`);
  return { project, style: loadStyle(project.meta.style, project.meta.overrides ?? {}) };
}

export function listProjects(): string[] {
  const dir = new Project("x").dir.replace(/\/x$/, "");
  return existsSync(dir) ? readdirSync(dir).filter((d) => existsSync(join(dir, d, "project.json"))) : [];
}

/** Create (or reopen) the project for a rush and run ingest + transcribe. */
export async function createProject(
  source: string,
  styleName: string,
  opts: {
    name?: string; engine?: Engine; language?: string; model?: string; log?: Log;
    overrides?: Record<string, unknown>; recipe?: string; formats?: ("16x9" | "9x16")[];
    /** A reference video to edit like: its measured energy and look go over the other overrides. */
    like?: string;
  } = {},
) {
  const log = opts.log ?? (() => {});
  const project = new Project(opts.name ?? Project.nameFromSource(source));
  const prev = project.exists() ? project.meta : null;
  let overrides = opts.overrides ?? prev?.overrides;
  let reference = prev?.reference;
  if (opts.like) {
    const like = await likeReference(opts.like, log);
    overrides = deepMerge(overrides ?? {}, like.overrides);
    reference = like.reference;
  }
  const style = loadStyle(styleName, overrides ?? {});
  project.meta = {
    name: project.name, source: resolve(source), style: style.name, createdAt: prev?.createdAt ?? new Date().toISOString(),
    ...(overrides ? { overrides } : {}),
    ...(opts.recipe ?? prev?.recipe ? { recipe: opts.recipe ?? prev?.recipe } : {}),
    ...(opts.formats ?? prev?.formats ? { formats: opts.formats ?? prev?.formats } : {}),
    ...(reference ? { reference } : {}),
  };
  log(`[ingest] ${source}`);
  const ing = await ingest(project, source);
  log(`[ingest] ${ing.cached ? "cache" : `${ing.manifest.seconds}s`} — ${ing.result.normalized.width}x${ing.result.normalized.height} @${ing.result.normalized.fps}fps, ${ing.result.normalized.duration.toFixed(1)}s`);
  const engine = opts.engine ?? "hybrid";
  const label = { hybrid: "whisper.cpp (texte) + Parakeet (temps)", whisper: "whisper.cpp", parakeet: "Parakeet TDT v3" }[engine];
  log(`[transcribe] ${label}`);
  const tr = await transcribe(project, { engine, language: opts.language, model: opts.model });
  log(`[transcribe] ${tr.cached ? "cache" : `${tr.manifest.seconds}s`} — ${tr.words.length} mots` +
    (tr.alignment ? `, ${Math.round(tr.alignment.matched * 100)} % calés sur Parakeet` : ""));
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
  if (!project.meta.assembly && (opts.repropose || !existsSync(planPath))) {
    const p = await proposeCut(project, style);
    log(`[cut] plan : ${p.plan.sourceDuration}s → ${p.plan.keptDuration}s (${p.plan.keep.length} plans)`);
  }
  const plan = readJson<CutPlan>(planPath);
  if (!plan.approved && !opts.approveCut) {
    return { status: "awaiting-cut-approval", project: project.name, plan: project.path("cut", "cutplan.md"), markdown: "" };
  }
  if (!project.meta.assembly) {
    const cut = await applyCut(project);
    log(`[cut] ${cut.cached ? "cache" : `${cut.manifest.seconds}s`} — cut.mp4`);
  }

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
  const formats = opts.formats ?? project.meta.formats ?? ["16x9", "9x16"];
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
  const report = await runQa(project, style, rn.outputs);
  for (const w of report.warnings) log(`[qa] ⚠ ${w}`);
  return { status: "done", project: project.name, outputs: rn.outputs, qa: report };
}

/**
 * A project's default tickets (decision 22), unless it has some: at creation, and for an assembly as soon as its spec
 * is known, before its project exists (the parts' cut reviews come first).
 */
export function writeDefaultTickets(name: string, spec?: Assembly) {
  if (!spec) return ensureTickets(name);
  const parts = spec.parts.map((p) => p.name ?? p.project ?? Project.nameFromSource(p.source!));
  return ensureTickets(name, { name, style: spec.style, assembly: true }, parts);
}

/** QA, then the correction round its warnings ask for in the project's tickets. */
export async function runQa(project: Project, style: Style, outputs: Record<string, string>) {
  const report = await qa(project, style, outputs);
  recordQa(project.name, Object.keys(outputs), report.warnings);
  return report;
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
