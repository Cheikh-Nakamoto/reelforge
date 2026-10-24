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
    /** Silence detection threshold and the shortest pause that gets tightened. */
    silenceDb: z.number().default(-35),
    minPause: z.number().default(0.35),
    /** Breath kept on each side of a tightened pause. */
    keep: z.number().default(0.12),
    removeFillers: z.boolean().default(true),
    removeRetakes: z.boolean().default(true),
  }).prefault({}),
  captions: z.object({
    enabled: z.boolean().default(true),
    maxWords: z.number().int().min(1).max(8).default(4),
    /** A pause at least this long starts a new caption group. */
    breakPause: z.number().default(0.15),
    uppercase: z.boolean().default(false),
    /** pop: group springs in, active word highlighted. rise: words rise one by one. karaoke: colour sweep. */
    animation: z.enum(["pop", "rise", "karaoke"]).default("pop"),
    /** Font size in px at 1080 px short side. */
    size: z.number().default(64),
    highlightActive: z.boolean().default(true),
    /** Solid box behind each caption group (colors.panel) instead of a stroke: reads over any footage. */
    box: z.boolean().default(false),
    /** Vertical placement: low (chest / lower third) or mid (centre of frame, reel style). */
    position: z.enum(["low", "mid"]).default("low"),
  }).prefault({}),
  behind: z.object({
    enabled: z.boolean().default(true),
    max: z.number().int().min(0).max(3).default(2),
    /** Seconds the word stays behind the subject. */
    hold: z.number().default(1.6),
    /** Minimum seconds between two behind-words. */
    minGap: z.number().default(5),
    animation: z.enum(["slam", "rise", "track"]).default("slam"),
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
  }).prefault({}),
  motion: z.object({
    /** Subtle punch-in on behind-words and graphics (scale factor, 1 = none). */
    punchIn: z.number().min(1).max(1.3).default(1.06),
    /**
     * Alternate framing on every jump cut (scale factor, 1 = none): one take wide, the next tight. Hides the
     * jump of a talking-head cut the way editors do by hand.
     */
    jumpZoom: z.number().min(1).max(1.3).default(1),
    ease: z.string().default("power3.out"),
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

export function loadStyle(name: string): Style {
  const file = join(STYLES_DIR, `${name}.yaml`);
  if (!existsSync(file)) {
    const known = existsSync(STYLES_DIR) ? readdirSync(STYLES_DIR).map((f) => f.replace(/\.yaml$/, "")) : [];
    throw new Error(`Unknown style "${name}". Available: ${known.join(", ") || "(none)"}`);
  }
  const parsed = StyleSchema.safeParse(parse(readFileSync(file, "utf8")));
  if (!parsed.success) throw new Error(`styles/${name}.yaml is invalid:\n${z.prettifyError(parsed.error)}`);
  return parsed.data;
}
