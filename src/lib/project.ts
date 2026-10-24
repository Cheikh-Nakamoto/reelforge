import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";

/** Repo root (one level above src/ or dist/). */
export const ROOT = resolve(new URL("../..", import.meta.url).pathname);
export const WORK_DIR = process.env.STUDIO_WORK_DIR ?? join(ROOT, "work");

export const STEPS = ["ingest", "transcribe", "cut", "matte", "compose", "audio", "render", "qa"] as const;
export type StepName = (typeof STEPS)[number];

export interface ProjectMeta {
  name: string;
  source: string;
  style: string;
  createdAt: string;
}

export class Project {
  constructor(public readonly name: string) {}

  get dir(): string {
    return join(WORK_DIR, this.name);
  }

  /** Directory of one step's outputs, e.g. work/foo/03-cut. */
  stepDir(step: StepName): string {
    const d = join(this.dir, `${String(STEPS.indexOf(step) + 1).padStart(2, "0")}-${step}`);
    mkdirSync(d, { recursive: true });
    return d;
  }

  path(step: StepName, file: string): string {
    return join(this.stepDir(step), file);
  }

  get meta(): ProjectMeta {
    return readJson(join(this.dir, "project.json"));
  }

  set meta(m: ProjectMeta) {
    mkdirSync(this.dir, { recursive: true });
    writeJson(join(this.dir, "project.json"), m);
  }

  exists(): boolean {
    return existsSync(join(this.dir, "project.json"));
  }

  static nameFromSource(source: string): string {
    return basename(source, extname(source)).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }
}

export function readJson<T = any>(file: string): T {
  return JSON.parse(readFileSync(file, "utf8"));
}

export function writeJson(file: string, data: unknown): void {
  writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

/** Fingerprint of a file: content hash for small files, size+mtime for large media. */
function fileFingerprint(file: string): string {
  const st = statSync(file);
  if (st.size > 8 * 1024 * 1024) return `${st.size}:${st.mtimeMs}`;
  return createHash("sha1").update(readFileSync(file)).digest("hex");
}

export interface StepManifest {
  step: StepName;
  key: string;
  params: unknown;
  outputs: string[];
  finishedAt: string;
  seconds: number;
}

/**
 * Run `fn` unless the step already ran with the same inputs and params and its outputs still exist.
 * The cache key covers input file fingerprints, params and the step's code version.
 */
export async function cached<T>(
  project: Project,
  step: StepName,
  opts: { inputs: string[]; params: unknown; version: number; outputs: string[]; force?: boolean },
  fn: () => Promise<T>,
): Promise<{ cached: boolean; manifest: StepManifest }> {
  const key = createHash("sha1")
    .update(JSON.stringify({ v: opts.version, p: opts.params, i: opts.inputs.map(fileFingerprint) }))
    .digest("hex");
  const mf = project.path(step, "manifest.json");
  if (!opts.force && existsSync(mf)) {
    const m = readJson<StepManifest>(mf);
    if (m.key === key && m.outputs.every((o) => existsSync(o))) return { cached: true, manifest: m };
  }
  const t0 = Date.now();
  await fn();
  for (const o of opts.outputs) if (!existsSync(o)) throw new Error(`${step}: expected output missing: ${o}`);
  const manifest: StepManifest = {
    step,
    key,
    params: opts.params,
    outputs: opts.outputs,
    finishedAt: new Date().toISOString(),
    seconds: Math.round((Date.now() - t0) / 100) / 10,
  };
  writeJson(mf, manifest);
  return { cached: false, manifest };
}

/** Forget a step's cache (and every later step's), so they re-run. */
export function invalidateFrom(project: Project, step: StepName): void {
  for (const s of STEPS.slice(STEPS.indexOf(step))) {
    const mf = join(project.dir, `${String(STEPS.indexOf(s) + 1).padStart(2, "0")}-${s}`, "manifest.json");
    if (existsSync(mf)) writeFileSync(mf, "{}");
  }
}
