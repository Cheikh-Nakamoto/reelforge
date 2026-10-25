import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { run } from "../lib/exec.js";
import { ffprobe, measureLoudness } from "../lib/ffmpeg.js";
import { kindLevels, measureSfx, sfxCatalog } from "../lib/sfx.js";
import { cached, Project, readJson, ROOT, writeJson, codeOf } from "../lib/project.js";
import type { Style } from "../lib/style.js";
import type { Beats } from "./beats.js";

const AUDIO_EXT = /\.(wav|mp3|m4a|aac|flac|ogg|opus)$/i;
const SFX_DIR = join(ROOT, "assets", "sfx");
const MUSIC_DIR = join(ROOT, "assets", "music");

/**
 * Procedural sound effects (ffmpeg expressions, no samples, no licence): used when assets/sfx has no
 * <kind>*.wav of its own.
 */
const SYNTH: Record<Beats["sfx"][number]["kind"], { d: number; src: string; af: string }> = {
  whoosh: {
    d: 0.55,
    src: "anoisesrc=color=pink:amplitude=0.6:d=0.55:seed=7",
    af: "highpass=f=300,lowpass=f=4500,afade=t=in:curve=exp:d=0.38,afade=t=out:st=0.38:d=0.17:curve=qsin",
  },
  pop: {
    d: 0.16,
    src: "aevalsrc='0.8*sin(2*PI*(500+1100*exp(-t*45))*t)*exp(-t*28)':d=0.16",
    af: "highpass=f=200",
  },
  click: {
    d: 0.05,
    src: "aevalsrc='0.7*sin(2*PI*2400*t)*exp(-t*160)':d=0.05",
    af: "highpass=f=800",
  },
  glitch: {
    d: 0.35,
    src: "aevalsrc='0.6*sin(2*PI*(220+1800*gt(mod(t*40,1),0.5))*t)*lt(mod(t*13,1),0.7)':d=0.35",
    af: "highpass=f=300,afade=t=out:st=0.28:d=0.07",
  },
  hit: {
    d: 0.45,
    src: "aevalsrc='0.9*sin(2*PI*(48+140*exp(-t*22))*t)*exp(-t*8)+0.15*(random(0)-0.5)*exp(-t*60)':d=0.45",
    af: "lowpass=f=6000",
  },
};

/**
 * The sound for a cue: from the library in assets/sfx/<kind>/ (scripts/fetch-sfx.sh, CC0), rotating through its files
 * by cue number so a video does not repeat one sound; else a loose assets/sfx/<kind>*.wav; else synthesised.
 */
async function sfxFile(kind: keyof typeof SYNTH, cacheDir: string, n = 0): Promise<{ path: string; source: string }> {
  const lib = join(SFX_DIR, kind);
  if (existsSync(lib)) {
    const files = readdirSync(lib).filter((f) => AUDIO_EXT.test(f)).sort();
    if (files.length) {
      // Step through the library one file per cue (a fixed stride equal to the file count repeated one sound).
      const f = files[n % files.length];
      return { path: join(lib, f), source: `${kind}/${f}` };
    }
  }
  if (existsSync(SFX_DIR)) {
    const own = readdirSync(SFX_DIR).filter((f) => f.startsWith(kind) && AUDIO_EXT.test(f)).sort()[0];
    if (own) return { path: join(SFX_DIR, own), source: own };
  }
  mkdirSync(cacheDir, { recursive: true });
  const out = join(cacheDir, `${kind}.wav`);
  if (!existsSync(out)) {
    const s = SYNTH[kind];
    await run("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", s.src, "-af", `${s.af},aformat=sample_rates=48000:channel_layouts=stereo`, out]);
  }
  return { path: out, source: "synthétisé" };
}

function pickMusic(style: Style): string | null {
  if (style.audio.music === "none") return null;
  if (style.audio.music !== "auto") {
    const p = join(MUSIC_DIR, style.audio.music);
    if (!existsSync(p)) throw new Error(`Music track not found: assets/music/${style.audio.music}`);
    return p;
  }
  if (!existsSync(MUSIC_DIR)) return null;
  const f = readdirSync(MUSIC_DIR).filter((x) => AUDIO_EXT.test(x)).sort()[0];
  return f ? join(MUSIC_DIR, f) : null;
}

/** Two-pass EBU R128 normalization to `lufs` integrated, -1.5 dBTP. */
async function loudnorm(input: string, output: string, lufs: number, pre = "") {
  const target = `I=${lufs}:TP=-1.5:LRA=11`;
  const { stderr } = await run("ffmpeg", [
    "-hide_banner", "-nostats", "-i", input, "-af", `${pre}loudnorm=${target}:print_format=json`, "-f", "null", "-",
  ]);
  const m = JSON.parse(stderr.slice(stderr.lastIndexOf("{"), stderr.lastIndexOf("}") + 1));
  await run("ffmpeg", [
    "-v", "error", "-y", "-i", input, "-af",
    `${pre}loudnorm=${target}:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:` +
      `measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true,aresample=48000`,
    "-ar", "48000", "-ac", "2", "-c:a", "pcm_s24le", output,
  ]);
}

export interface AudioReport {
  voice: { denoise: boolean; lufs: number };
  music: string | null;
  /** `at`: where the sound lands (attack, or a whoosh's peak); `start`: where its file starts; `gainDb` applied. */
  sfx: { kind: string; at: number; source: string; start: number; gainDb: number }[];
  final: { integrated: number; truePeak: number; lra: number };
  notes: string[];
}

