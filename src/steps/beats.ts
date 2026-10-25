import { z } from "zod";
import type { Style } from "../lib/style.js";
import { endsClause, norm, numericValue, STOPWORDS, type Word } from "../lib/words.js";
import { addEmojis, contextualGraphics, emphasize, pickScenes } from "./contextual.js";
import { behindFxClashes, fxSound, proposeEffects } from "./effects.js";
import type { MatteReport } from "./matte.js";

const WordZ = z.object({ id: z.string(), text: z.string(), start: z.number(), end: z.number() });

export const BeatsSchema = z.object({
  duration: z.number(),
  captions: z.array(z.object({
    id: z.string(), start: z.number(), end: z.number(), words: z.array(WordZ),
    /** Index of the key word set larger and in the accent colour (kinetic captions). */
    emphasis: z.number().int().optional(),
    /** Contextual emoji popping above the group. */
    emoji: z.string().optional(),
  })),
  behind: z.array(z.object({
    id: z.string(), wordId: z.string().optional(), text: z.string(), start: z.number(), end: z.number(),
    score: z.number().optional(),
  })),
  mographs: z.array(z.object({
    id: z.string(),
    kind: z.enum(["counter", "callout", "underline", "badge", "list", "question", "url", "compare", "definition", "cta", "hook"]),
    /** compare: [left, right]; definition: [term, meaning]; hook: title lines. */
    items: z.array(z.string()).optional(),
    start: z.number(), end: z.number(),
    text: z.string(),
    value: z.number().optional(),
    suffix: z.string().optional(),
    label: z.string().optional(),
    wordId: z.string().optional(),
  })),
  sfx: z.array(z.object({ id: z.string(), kind: z.enum(["whoosh", "pop", "hit", "click", "glitch"]), at: z.number() })),
  /** Cut-timeline instants of the jump cuts (where the rush was cut), for cut-synced framing changes. */
  cuts: z.array(z.number()).default([]),
  /**
   * Frame reductions: the footage shrinks into a rounded card (room for graphics) or a corner bubble (over a screen
   * recording or other B-roll), then returns to full frame.
   */
  frames: z.array(z.object({
    id: z.string(),
    mode: z.enum(["card", "bubble"]),
    start: z.number(),
    end: z.number(),
    /** Footage shown full-frame behind the reduced speaker (muted), from `from` seconds into it. */
    broll: z.object({ src: z.string(), from: z.number().default(0) }).optional(),
    reason: z.string().optional(),
  })).default([]),
  /** Full-screen kinetic typography: the sentence's words slam in as they are spoken. */
  scenes: z.array(z.object({
    id: z.string(),
    start: z.number(),
    end: z.number(),
    words: z.array(WordZ),
    /** Index of the word set in the accent colour. */
    emphasis: z.number().int().optional(),
  })).default([]),
  /** Parts of an assembled video (several rushes): screen recordings have no speaker to cut out. */
  parts: z.array(z.object({ name: z.string(), kind: z.enum(["face", "screen"]), start: z.number(), end: z.number() })).default([]),
  /** Visual effects: camera shake, zoom punch, white flash, whip pan, light leak, colour pop (subject in colour). */
  fx: z.array(z.object({
    id: z.string(),
    kind: z.enum(["shake", "zoomPunch", "flash", "whip", "lightLeak", "colorPop", "rgbSplit", "glitch", "strobe", "ladder"]),
    at: z.number(),
    duration: z.number(),
    /** Why it is there (strong word, cut, keyword…), for the reviewer. */
    reason: z.string().optional(),
  })).default([]),
  notes: z.array(z.string()).default([]),
});

export type Beats = z.infer<typeof BeatsSchema>;

/** Words that lean on the next one: a caption group never ends on them ("programme de | modification"). */
const CLINGERS = new Set(
  ("a au aux ce ces cet cette d de des du en et l la le les leur leurs ma mes mon nos notre ou par pour qu qu'on " +
    "que qui sa sans ses son sur ta tes ton un une vos votre avec dans chez entre vers mais donc car si " +
    "je j' tu il elle on nous vous ils elles ne n' n'y y me m' te t' se s' c' l'").split(" "),
);

/**
 * Caption groups: break at the word or character limit, a pause of `breakPause`, a clause end or a comma; one group
 * on screen. A group cut by a limit hands a trailing article or preposition on to the next group.
 */
