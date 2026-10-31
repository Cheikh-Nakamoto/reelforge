import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { hyperframesBin, run } from "../lib/exec.js";
import type { Beats } from "./beats.js";
import { sceneSeams, type SeamRow } from "./stage.js";

export interface SeamLedger {
  fps: number;
  seams: SeamRow[];
}

/**
 * The vector ledger of a composition: the seams studio itself writes. Only the typography scenes have selectors on
 * both sides; an assembly's junctions are FFmpeg xfades baked into the footage, invisible to a DOM probe.
 */
export function seamLedger(beats: Pick<Beats, "scenes" | "duration">, fps: number): SeamLedger {
  return { fps, seams: sceneSeams(beats.scenes, beats.duration) };
}

export interface SeamResult {
  id: string;
  cut: number;
  type: string;
  rows: { check: string; status: string; detail: string }[];
}

/**
 * seam-gate's failures as QA warnings. `zero-overlap` is skipped: the rush plays under every overlay, and the gate
 * reads opacity, not occlusion, so on a studio composition it fails by construction.
 */
export function seamWarnings(format: string, results: SeamResult[]): string[] {
  return results.flatMap((r) => r.rows
    .filter((row) => row.status === "FAIL" && row.check !== "zero-overlap")
    .map((row) => `${format}: couture ${r.id} (${String(r.cut).replace(".", ",")} s) — ${row.check} : ${row.detail}`));
}

/** The motion-doctrine skill's verifier, overridable for a copy kept elsewhere. */
function seamGateScript(): string {
  return process.env.STUDIO_SEAM_GATE ?? join(homedir(), ".claude", "skills", "motion-doctrine", "scripts", "seam-gate.mjs");
}

/** HyperFrames' own chrome-headless-shell (downloaded once with the CLI), so the gate fetches no browser. */
function chromePath(): string | null {
  if (process.env.CHROME_PATH) return existsSync(process.env.CHROME_PATH) ? process.env.CHROME_PATH : null;
  const root = join(homedir(), ".cache", "hyperframes", "chrome", "chrome-headless-shell");
  if (!existsSync(root)) return null;
  for (const v of readdirSync(root).filter((d) => d.startsWith("linux")).sort().reverse()) {
    const bin = join(root, v, "chrome-headless-shell-linux64", "chrome-headless-shell");
    if (existsSync(bin)) return bin;
  }
  return null;
}

/**
 * Run seam-gate on one composition directory (holding its `ledger.json`). The preview server is the pinned CLI:
 * without `--server-cmd` the script would run `npx --yes hyperframes`, an unpinned download (decisions 1 and 17).
 * A missing script or browser is a warning, never a failed QA.
 */
export async function runSeamGate(format: string, dir: string): Promise<string[]> {
  const ledger = join(dir, "ledger.json");
  if (!existsSync(ledger) || !(JSON.parse(readFileSync(ledger, "utf8")) as SeamLedger).seams.length) return [];
  const script = seamGateScript();
  if (!existsSync(script)) return [`${format}: seam-gate absent (${script}) : coutures non vérifiées.`];
  const chrome = chromePath();
  if (!chrome) return [`${format}: Chrome introuvable pour seam-gate (CHROME_PATH ou ~/.cache/hyperframes/chrome) : coutures non vérifiées.`];
  // The gate starts Chrome sandboxed, which Ubuntu's AppArmor user-namespace rule kills at launch for an unprofiled
  // binary. HyperFrames' own capture runs this Chrome with --no-sandbox; the gate gets the same, on local pages only.
  const tmp = mkdtempSync(join(tmpdir(), "studio-seam-"));
  const wrapper = join(tmp, "chrome");
  writeFileSync(wrapper, `#!/bin/sh\nexec "${chrome}" --no-sandbox "$@"\n`);
  chmodSync(wrapper, 0o755);
  const res = await run("node", [
    script, "verify", "--ledger", ledger, "--project", dir, "--json",
    "--server-cmd", `${hyperframesBin()} preview --foreground --no-open --port {port}`,
  ], { env: { CHROME_PATH: wrapper }, allowFail: true }).finally(() => rmSync(tmp, { recursive: true, force: true }));
  // Exit 1 is a failed seam (its rows say which); 2 is the script itself failing.
  if (res.code !== 0 && res.code !== 1) {
    return [`${format}: seam-gate en échec (code ${res.code}) : ${res.stderr.trim().split("\n").slice(-2).join(" ")}`];
  }
  try {
    return seamWarnings(format, JSON.parse(res.stdout.slice(res.stdout.indexOf("["))) as SeamResult[]);
  } catch {
    return [`${format}: rapport de seam-gate illisible.`];
  }
}
