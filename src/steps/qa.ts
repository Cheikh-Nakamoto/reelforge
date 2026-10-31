import { existsSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { run } from "../lib/exec.js";
import { ffprobe, measureLoudness, type Loudness } from "../lib/ffmpeg.js";
import { Project, readJson, writeJson } from "../lib/project.js";
import type { Style } from "../lib/style.js";
import type { Beats } from "./beats.js";
import type { ComposeCheck } from "./compose.js";
import type { MatteReport } from "./matte.js";
import { runSeamGate } from "./seams.js";
import { analyzeReference, compareEnergy, type ReferenceReport } from "../reference.js";

const FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";

export interface QaFile {
  format: string;
  file: string;
  sheet: string;
  duration: number;
  width: number;
  height: number;
  loudness: Loudness;
}

export interface QaReport {
  files: QaFile[];
  warnings: string[];
  mattePreview: string | null;
  /** With a reference (`--like`): cut and effect rates per 10 s of the reference and of the first export. */
  energy?: { reference: string; ours: Record<string, number>; theirs: Record<string, number> };
}

/**
 * Contact sheet at 1 frame per second for each export (timestamp burnt in), loudness and duration checks, and the
 * warnings collected by earlier steps. The sheets are meant to be looked at, by a person or the driving LLM.
 */
export async function qa(project: Project, style: Style, outputs: Record<string, string>): Promise<QaReport> {
  const warnings: string[] = [];
  const files: QaFile[] = [];
  const cutDur = (await ffprobe(project.path("cut", "cut.mp4"))).duration;

  for (const [format, file] of Object.entries(outputs)) {
    const p = await ffprobe(file);
    const loud = await measureLoudness(file);
    const sheet = project.path("qa", `sheet_${format}.png`);
    const vertical = p.height > p.width;
    const cols = vertical ? 8 : 5;
    const rows = Math.max(1, Math.ceil(Math.ceil(p.duration) / cols));
    const tw = vertical ? 200 : 360;
    const label = existsSync(FONT)
      ? `,drawtext=fontfile=${FONT}:text='%{pts\\:hms}':x=8:y=8:fontsize=${vertical ? 18 : 20}:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=4`
      : "";
    await run("ffmpeg", [
      "-v", "error", "-y", "-i", file,
      "-vf", `fps=1,scale=${tw}:-2${label},tile=${cols}x${rows}:padding=6:margin=6:color=0x202020`,
      "-frames:v", "1", "-update", "1", sheet,
    ]);
    files.push({ format, file, sheet, duration: round(p.duration), width: p.width, height: p.height, loudness: loud });
    if (Math.abs(loud.integrated - style.audio.lufs) > 1) warnings.push(`${format}: ${loud.integrated} LUFS (cible ${style.audio.lufs}).`);
    if (loud.truePeak > -1) warnings.push(`${format}: true peak ${loud.truePeak} dBFS (> -1).`);
    if (Math.abs(p.duration - cutDur) > 0.15) warnings.push(`${format}: durée ${p.duration.toFixed(2)} s ≠ montage ${cutDur.toFixed(2)} s.`);
  }

  const mattePath = project.path("matte", "matte.json");
  if (existsSync(mattePath)) {
    const m = readJson<MatteReport>(mattePath);
    if (m.verdict !== "ok") {
      warnings.push(
        `Détourage ${m.verdict === "bad" ? "inutilisable" : "instable par endroits"} ` +
          `(${Math.round(m.flaggedShare * 100)} % des images) : ` +
          [...m.flicker, ...m.lost].map((r) => `${r.start.toFixed(1)}–${r.end.toFixed(1)} s`).join(", "),
      );
    }
  }
  const beatsPath = project.path("compose", "beats.json");
  if (existsSync(beatsPath)) for (const n of readJson<Beats>(beatsPath).notes) warnings.push(n);
  const composePath = project.path("compose", "compose.json");
  if (existsSync(composePath)) {
    const comp = readJson<{ results: ComposeCheck[]; notes?: string[] }>(composePath);
    for (const n of comp.notes ?? []) warnings.push(n);
    for (const c of comp.results) {
      if (!c.lint.ok) warnings.push(`${c.format}: hyperframes lint en échec.`);
      if (!c.check.ok) warnings.push(`${c.format}: hyperframes check — ${c.check.errors} erreur(s), ${c.check.warnings} avertissement(s).`);
      if (c.check.incomplete) warnings.push(`${c.format}: hyperframes check n'a pas fini dans son délai (composition dense) : vérification partielle.`);
      // Seams measured on the composition itself, for the formats this QA covers.
      if (c.format in outputs) warnings.push(...(await runSeamGate(c.format, c.dir)));
    }
  }
  // Energy check: the export read with the same detectors as the reference it follows.
  let energy: QaReport["energy"];
  const ref = project.meta.reference;
  if (ref && existsSync(ref.report) && files.length) {
    const theirs = readJson<ReferenceReport>(ref.report);
    const ours = await analyzeReference(files[0].file);
    warnings.push(...compareEnergy(theirs, ours));
    energy = { reference: basename(ref.file), ours: ours.per10s, theirs: theirs.per10s };
  }
  const preview = project.path("matte", "matte-preview.png");
  const report: QaReport = { files, warnings, mattePreview: existsSync(preview) ? preview : null, ...(energy ? { energy } : {}) };
  writeJson(project.path("qa", "qa.json"), report);
  writeFileSync(project.path("qa", "qa.md"), qaMarkdown(report));
  return report;
}

function qaMarkdown(r: QaReport): string {
  const lines = ["# QA", ""];
  for (const f of r.files) {
    lines.push(`## ${f.format} — ${basename(f.file)}`, "",
      `${f.width}×${f.height}, ${f.duration} s, ${f.loudness.integrated} LUFS, TP ${f.loudness.truePeak} dBFS, LRA ${f.loudness.lra} LU`, "",
      `![planche](${basename(f.sheet)})`, "");
  }
  if (r.energy) {
    const row = (p: Record<string, number>) => Object.values(p).map((x) => String(x).replace(".", ",")).join(" | ");
    lines.push(`## Énergie face à ${r.energy.reference} (par 10 s)`, "", `| | ${Object.keys(r.energy.ours).join(" | ")} |`,
      `|---|${Object.keys(r.energy.ours).map(() => "---").join("|")}|`, `| référence | ${row(r.energy.theirs)} |`, `| montage | ${row(r.energy.ours)} |`, "");
  }
  lines.push("## Avertissements", "", ...(r.warnings.length ? r.warnings.map((w) => `- ${w}`) : ["Aucun."]), "");
  return lines.join("\n");
}

const round = (x: number) => Math.round(x * 100) / 100;
