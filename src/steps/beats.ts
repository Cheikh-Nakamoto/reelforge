import { z } from "zod";
import type { Style } from "../lib/style.js";
import { endsClause, norm, numericValue, STOPWORDS, type Word } from "../lib/words.js";
import type { MatteReport } from "./matte.js";

const WordZ = z.object({ id: z.string(), text: z.string(), start: z.number(), end: z.number() });

export const BeatsSchema = z.object({
  duration: z.number(),
  captions: z.array(z.object({ id: z.string(), start: z.number(), end: z.number(), words: z.array(WordZ) })),
  behind: z.array(z.object({
    id: z.string(), wordId: z.string().optional(), text: z.string(), start: z.number(), end: z.number(),
    score: z.number().optional(),
  })),
  mographs: z.array(z.object({
    id: z.string(),
    kind: z.enum(["counter", "callout", "underline", "badge", "list"]),
    start: z.number(), end: z.number(),
    text: z.string(),
    value: z.number().optional(),
    suffix: z.string().optional(),
    label: z.string().optional(),
    wordId: z.string().optional(),
  })),
  sfx: z.array(z.object({ id: z.string(), kind: z.enum(["whoosh", "pop", "hit"]), at: z.number() })),
  /** Cut-timeline instants of the jump cuts (where the rush was cut), for cut-synced framing changes. */
  cuts: z.array(z.number()).default([]),
  notes: z.array(z.string()).default([]),
});

export type Beats = z.infer<typeof BeatsSchema>;

/** Caption groups: break at the word limit, a pause of `breakPause` or a clause end; never two groups on screen. */
export function groupCaptions(words: Word[], style: Style, duration: number): Beats["captions"] {
  const groups: Word[][] = [];
  let cur: Word[] = [];
  for (const w of words) {
    const prev = cur[cur.length - 1];
    if (prev && (cur.length >= style.captions.maxWords || w.start - prev.end >= style.captions.breakPause || endsClause(prev.text))) {
      groups.push(cur);
      cur = [];
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
  const ze = zscores(energy), zd = zscores(perChar);
  return words.map((w, i) => {
    const n = norm(w.text);
    const candidate = n.length >= 4 && !STOPWORDS.has(n) && !n.includes("'");
    const score = ze[i] + 0.5 * zd[i] + (n.length >= 6 ? 0.4 : 0) + (endsClause(w.text) ? 0.6 : 0) +
      (numericValue(w.text) !== null ? 0.5 : 0);
    return { word: w, candidate, score: r(score) };
  });
}

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
): Promise<Beats> {
  const notes: string[] = [];
  const captions = style.captions.enabled ? groupCaptions(words, style, duration) : [];
  const scored = scoreWords(words, rms);

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

  // ---- motion graphics triggered by spoken words
  const mographs: Beats["mographs"] = [];
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
          if (endsClause(x.text) || endsClause(words[i].text)) break;
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
        if (hit) {
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
      mographs.push({ ...beat, id: `mg${mographs.length}` });
    });
  }

  // ---- sound design cues
  const sfx: Beats["sfx"] = [];
  if (style.audio.sfx) {
    for (const b of behind) sfx.push({ id: `sfx${sfx.length}`, kind: "whoosh", at: r(Math.max(0, b.start - 0.12)) });
    for (const m of mographs) sfx.push({ id: `sfx${sfx.length}`, kind: m.kind === "counter" ? "hit" : "pop", at: m.start });
    sfx.sort((a, b) => a.at - b.at);
  }

  if (!behind.length && style.behind.enabled && matte && matte.verdict !== "bad") {
    notes.push("Aucun mot fort trouvé hors des zones instables.");
  }
  return { duration: r(duration), captions, behind, mographs, sfx, cuts: cuts.map(r), notes };
}

const r = (t: number) => Math.round(t * 1000) / 1000;

/** One-line-per-beat summary for the reviewer (LLM or human). */
export function beatsSummary(b: Beats): string {
  const lines = [
    `Durée ${b.duration.toFixed(1)} s · ${b.captions.length} groupes de sous-titres · ${b.behind.length} mot(s) derrière · ` +
      `${b.mographs.length} motion graphic(s) · ${b.sfx.length} SFX`,
  ];
  for (const x of b.behind) lines.push(`  derrière  ${x.start.toFixed(2)}–${x.end.toFixed(2)}  « ${x.text} » (score ${x.score ?? "-"})`);
  for (const m of b.mographs) lines.push(`  ${m.kind.padEnd(9)} ${m.start.toFixed(2)}–${m.end.toFixed(2)}  « ${m.text} »${m.label ? ` / ${m.label}` : ""}`);
  for (const n of b.notes) lines.push(`  ⚠ ${n}`);
  return lines.join("\n");
}
