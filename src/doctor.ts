import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { hyperframes, run } from "./lib/exec.js";
import { listStyles, STYLES_DIR } from "./lib/style.js";

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
  fix?: string;
}

const HF_CACHE = join(homedir(), ".cache", "hyperframes");

/** Everything the pipeline needs, with the command that fixes each missing piece. */
export async function doctor(): Promise<Check[]> {
  const checks: Check[] = [];
  const major = Number(process.versions.node.split(".")[0]);
  checks.push({ name: "Node.js", ok: major >= 22, detail: process.versions.node, fix: "install Node 22 or newer" });

  for (const bin of ["ffmpeg", "ffprobe"]) {
    const r = await run(bin, ["-version"], { allowFail: true }).catch(() => null);
    checks.push({
      name: bin,
      ok: !!r && r.code === 0,
      detail: r?.stdout.split("\n")[0] ?? "not found",
      fix: "sudo apt install ffmpeg",
    });
  }

  const models = await hyperframes(["models", "list"], { allowFail: true }).catch(() => null);
  const listed = models?.stdout ?? "";
  checks.push({
    name: "Parakeet (default ASR)",
    ok: /parakeet\S*\s+\S+\s+installed/.test(listed),
    detail: "parakeet-tdt-0.6b-v3 via sherpa-onnx",
    fix: "npx hyperframes models install parakeet",
  });
  checks.push({
    name: "whisper.cpp (optional ASR)",
    ok: /whisper\s+large-v3-turbo\s+installed/.test(listed),
    detail: "large-v3-turbo",
    fix: "downloaded and built on first `--engine whisper` run (needs git, cmake, a C compiler)",
  });
  checks.push({
    name: "U²-Net matting weights",
    ok: existsSync(join(HF_CACHE, "background-removal", "models", "u2net_human_seg.onnx")),
    detail: join(HF_CACHE, "background-removal"),
    fix: "downloaded on first matte (168 MB)",
  });

  const hd = await hyperframes(["doctor"], { allowFail: true }).catch(() => null);
  const chrome = /✓\s+Chrome\s+(.*)/.exec(hd?.stdout ?? "");
  checks.push({
    name: "Chrome (render)",
    ok: !!chrome,
    detail: chrome?.[1].trim() ?? "not found",
    fix: "npx hyperframes browser ensure (or set HYPERFRAMES_BROWSER_PATH)",
  });

  const sfx = join(dirname(STYLES_DIR), "assets", "sfx");
  const kinds = ["whoosh", "pop", "hit", "click", "glitch"].filter((k) => existsSync(join(sfx, k)));
  checks.push({
    name: "SFX library (optional)",
    ok: kinds.length === 4,
    detail: kinds.length ? kinds.join(", ") : "synthesised effects only",
    fix: "scripts/fetch-sfx.sh (CC0 sounds from Kenney and OpenGameArt)",
  });

  const fonts = await run("fc-list", [], { allowFail: true }).catch(() => null);
  checks.push({
    name: "Emoji font (captions)",
    ok: /Noto Color Emoji/.test(fonts?.stdout ?? ""),
    detail: "Noto Color Emoji",
    fix: "sudo apt install fonts-noto-color-emoji (styles with captions.emojis need it)",
  });

  try {
    const styles = listStyles();
    checks.push({ name: "styles", ok: styles.length > 0, detail: styles.map((s) => s.name).join(", ") });
  } catch (e) {
    checks.push({ name: "styles", ok: false, detail: (e as Error).message, fix: "fix the YAML, see styles/style.schema.json" });
  }
  return checks;
}

export function formatChecks(checks: Check[]): string {
  return checks
    .map((c) => `${c.ok ? "✓" : "✗"} ${c.name.padEnd(28)} ${c.detail}${c.ok || !c.fix ? "" : `\n    → ${c.fix}`}`)
    .join("\n");
}
