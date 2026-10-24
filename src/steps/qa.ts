import { existsSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { run } from "../lib/exec.js";
import { ffprobe, measureLoudness, type Loudness } from "../lib/ffmpeg.js";
import { Project, readJson, writeJson } from "../lib/project.js";
import type { Style } from "../lib/style.js";
import type { Beats } from "./beats.js";
import type { ComposeCheck } from "./compose.js";
import type { MatteReport } from "./matte.js";

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
    }
  }
  const preview = project.path("matte", "matte-preview.png");
  const report: QaReport = { files, warnings, mattePreview: existsSync(preview) ? preview : null };
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
  lines.push("## Avertissements", "", ...(r.warnings.length ? r.warnings.map((w) => `- ${w}`) : ["Aucun."]), "");
  return lines.join("\n");
}

const round = (x: number) => Math.round(x * 100) / 100;