export async function audio(project: Project, style: Style, opts: { force?: boolean } = {}) {
  const cut = project.path("cut", "cut.mp4");
  // The beats as composed (minus words the composition had to drop), else as proposed.
  const finalPath = project.path("compose", "final-beats.json");
  const beatsPath = existsSync(finalPath) ? finalPath : project.path("compose", "beats.json");
  const out = project.path("audio", "mix.wav");
  const reportPath = project.path("audio", "audio.json");
  const music = pickMusic(style);
  // The SFX library is an input too: fetching it (scripts/fetch-sfx.sh) re-mixes.
  const library = ["whoosh", "pop", "hit", "click", "glitch"].map((k) => join(SFX_DIR, k)).filter((d) => existsSync(d))
    .flatMap((d) => readdirSync(d).filter((f) => AUDIO_EXT.test(f)).map((f) => join(d, f)));

  const res = await cached(project, "audio", {
    code: codeOf(import.meta.url),
    inputs: [cut, beatsPath, ...(music ? [music] : []), ...library],
    params: { a: style.audio },
    version: 2,
    outputs: [out, reportPath],
    force: opts.force,
  }, async () => {
    const dir = project.stepDir("audio");
    const notes: string[] = [];
    const beats = readJson<Beats>(beatsPath);
    const { duration } = await ffprobe(cut);

    // 1. Voice: rumble cut, FFT denoise, gentle compression, normalized to the target.
    const voice = join(dir, "voice.wav");
    const clean = style.audio.denoise ? "highpass=f=80,afftdn=nf=-25:tn=1," : "highpass=f=70,";
    await loudnorm(cut, voice, style.audio.lufs,
      `${clean}acompressor=threshold=-21dB:ratio=3:attack=8:release=160:makeup=2,`);

    // 2. Bed: voice + optional ducked music + sfx at their cues.
    const inputs = ["-i", voice];
    const filters: string[] = ["[0:a]asplit=2[v][key]"];
    const mixIn = ["[v]"];
    if (music) {
      inputs.push("-stream_loop", "-1", "-i", music);
      const fadeOut = Math.max(0, duration - 1.5).toFixed(2);
      filters.push(
        `[1:a]aformat=sample_rates=48000:channel_layouts=stereo,atrim=0:${duration.toFixed(3)},volume=${style.audio.musicDb}dB,` +
          `afade=t=in:d=1.0,afade=t=out:st=${fadeOut}:d=1.5[m]`,
        // Ducking: the voice keys a compressor on the music. Ratio from the requested reduction.
        `[m][key]sidechaincompress=threshold=0.03:ratio=${Math.max(2, style.audio.duckDb / 2).toFixed(1)}:attack=25:release=450:makeup=1[md]`,
      );
      mixIn.push("[md]");
    } else {
      filters.push("[key]anullsink");
      notes.push(style.audio.music === "none" ? "Musique désactivée par le style." :
        "Aucune musique dans assets/music : mixage voix + SFX seulement.");
    }
    const sfxUsed: AudioReport["sfx"] = [];
    const catalog = await sfxCatalog(SFX_DIR);
    const levels = kindLevels(catalog);
    let idx = music ? 2 : 1;
    for (const cue of beats.sfx ?? []) {
      const f = await sfxFile(cue.kind, join(dir, "sfx"), sfxUsed.filter((u) => u.kind === cue.kind).length);
      const info = catalog[f.source] ?? (await measureSfx(f.path));
      // A cue is the instant the sound lands: a whoosh's peak, any other sound's attack. A sound whose lead-in
      // would start before 0 loses that much of its head.
      const start = cue.at - (cue.kind === "whoosh" ? info.peak : info.onset);
      const trim = start < 0 ? `atrim=start=${(-start).toFixed(3)},asetpts=PTS-STARTPTS,` : "";
      const ms = Math.round(Math.max(0, start) * 1000);
      // Every file of a kind plays at the kind's median level (the rotation must not jump in loudness).
      const gainDb = Math.round((style.audio.sfxDb + Math.max(-9, Math.min(9, (levels[cue.kind] ?? info.level) - info.level))) * 10) / 10;
      inputs.push("-i", f.path);
      filters.push(`[${idx}:a]aformat=sample_rates=48000:channel_layouts=stereo,${trim}volume=${gainDb}dB,adelay=${ms}|${ms}[s${idx}]`);
      mixIn.push(`[s${idx}]`);
      sfxUsed.push({ kind: cue.kind, at: cue.at, source: f.source, start: Math.round(Math.max(0, start) * 1000) / 1000, gainDb });
      idx++;
    }
    filters.push(`${mixIn.join("")}amix=inputs=${mixIn.length}:normalize=0:duration=first[mix]`);
    const premix = join(dir, "premix.wav");
    await run("ffmpeg", [
      "-v", "error", "-y", ...inputs, "-filter_complex", filters.join(";"), "-map", "[mix]",
      "-t", duration.toFixed(3), "-ar", "48000", "-c:a", "pcm_s24le", premix,
    ]);

    // 3. Master to the delivery target.
    await loudnorm(premix, out, style.audio.lufs);
    const final = await measureLoudness(out);
    if (Math.abs(final.integrated - style.audio.lufs) > 1) notes.push(`Loudness ${final.integrated} LUFS hors tolérance.`);
    writeJson(reportPath, {
      voice: { denoise: style.audio.denoise, lufs: style.audio.lufs },
      music: music ? music.slice(MUSIC_DIR.length + 1) : null,
      sfx: sfxUsed,
      final,
      notes,
    } satisfies AudioReport);
  });
  return { ...res, mix: out, report: readJson<AudioReport>(reportPath) };
}
