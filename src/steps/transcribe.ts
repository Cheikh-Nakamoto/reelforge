import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hyperframes } from "../lib/exec.js";
import { findSilences } from "../lib/ffmpeg.js";
import { cached, Project, readJson, writeJson } from "../lib/project.js";
import type { Word } from "../lib/words.js";
import { alignTimings } from "../lib/align.js";

export type Engine = "hybrid" | "parakeet" | "whisper";

export interface TranscribeOptions {
  /**
   * hybrid (default): whisper.cpp's words with Parakeet's timings (lib/align.ts). On a noisy real rush Parakeet kept
   * 38 of 76 words and switched to English mid-sentence; whisper had them all, with edges up to 0.7 s off.
   * parakeet: fastest, fine on clean audio. whisper: text only quality, loose timings.
   */
  engine?: Engine;
  language?: string;
  /** whisper.cpp model (whisper engine only). large-v3-turbo: `small` misses too many French words. */
  model?: string;
  force?: boolean;
}

/**
 * Word-level transcript through `hyperframes transcribe` (local). With whisper the language and model are always
 * explicit: HyperFrames' default `small.en` translates French into English. Parakeet detects the language itself,
 * and passing --language would silently switch HyperFrames back to whisper.
 */
export async function transcribe(project: Project, opts: TranscribeOptions = {}) {
  const engine = opts.engine ?? "hybrid";
  const language = opts.language ?? "fr";
  const model = opts.model ?? "large-v3-turbo";
  const wav = project.path("ingest", "audio16k.wav");
  const out = project.path("transcribe", "words.json");
  const dir = project.stepDir("transcribe");

  const res = await cached(project, "transcribe", {
    inputs: [wav],
    params: engine === "parakeet" ? { engine } : { engine, language, model },
    version: 3,
    outputs: [out],
    force: opts.force,
  }, async () => {
    const run = async (which: "whisper" | "parakeet") => {
      const sub = join(dir, which);
      const args = which === "whisper"
        ? ["--engine", "whisper", "--model", model, "--language", language, "--timeout", "1800000"]
        : ["--engine", "parakeet"];
      const { stdout } = await hyperframes(["transcribe", wav, "--dir", sub, ...args, "--json"]);
      const reported = JSON.parse(stdout.trim().split("\n").pop() ?? "{}");
      if (reported.engine && reported.engine !== which) {
        throw new Error(`Asked for ${which} but HyperFrames ran ${reported.engine}. Install it: npx hyperframes models install parakeet`);
      }
      return JSON.parse(readFileSync(findTranscriptPath(stdout) ?? join(sub, "transcript.json"), "utf8")) as Word[];
    };
    let raw: Word[];
    if (engine === "hybrid") {
      const text = await run("whisper");
      const timing = await run("parakeet");
      const aligned = alignTimings(text, timing);
      writeJson(join(dir, "alignment.json"), { matched: Math.round(aligned.matched * 100) / 100, whisper: text.length, parakeet: timing.length });
      raw = aligned.words;
    } else raw = await run(engine);
    writeJson(out, await cleanTranscript(raw, wav));
  });
  const alignment = engine === "hybrid" ? readJson<{ matched: number }>(join(dir, "alignment.json")) : null;
  return { ...res, words: readJson<Word[]>(out), path: out, engine, alignment };
}

function findTranscriptPath(stdout: string): string | null {
  try {
    return JSON.parse(stdout.trim().split("\n").pop() ?? "{}").transcriptPath ?? null;
  } catch {
    return null;
  }
}

/**
 * Whisper invents words over silence ("Merci." at the end, repeated lines over a silent tail): drop words that start
 * inside the trailing silence, and empty / non-word tokens. Re-id words w0..wN.
 * Words "inside" a mid-rush silence are kept: ASR times drift by up to 0.7 s, so such a word is usually real.
 */
async function cleanTranscript(raw: Word[], wav: string): Promise<Word[]> {
  const { silences } = await findSilences(wav, 0.6);
  const tail = silences.find((s) => s.end === Infinity);
  return raw
    .filter((w) => w.text && /[\p{L}\p{N}]/u.test(w.text) && !/[♪�]/.test(w.text))
    .filter((w) => !(tail && w.start >= tail.start))
    .map((w, i) => ({ id: `w${i}`, text: w.text.trim(), start: round(w.start), end: round(Math.max(w.end, w.start + 0.04)) }));
}

const round = (t: number) => Math.round(t * 1000) / 1000;