export function groupCaptions(words: Word[], style: Style, duration: number): Beats["captions"] {
  const groups: Word[][] = [];
  let cur: Word[] = [];
  for (const w of words) {
    const prev = cur[cur.length - 1];
    const chars = cur.reduce((n, x) => n + x.text.length + 1, 0) + w.text.length;
    const natural = !!prev && (w.start - prev.end >= style.captions.breakPause || endsClause(prev.text) || /,$/.test(prev.text));
    if (prev && (natural || cur.length >= style.captions.maxWords || chars > style.captions.maxChars)) {
      const carry = !natural && cur.length > 1 && CLINGERS.has(norm(prev.text)) ? [cur.pop()!] : [];
      groups.push(cur);
      cur = carry;
    }
    cur.push(w);
  }
  if (cur.length) groups.push(cur);
  return groups.map((g, i) => {
    const next = groups[i + 1];
    const start = Math.max(i === 0 ? 0.1 : 0, g[0].start - 0.05);
    const end = Math.min(next ? next[0].start - 0.02 : duration - 0.05, g[g.length - 1].end + 0.45);
    return { id: `cap${i}`, start: r(start), end: r(Math.max(end, start + 0.3)), words: g };
  });
}

function zscores(xs: number[]): number[] {
  const m = xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length);
  const sd = Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, xs.length)) || 1;
  return xs.map((x) => (x - m) / sd);
}

/** z-score of each value against the values whose word starts within ±`span` seconds of it. */
function localZscores(words: Word[], xs: number[], span: number): number[] {
  return xs.map((x, i) => {
    const near = xs.filter((_, j) => Math.abs(words[j].start - words[i].start) <= span);
    const m = near.reduce((s, v) => s + v, 0) / near.length;
    const sd = Math.sqrt(near.reduce((s, v) => s + (v - m) ** 2, 0) / near.length) || 1;
    return (x - m) / sd;
  });
}

/**
 * Score each content word for "say it big": louder than the speaker's average, held longer per letter, long words,
 * words closing a clause, numbers. Function words and very short words are never candidates.
 */
export function scoreWords(words: Word[], rms: number[], windowSec = 0.05) {
  const energy = words.map((w) => {
    const a = Math.floor(w.start / windowSec), b = Math.max(a + 1, Math.ceil(w.end / windowSec));
    const xs = rms.slice(a, b);
    return xs.length ? Math.max(...xs) : -60;
  });
  const perChar = words.map((w) => (w.end - w.start) / Math.max(1, norm(w.text).length));
  // Loudness counts against the voice around the word (±6 s), not the whole video: joined rushes are recorded at
  // different levels, and a quiet screen recording made every word in it look weak.
  const ze = localZscores(words, energy, 6), zd = zscores(perChar);
  return words.map((w, i) => {
    const n = norm(w.text);
    const candidate = n.length >= 4 && !STOPWORDS.has(n) && !n.includes("'");
    const score = ze[i] + 0.5 * zd[i] + (n.length >= 6 ? 0.4 : 0) + (endsClause(w.text) ? 0.6 : 0) +
      (numericValue(w.text) !== null ? 0.5 : 0);
    return { word: w, candidate, score: r(score) };
  });
}

const NEGATIONS = new Set(["pas", "jamais", "aucun", "aucune", "sans", "rien", "ni", "plus", "not", "no", "never"]);

const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }, margin = 0) =>
  a.start < b.end + margin && b.start < a.end + margin;

/** Matte margin around a behind-word: the cutout is shown 0.1 s early and the window adds slack on both sides. */
export function matteWindowFor(b: { start: number; end: number }) {
  return { start: Math.max(0, b.start - 0.3), end: b.end + 0.25 };
}

/**
 * `checkWindow` mattes a candidate window at full rate and says whether it is stable; a rejected candidate is
 * replaced by the next best word. Without a survey (no person found) no word goes behind.
 */
