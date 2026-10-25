import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import { ROOT } from "./project.js";

const Color = z.string().regex(/^(#[0-9a-fA-F]{3,8}|rgba?\(.+\))$/, "hex or rgb()/rgba() colour");

export const StyleSchema = z.object({
  name: z.string(),
  description: z.string().default(""),
  fonts: z.object({
    /** Bundled HyperFrames families resolve by name (Inter, Montserrat, Oswald, League Gothic, Archivo Black, Playfair Display, Poppins…). */
    caption: z.string().default("Montserrat"),
    captionWeight: z.number().default(800),
    behind: z.string().default("League Gothic"),
    behindWeight: z.number().default(400),
    graphic: z.string().default("Inter"),
  }).prefault({}),
  colors: z.object({
    text: Color.default("#ffffff"),
    accent: Color.default("#ffd400"),
    stroke: Color.default("rgba(0,0,0,0.55)"),
    behind: Color.default("#ffffff"),
    panel: Color.default("rgba(10,10,10,0.78)"),
  }).prefault({}),
  rhythm: z.object({
    /** Silence threshold in dB, or "auto" (from the rush's own noise floor: see findSilences). */
    silenceDb: z.union([z.literal("auto"), z.number()]).default("auto"),
    minPause: z.number().default(0.35),
    /** Breath kept on each side of a tightened pause. */
    keep: z.number().default(0.12),
    removeFillers: z.boolean().default(true),
    removeRetakes: z.boolean().default(true),
  }).prefault({}),
  captions: z.object({
    enabled: z.boolean().default(true),
    maxWords: z.number().int().min(1).max(8).default(3),
    /** A group also closes before it passes this many characters: one line, read at a glance. */
    maxChars: z.number().int().min(6).default(18),
    /** A pause at least this long starts a new caption group. */
    breakPause: z.number().default(0.15),
    uppercase: z.boolean().default(false),
    /**
     * bold: white heavy type, black outline, the spoken word turns accent and pops (Hormozi / Beast).
     * pill: the spoken word sits on an accent pill hopping from word to word. editorial: the key word in a serif
     * italic, larger (documentary). minimal: heavy white, thin outline, no colour ("dynamic minimalism").
     */
    look: z.enum(["bold", "pill", "editorial", "minimal"]).default("bold"),
    /**
     * pop: the group springs up, every word shown. slam: each word bursts in when spoken. rise: each word rises when
     * spoken. karaoke: every word shown dimmed and lit when spoken.
     */
    animation: z.enum(["pop", "rise", "karaoke", "slam"]).default("pop"),
    /** Font size in px at 1080 px short side (portrait gets 15 % more). */
    size: z.number().default(80),
    /** The key word on its own line when it opens or closes the group. */
    stack: z.boolean().default(true),
    /** Face of the key word (default: the caption face) and whether it is italic (editorial look). */
    keyFont: z.string().optional(),
    keyItalic: z.boolean().default(false),
    highlightActive: z.boolean().default(true),
    /** Solid box behind each caption group (colors.panel), minimal look inside: reads over any footage. */
    box: z.boolean().default(false),
    /** Vertical placement: low (chest / lower third) or mid (centre of frame, reel style). */
    position: z.enum(["low", "mid"]).default("low"),
    /**
     * Kinetic captions: the strongest word of each group is set larger, stays in the accent colour and lands with a
     * bounce (animate the key word, not every word). Size factor of that word, 1 = off.
     */
    emphasis: z.number().min(1).max(1.8).default(1.3),
    /** A contextual emoji pops above a caption when a word calls for it (💰 prix, ⏱️ minutes, 🌐 site…). */
    emojis: z.boolean().default(false),
  }).prefault({}),
  behind: z.object({
    enabled: z.boolean().default(true),
    max: z.number().int().min(0).max(3).default(2),
    /** Seconds the word stays behind the subject. */
    hold: z.number().default(1.6),
    /** Minimum seconds between two behind-words. */
    minGap: z.number().default(5),
    animation: z.enum(["slam", "rise", "track", "flip"]).default("slam"),
    /** Largest cap height as a fraction of frame height (the placement may shrink it). */
    size: z.number().default(0.34),
    /** Hide the captions while a behind-word is on screen: the big word is the caption, and gets the full height. */
    hideCaptions: z.boolean().default(false),
    /** Share of the word the subject should hide, measured on the matte (0.3–0.5 reads best). */
    coverage: z.number().min(0.1).max(0.7).default(0.4),
  }).prefault({}),
  mograph: z.object({
    enabled: z.boolean().default(true),
    minGap: z.number().default(3),
    /** Keyword lexicon (lowercase, accents ignored) → graphic kind. Numbers trigger `counter` automatically. */
    triggers: z.array(z.object({
      words: z.array(z.string()),
      kind: z.enum(["callout", "underline", "badge", "list"]),
      label: z.string().optional(),
    })).default([]),
    numbers: z.boolean().default(true),
    /**
     * Contextual graphics from what is said: a question card, a typed URL bar, an A-vs-B comparison, a definition,
     * a call to action near the end.
     */
    contextual: z.boolean().default(true),
    /** A title over the first seconds, from the strongest words of the opening sentence. */
    hook: z.boolean().default(false),
  }).prefault({}),
  motion: z.object({
    /** Subtle punch-in on behind-words and graphics (scale factor, 1 = none). */
    punchIn: z.number().min(1).max(1.3).default(1.06),
    /**
     * Alternate framing on every jump cut (scale factor, 1 = none): one take wide, the next tight. Hides the
     * jump of a talking-head cut the way editors do by hand.
     */
    jumpZoom: z.number().min(1).max(1.3).default(1),
    /**
     * Depth of the motion design (0 flat, 1 strong): graphics enter rotating in 3D perspective, titles and
     * behind-words get an extruded 3D face. CSS 3D, cheap without a GPU (WebGL would not be).
     */
    depth: z.number().min(0).max(1).default(0),
    /** After Effects-style motion blur on everything that moves fast (words, titles, graphics). Costs render time. */
    blur: z.boolean().default(false),
    /** Slow push-in on every take (scale reached at the end of a take, 1 = off), alternating in and out. */
    drift: z.number().min(1).max(1.12).default(1),
    ease: z.string().default("power3.out"),
  }).prefault({}),
  scenes: z.object({
    /**
     * Full-screen kinetic typography: on the strongest short sentences the picture cuts to an animated background
     * where each word slams in as it is spoken. At most this many (0 = off).
     */
    max: z.number().int().min(0).max(5).default(0),
    /** Minimum seconds between two scenes. */
    minGap: z.number().default(8),
    /** Background: an animated gradient from the style colours, or near-black. */
    background: z.enum(["gradient", "dark"]).default("gradient"),
  }).prefault({}),
  frame: z.object({
    /**
     * Shrink the footage into a rounded card while a motion graphic plays, to give it room: "mographs" does it for
     * counters, lists and callouts, "none" never. Assemblies can also shrink a whole part over B-roll.
     */
    reduceOn: z.enum(["none", "mographs"]).default("none"),
    /** Card width as a share of the frame width. */
    cardScale: z.number().min(0.4).max(0.95).default(0.74),
    /** Bubble width (face over a screen recording) as a share of the frame width. */
    bubbleScale: z.number().min(0.2).max(0.5).default(0.36),
    /** Corner radius in px at 1080 px short side. */
    radius: z.number().min(0).max(120).default(44),
    /** Screen recordings (screen parts and B-roll) shown in a floating 3D phone instead of flat. */
    device: z.boolean().default(false),
    /** Stage colour behind a reduced frame (when there is no B-roll). */
    stage: z.string().default("#0d1117"),
  }).prefault({}),
  effects: z.object({
    /** At most this many effects in any 10 s (colour pop excluded): above ~3 the edit reads as noise. */
    maxPer10s: z.number().min(0).max(6).default(2),
    /** On strong words (behind-words, counters, callouts): a fast zoom punch, a camera shake, or both. */
    strongWord: z.enum(["none", "zoomPunch", "shake", "both"]).default("none"),
    /** On jump cuts: a white flash, a whip pan, a glitch, or all three in turn (mix). */
    cuts: z.enum(["none", "flash", "whip", "glitch", "mix"]).default("none"),
    /** Only every Nth usable cut gets the cut effect. */
    cutEvery: z.number().int().min(1).max(10).default(3),
    /** Warm light leaks sweeping across the frame, spread over the video. */
    lightLeaks: z.number().int().min(0).max(5).default(0),
    /** The world turns black and white while a behind-word is on screen; the subject keeps its colour. */
    colorPop: z.boolean().default(false),
    /** A chromatic RGB split rides on every zoom punch and shake (baked into the footage by FFmpeg). */
    rgbSplit: z.boolean().default(false),
    /** Zoom ladders (hard zoom steps) opening this many of the longest takes. */
    ladder: z.number().int().min(0).max(4).default(0),
    /** Spoken words (lowercase, accents ignored) that trigger an effect. */
    keywords: z.array(z.object({
      words: z.array(z.string()),
      kind: z.enum(["shake", "zoomPunch", "flash", "glitch", "rgbSplit", "strobe"]),
    })).default([]),
    /** Scales shake amplitude, punch size and flash strength. */
    intensity: z.number().min(0.2).max(2).default(1),
  }).prefault({}),
  look: z.object({
    /** Colour look baked by FFmpeg (src/steps/look.ts). */
    grade: z.enum(["none", "deep-contrast", "clean-studio", "bright-pop", "muted-editorial", "warm-daylight", "mono-clean"]).default("none"),
    gradeIntensity: z.number().min(0).max(1).default(0.8),
    vignette: z.number().min(0).max(1).default(0),
    /** Deterministic film grain (0–1). */
    grain: z.number().min(0).max(1).default(0),
    /** Letterbox bars to this aspect ratio on landscape exports (e.g. 2.39), 0 = none. */
    letterbox: z.number().min(0).max(3).default(0),
  }).prefault({}),
  audio: z.object({
    denoise: z.boolean().default(true),
    lufs: z.number().default(-16),
    /** "auto" picks the first track in assets/music, a filename picks that one, "none" disables music. */
    music: z.string().default("auto"),
    musicDb: z.number().default(-22),
    /** Extra attenuation of the music while the voice speaks. */
    duckDb: z.number().default(10),
    sfx: z.boolean().default(true),
    sfxDb: z.number().default(-14),
  }).prefault({}),
});

export type Style = z.infer<typeof StyleSchema>;

/** Deep merge of plain objects (arrays and scalars replace). */
export function deepMerge(base: Record<string, unknown>, extra: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(extra)) {
    const b = out[k];
    const plain = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
    out[k] = plain(b) && plain(v) ? deepMerge(b, v) : v;
  }
  return out;
}

export const STYLES_DIR = join(ROOT, "styles");

export function listStyles(): { name: string; description: string }[] {
  if (!existsSync(STYLES_DIR)) return [];
  return readdirSync(STYLES_DIR)
    .filter((f) => f.endsWith(".yaml"))
    .map((f) => {
      const s = loadStyle(f.replace(/\.yaml$/, ""));
      return { name: s.name, description: s.description };
    });
}

/**
 * A style, optionally with a project's overrides (from a recipe or questionnaire answers) deep-merged in before
 * validation, so a typo in an override fails like one in the YAML.
 */
export function loadStyle(name: string, overrides: Record<string, unknown> = {}): Style {
  const file = join(STYLES_DIR, `${name}.yaml`);
  if (!existsSync(file)) {
    const known = existsSync(STYLES_DIR) ? readdirSync(STYLES_DIR).map((f) => f.replace(/\.yaml$/, "")) : [];
    throw new Error(`Unknown style "${name}". Available: ${known.join(", ") || "(none)"}`);
  }
  const parsed = StyleSchema.safeParse(deepMerge(parse(readFileSync(file, "utf8")), overrides));
  if (!parsed.success) throw new Error(`styles/${name}.yaml is invalid:\n${z.prettifyError(parsed.error)}`);
  return parsed.data;
}
