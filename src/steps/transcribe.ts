import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hyperframes } from "../lib/exec.js";
import { silencedetect } from "../lib/ffmpeg.js";
import { cached, Project, readJson, writeJson } from "../lib/project.js";
import type { Word } from "../lib/words.js";

export type Engine = "parakeet" | "whisper";

export interface TranscribeOptions {
  /**
   * parakeet (default): NVIDIA Parakeet TDT 0.6B v3 via sherpa-onnx, multilingual, word times within ~0.2 s and
   * 3-4x faster than whisper on CPU. whisper: whisper.cpp, better French spelling but word times off by up to 0.7 s.
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
  const engine = opts.engine ?? "parakeet";
  const language = opts.language ?? "fr";
  const model = opts.model ?? "large-v3-turbo";
  const wav = project.path("ingest", "audio16k.wav");
  const out = project.path("transcribe", "words.json");
  const dir = project.stepDir("transcribe");

  const res = await cached(project, "transcribe", {
    inputs: [wav],
    params: engine === "whisper" ? { engine, language, model } : { engine },
    version: 2,
    outputs: [out],
    force: opts.force,
  }, async () => {
    const args = engine === "whisper"
      ? ["--engine", "whisper", "--model", model, "--language", language, "--timeout", "1800000"]
      : ["--engine", "parakeet"];
    const { stdout } = await hyperframes(["transcribe", wav, "--dir", dir, ...args, "--json"]);
    const reported = JSON.parse(stdout.trim().split("\n").pop() ?? "{}");
    if (reported.engine && reported.engine !== engine) {
      throw new Error(`Asked for ${engine} but HyperFrames ran ${reported.engine}. Install it: npx hyperframes models install parakeet`);
    }
    const transcriptPath = findTranscriptPath(stdout) ?? join(dir, "transcript.json");
    const raw = JSON.parse(readFileSync(transcriptPath, "utf8")) as Word[];
    const words = await cleanTranscript(raw, wav);
    writeJson(out, words);
  });
  return { ...res, words: readJson<Word[]>(out), path: out, engine };
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
  const silences = await silencedetect(wav, -35, 0.6);
  const tail = silences.find((s) => s.end === Infinity);
  return raw
    .filter((w) => w.text && /[\p{L}\p{N}]/u.test(w.text) && !/[♪�]/.test(w.text))
    .filter((w) => !(tail && w.start >= tail.start))
    .map((w, i) => ({ id: `w${i}`, text: w.text.trim(), start: round(w.start), end: round(Math.max(w.end, w.start + 0.04)) }));
}

const round = (t: number) => Math.round(t * 1000) / 1000;