export async function proposeBeats(
  words: Word[],
  rms: number[],
  duration: number,
  style: Style,
  matte: MatteReport | null,
  checkWindow?: (start: number, end: number) => Promise<{ ok: boolean; why?: string }>,
  cuts: number[] = [],
  assembly: { parts: Beats["parts"]; frames: Beats["frames"]; transitions?: number[] } = { parts: [], frames: [] },
): Promise<Beats> {
  const notes: string[] = [];
  // No speaker to cut out on a screen recording, nor while the footage is reduced to a card or bubble.
  const noSpeaker = [
    ...assembly.parts.filter((p) => p.kind === "screen"),
    ...assembly.frames.map((f) => ({ start: f.start - 0.4, end: f.end + 0.4 })),
  ];
  const speakerFree = (a: number, b: number) => !noSpeaker.some((x) => a < x.end && x.start < b);
  const captions = style.captions.enabled ? groupCaptions(words, style, duration) : [];
  const scored = scoreWords(words, rms);
  const scores = new Map(scored.map((s) => [s.word.id, s.score]));
  if (style.captions.emphasis > 1) emphasize(captions, scores);
  if (style.captions.emojis) addEmojis(captions);

  // ---- words behind the subject
  const behind: Beats["behind"] = [];
  if (style.behind.enabled && style.behind.max > 0) {
    if (!matte) notes.push("Pas de détourage : aucun mot derrière le sujet.");
    else if (matte.verdict === "bad") {
      notes.push(
        `Personne mal détectée (présente sur ${Math.round(matte.presence * 100)} % des images échantillonnées) : ` +
          "mots derrière désactivés.",
      );
    } else {
      const ranked = scored
        .filter((s) => s.candidate && s.word.start > 0.5 && s.word.start + style.behind.hold < duration - 0.3)
        .sort((a, b) => b.score - a.score);
      const rejected: string[] = [];
      // Each rejected candidate costs a matte pass: stop after a few.
      let tries = 0;
      for (const s of ranked) {
        if (behind.length >= style.behind.max || tries >= style.behind.max + 3) break;
        const win = { start: r(s.word.start - 0.08), end: r(s.word.start - 0.08 + style.behind.hold) };
        if (!speakerFree(win.start, win.end)) continue;
        if (behind.some((b) => overlaps(win, b, style.behind.minGap))) continue;
        if (checkWindow) {
          tries++;
          const mw = matteWindowFor(win);
          const verdict = await checkWindow(mw.start, mw.end);
          if (!verdict.ok) {
            rejected.push(`« ${s.word.text} » à ${win.start.toFixed(1)} s (${verdict.why ?? "instable"})`);
            continue;
          }
        }
        behind.push({ id: `bh${behind.length}`, wordId: s.word.id, text: s.word.text.replace(/[.,!?;:…"«»]/g, ""), ...win, score: s.score });
      }
      if (rejected.length) {
        notes.push(`Détourage instable, mot(s) derrière écarté(s) : ${rejected.join(", ")}. Cause probable : mouvement rapide ou fond chargé.`);
      }
      behind.sort((a, b) => a.start - b.start);
      behind.forEach((b, i) => (b.id = `bh${i}`));
    }
  }

  // ---- kinetic typography scenes: punchlines cut to full-screen type
  // A scene may cut away from a screen recording, not from under a reduced speaker or a behind-word.
  // URLs and calls to action outrank a scene: their windows are kept free.
  // Only their useful part is reserved (typed / read in ~1.3 s); a scene may then cut them short.
  const keep = style.mograph.enabled && style.mograph.contextual
    ? contextualGraphics(words, duration, style, scores).filter((g) => g.kind === "url" || g.kind === "cta")
      .map((g) => ({ start: g.start, end: g.start + 1.3 }))
    : [];
  const scenes = pickScenes(words, scores, duration, style, [...assembly.frames, ...behind, ...keep]);
  // A graphic a scene cuts into is shortened to end as the scene starts (if 1 s of it remains), else dropped.
  const sceneFree = (a: { start: number; end: number }) => {
    const hit = scenes.find((s) => overlaps(a, s, 0.05));
    if (!hit) return true;
    if (hit.start > a.start && hit.start - 0.05 - a.start >= 1) {
      a.end = r(hit.start - 0.05);
      return true;
    }
    return false;
  };

  // ---- motion graphics triggered by spoken words
  const mographs: Beats["mographs"] = [];
  // Contextual graphics first (a question, a URL, a comparison… says more than a keyword badge), then keywords.
  if (style.mograph.enabled && style.mograph.contextual) {
    for (const c of contextualGraphics(words, duration, style, scores).sort((a, b) => a.start - b.start)) {
      if (mographs.some((m) => overlaps(c, m, c.kind === "hook" ? 0.3 : style.mograph.minGap))) continue;
      if (c.kind !== "hook" && behind.some((b) => overlaps(c, b, 0.3))) continue;
      if (!sceneFree(c)) continue;
      mographs.push({ ...c, id: `mg${mographs.length}` });
    }
  }
  if (style.mograph.enabled) {
    const lexicon = style.mograph.triggers.flatMap((t) => t.words.map((w) => ({ key: norm(w), t })));
    words.forEach((w, i) => {
      const n = norm(w.text);
      let beat: Beats["mographs"][number] | null = null;
      const value = style.mograph.numbers ? numericValue(w.text) : null;
      if (value !== null && value >= 2) {
        // Label: the next one or two content words ("30 jours", "50 % de marge").
        // Stop at the clause end: "50 euros par mois. Attention" must not label the counter "euros attention".
        const after: Word[] = [];
        for (const x of words.slice(i + 1, i + 5)) {
          after.push(x);
          // A label is the noun group after the number: stop at any punctuation ("10 minutes, vous voyez").
          if (/[,.;:!?…]$/.test(x.text) || endsClause(words[i].text)) break;
        }
        // The natural phrase ("euros par mois"), at most 3 words, never ending on a function word.
        const phrase = endsClause(w.text) ? [] : after.slice(0, 3);
        while (phrase.length && STOPWORDS.has(norm(phrase[phrase.length - 1].text))) phrase.pop();
        const label = phrase.map((x) => x.text.replace(/[.,!?;:…]/g, "")).join(" ");
        const suffix = /%/.test(w.text) || norm(words[i + 1]?.text ?? "").startsWith("pourcent") ? "%" :
          /€/.test(w.text) || norm(words[i + 1]?.text ?? "") === "euros" ? "€" : "";
        beat = { id: "", kind: "counter", start: w.start - 0.1, end: w.start + 2.4, text: w.text, value, suffix, label, wordId: w.id };
      } else {
        const hit = lexicon.find((l) => l.key === n);
        // "ça ne pose pas de problème" must not raise a "PROBLÈME!" callout: skip negated keywords.
        const negated = words.slice(Math.max(0, i - 4), i).some((x) => NEGATIONS.has(norm(x.text)));
        if (hit && !negated) {
          beat = {
            id: "", kind: hit.t.kind, start: w.start - 0.1, end: w.start + 2.2,
            text: (hit.t.label ?? w.text).replace(/[.,!?;:…]/g, ""), label: hit.t.label, wordId: w.id,
          };
        }
      }
      if (!beat) return;
      beat.start = r(Math.max(0.1, beat.start));
      beat.end = r(Math.min(duration - 0.1, beat.end));
      if (mographs.some((m) => overlaps(beat!, m, style.mograph.minGap))) return;
      if (behind.some((b) => overlaps(beat!, b, 0.3))) return;
      if (!sceneFree(beat)) return;
      mographs.push({ ...beat, id: `mg${mographs.length}` });
    });
  }

  // ---- frame reductions: the assembly's (a face over B-roll), then cards that give motion graphics room
  const frames: Beats["frames"] = assembly.frames.map((f) => ({ ...f }));
  if (style.frame.reduceOn === "mographs") {
    for (const m of mographs) {
      if (m.kind !== "counter" && m.kind !== "list" && m.kind !== "callout") continue;
      const win = { start: r(Math.max(0, m.start - 0.25)), end: r(Math.min(duration, m.end + 0.35)) };
      if (frames.some((f) => overlaps(win, f, 0.8)) || behind.some((b) => overlaps(win, b, 0.3))) continue;
      frames.push({ id: "", mode: "card", ...win, reason: `${m.kind} « ${m.text} »` });
    }
  }
  frames.sort((a, b) => a.start - b.start).forEach((f, i) => (f.id = `fr${i}`));

  // ---- visual effects
  const fx = proposeEffects(words, { behind, mographs, cuts, duration, scenes }, style);

  // ---- sound design cues (one cue per moment: an effect does not stack a second sound on a graphic's)
  const sfx: Beats["sfx"] = [];
  if (style.audio.sfx) {
    const add = (kind: Beats["sfx"][number]["kind"], at: number) => {
      if (!sfx.some((x) => Math.abs(x.at - at) < 0.3)) sfx.push({ id: "", kind, at: r(Math.max(0, at)) });
    };
    // A cue is where the sound lands (audio.ts aligns a whoosh's peak, any other sound's attack, on it).
    for (const tr of assembly.transitions ?? []) add("whoosh", tr);
    for (const b of behind) add("whoosh", behindWhooshAt(b.start));
    for (const sc of scenes) {
      add("hit", sc.start + 0.02);
      if (sc.emphasis !== undefined) add("pop", sc.words[sc.emphasis].start);
      add("whoosh", sc.end - 0.1);
    }
    for (const m of mographs) {
      if (m.kind === "url") {
        // Keystrokes while the address types itself (the bar starts typing 0.35 s in).
        for (let k = 0; k < Math.min(4, m.text.length); k++) sfx.push({ id: "", kind: "click", at: r(m.start + 0.38 + k * 0.13) });
        continue;
      }
      add(m.kind === "counter" || m.kind === "hook" ? "hit" : "pop", m.start);
    }
    for (const f of fx) {
      const k = fxSound(f.kind);
      // A whip's whoosh peaks on its cut (mid-effect); a flash hits on its peak.
      if (k) add(k, f.kind === "whip" ? f.at + f.duration / 2 : f.kind === "flash" ? f.at + 0.03 : f.at);
      // A ladder ticks on each of its zoom steps.
      if (f.kind === "ladder") for (let s = 1; s < 4; s++) sfx.push({ id: "", kind: "click", at: r(f.at + (s * (f.duration - 0.18)) / 4) });
    }
    sfx.sort((a, b) => a.at - b.at).forEach((x, i) => (x.id = `sfx${i}`));
  }

  if (!behind.length && style.behind.enabled && matte && matte.verdict !== "bad") {
    notes.push("Aucun mot fort trouvé hors des zones instables.");
  }
  return { duration: r(duration), captions, behind, mographs, sfx, cuts: cuts.map(r), fx, frames, scenes, parts: assembly.parts, notes };
}

const r = (t: number) => Math.round(t * 1000) / 1000;

/** Where a behind-word's whoosh peaks: as the word lands (its entrance runs 0.28–0.5 s). */
export const behindWhooshAt = (start: number) => r(start + 0.1);

/** One-line-per-beat summary for the reviewer (LLM or human). */
export function beatsSummary(b: Beats): string {
  const lines = [
    `Durée ${b.duration.toFixed(1)} s · ${b.captions.length} groupes de sous-titres · ${b.behind.length} mot(s) derrière · ` +
      `${b.mographs.length} motion graphic(s) · ${b.fx.length} effet(s) · ${b.sfx.length} SFX`,
  ];
  for (const x of b.behind) lines.push(`  derrière  ${x.start.toFixed(2)}–${x.end.toFixed(2)}  « ${x.text} » (score ${x.score ?? "-"})`);
  for (const s of b.scenes) lines.push(`  scène     ${s.start.toFixed(2)}–${s.end.toFixed(2)}  « ${s.words.map((w) => w.text).join(" ")} »`);
  for (const f of b.frames) lines.push(`  cadre ${f.mode.padEnd(6)} ${f.start.toFixed(2)}–${f.end.toFixed(2)}  ${f.broll ? `sur ${f.broll.src} ` : ""}${f.reason ?? ""}`);
  for (const f of b.fx) lines.push(`  fx ${f.kind.padEnd(9)} ${f.at.toFixed(2)}–${(f.at + f.duration).toFixed(2)}  ${f.reason ?? ""}`);
  for (const m of b.mographs) lines.push(`  ${m.kind.padEnd(9)} ${m.start.toFixed(2)}–${m.end.toFixed(2)}  « ${m.text} »${m.label ? ` / ${m.label}` : ""}`);
  for (const n of b.notes) lines.push(`  ⚠ ${n}`);
  // Told at review, not only in QA: a hand-edited camera effect under a behind-word is neutralized at composition.
  for (const c of behindFxClashes(b)) lines.push(`  ⚠ ${c.note}`);
  for (const w of b.behind) {
    const fr = b.frames.find((f) => w.start < f.end && w.end > f.start);
    if (fr) lines.push(`  ⚠ Mot derrière « ${w.text} » dans la réduction de cadre ${fr.id} : il sera retiré à la composition (décision 9).`);
  }
  return lines.join("\n");
}
