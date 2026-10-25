import type { Style } from "../lib/style.js";
import { endsSentence, norm, STOPWORDS, type Word } from "../lib/words.js";
import type { Beats } from "./beats.js";

type Mograph = Beats["mographs"][number];
type Caption = Beats["captions"][number];

/**
 * Contextual motion design, the way AI editors pick visuals (a stat gets a big number, a process gets steps, a
 * question gets a card…), from the transcript alone: rules on French phrasing, no model. Every graphic is a proposal
 * in beats.json that the reviewing agent can drop or rewrite.
 */

const DOMAIN = /^(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|fr|io|app|click|net|org|sn|co|dev|ai|tv|me|shop|site|store))\b/i;

/** Keyword → emoji, matched on normalized words (accents ignored). Kept small and unambiguous. */
const EMOJI: [string[], string][] = [
  [["argent", "prix", "euros", "euro", "fcfa", "budget", "payer", "paiement", "gagner", "gagnez"], "💰"],
  [["minutes", "minute", "secondes", "heures", "temps", "rapide", "rapidement", "vite"], "⏱️"],
  [["site", "internet", "web", "ligne", "lien"], "🌐"],
  [["idee", "astuce", "conseil", "secret"], "💡"],
  [["attention", "piege", "danger", "erreur", "probleme"], "⚠️"],
  [["telephone", "mobile", "application", "appli", "whatsapp"], "📱"],
  [["video", "videos", "montage", "film", "camera"], "🎬"],
  [["gratuit", "gratuitement", "offert", "cadeau"], "🎁"],
  [["simple", "facile", "facilement", "pret", "prete", "valide"], "✅"],
  [["evenement", "mariage", "fete", "invitation", "invitations", "anniversaire", "bapteme"], "🎉"],
  [["photo", "photos", "image", "images", "galerie"], "📸"],
  [["template", "templates", "modele", "modeles", "design"], "🎨"],
];

/** Kinetic captions: one key word per group (the highest-scored content word, if it stands out at all). */
export function emphasize(captions: Caption[], scores: Map<string, number>, threshold = 0.6, gap = 1.2): void {
  // With two or three words a group, a key word in every group reads as flashing: one every `gap` seconds at most,
  // unless the word stands far out (score 1.5).
  let lastEnd = -Infinity;
  for (const g of captions) {
    let best = -1, bestScore = threshold;
    g.words.forEach((w, i) => {
      // "n'y" is "y", "l'expliquais" is "expliquais"; discourse ("du coup", "plutôt") is never the key word.
      const n = norm(w.text).replace(/^[a-z]'/, "");
      if (n.length < 3 || STOPWORDS.has(n) || GREETINGS.has(n) || DISCOURSE.has(n)) return;
      const s = scores.get(w.id) ?? -Infinity;
      if (s > bestScore) [best, bestScore] = [i, s];
    });
    if (best < 0 || (g.start - lastEnd < gap && bestScore < 1.5)) continue;
    g.emphasis = best;
    lastEnd = g.end;
  }
}

/** An emoji above a caption group when one of its words calls for it; at most one every `gap` seconds. */
export function addEmojis(captions: Caption[], gap = 3.5): void {
  let last = -Infinity;
  let lastEmoji = "";
  for (const g of captions) {
    if (g.start - last < gap) continue;
    for (const [i, w] of g.words.entries()) {
      const n = norm(w.text);
      // "pas de problème" is not a ⚠️: a negation just before the word flips it.
      const negated = g.words.slice(Math.max(0, i - 2), i).some((x) => NEGATIONS.has(norm(x.text)));
      const hit = negated ? undefined : EMOJI.find(([keys]) => keys.includes(n));
      // The same emoji twice in a row reads as a stutter (🎬 🎬 🎬 on "vidéo… vidéos… montage").
      if (hit && hit[1] !== lastEmoji) {
        lastEmoji = hit[1];
        g.emoji = hit[1];
        last = g.start;
        break;
      }
    }
  }
}

const NEGATIONS = new Set(["pas", "sans", "aucun", "aucune", "jamais", "ni", "plus"]);

/** Greetings never make a hook ("Bonjour" was picked as the title of a real intro). */
const GREETINGS = new Set(["bonjour", "bonsoir", "salut", "coucou", "hello", "hey", "yo", "bienvenue"]);
const LEAD = [["du", "coup"], ["en", "fait"], ["donc"], ["alors"], ["bon"], ["et"], ["mais"], ["voila"], ["bref"], ["enfin"], ["genre"]];
const TAIL = [["vous", "voyez"], ["tu", "vois"], ["et", "tout"], ["quoi"], ["hein"], ["voila"], ["en", "fait"]];

/** "du coup le site … en 10 minutes, vous voyez" → "le site … en 10 minutes": discourse off both ends of a clause. */
function trimDiscourse(c: Word[]): Word[] {
  let a = 0, b = c.length;
  for (let again = true; again;) {
    again = false;
    for (const ph of LEAD) {
      if (ph.every((p, k) => norm(c[a + k]?.text ?? "") === p) && b - a > ph.length) {
        a += ph.length;
        again = true;
      }
    }
    for (const ph of TAIL) {
      if (ph.every((p, k) => norm(c[b - ph.length + k]?.text ?? "") === p) && b - a > ph.length) {
        b -= ph.length;
        again = true;
      }
    }
  }
  return c.slice(a, b);
}

/** Discourse markers and fillers that carry no message ("du coup", "en fait", "voilà"…). */
const DISCOURSE = new Set(["coup", "fait", "gros", "voila", "bref", "genre", "truc", "chose", "choses", "quoi", "enfin", "vraiment", "simplement", "plutot", "sorte", "espece", "quelque"]);
/** "…, vous voyez ?" asks nothing: no question card for tag questions. */
const TAG_QUESTIONS = ["vous voyez", "tu vois", "hein", "non", "d'accord", "ok", "pas vrai", "n'est ce pas", "tu sais", "vous savez"];

const tidy = (t: string) => t.replace(/[.,!?;:…"«»]/g, "").trim();

function contentAround(words: Word[], i: number, dir: -1 | 1, max = 4): string | null {
  for (let k = 1; k <= max; k++) {
    const w = words[i + dir * k];
    if (!w) return null;
    const n = norm(w.text);
    if (n.length >= 3 && !STOPWORDS.has(n)) return tidy(w.text);
  }
  return null;
}

/** Index of the word ending phrase `phrase` (normalized words) starting at i, or -1. */
function matchPhrase(words: Word[], i: number, phrase: string[]): number {
  for (let k = 0; k < phrase.length; k++) if (norm(words[i + k]?.text ?? "") !== phrase[k]) return -1;
  return i + phrase.length - 1;
}

const COMPARE = [["au", "lieu", "de"], ["plutot", "que"], ["contrairement", "a"], ["versus"], ["vs"], ["par", "rapport", "a"]];
// Hyphenated phrases reach us as one transcript word ("c'est-à-dire" → "c'estadire"), so both forms are listed.
const DEFINE = [["c'estadire"], ["c'est", "a", "dire"], ["ca", "veut", "dire"], ["signifie"], ["autrement", "dit"]];
const CTA = [
  ["abonnetoi"], ["abonne", "toi"], ["abonnezvous"], ["abonnez", "vous"], ["lien", "en", "bio"], ["commente"], ["commentez"],
  ["partage"], ["partagez"], ["rendezvous", "sur"], ["rendez", "vous", "sur"], ["allez", "sur"], ["va", "sur"], ["clique"],
  ["cliquez"], ["telechargez"], ["inscrivezvous"], ["inscrivez", "vous"],
];

/**
 * Graphics proposed from the phrasing. Times are on the cut timeline. The caller rations them with the other
 * graphics (minimum gap, no overlap with behind-words).
 */
export function contextualGraphics(words: Word[], duration: number, style: Style, scores: Map<string, number>): Mograph[] {
  const out: Mograph[] = [];
  const at = (w: Word, len = 2.4) => ({ start: Math.max(0.1, w.start - 0.1), end: Math.min(duration - 0.1, w.start + len) });

  // Hook: the opening sentence's two strongest words as a title over the first seconds.
  if (style.mograph.hook && words.length) {
    const first: Word[] = [];
    for (const w of words) {
      first.push(w);
      if (endsSentence(w.text) || w.end > 4) break;
    }
    const picks = first
      .filter((w) => norm(w.text).length >= 3 && !STOPWORDS.has(norm(w.text)) && !GREETINGS.has(norm(w.text)))
      .sort((a, b) => (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0))
      .slice(0, 2)
      .sort((a, b) => a.start - b.start);
    if (picks.length) {
      out.push({ id: "", kind: "hook", start: 0.15, end: Math.min(duration - 0.1, Math.max(2.6, picks[picks.length - 1].end + 1.2)),
        text: picks.map((w) => tidy(w.text)).join(" "), items: picks.map((w) => tidy(w.text)), wordId: picks[0].id });
    }
  }

  words.forEach((w, i) => {
    // URL / domain: a typed address bar.
    const dm = DOMAIN.exec(w.text.trim().toLowerCase());
    // Typed in under a second: 1.9 s on screen leaves room for what follows.
    if (dm) out.push({ id: "", kind: "url", ...at(w, 1.9), text: dm[1], wordId: w.id });

    // Comparison: "X au lieu de Y", "contrairement à Y"…
    for (const ph of COMPARE) {
      const end = matchPhrase(words, i, ph);
      if (end < 0) continue;
      const a = contentAround(words, i, -1), b = contentAround(words, end, 1);
      if (a && b) out.push({ id: "", kind: "compare", ...at(w, 2.8), text: `${a} vs ${b}`, items: [a, b], wordId: w.id });
    }

    // Definition: "X, c'est-à-dire Y Z…"
    for (const ph of DEFINE) {
      const end = matchPhrase(words, i, ph);
      if (end < 0) continue;
      const term = contentAround(words, i, -1);
      const meaning = words.slice(end + 1, end + 5).map((x) => x.text).join(" ");
      if (term && meaning) out.push({ id: "", kind: "definition", ...at(w, 3), text: term, items: [term, tidy(meaning)], wordId: w.id });
    }

    // Call to action, in the last third.
    if (w.start > duration * 0.66) {
      for (const ph of CTA) {
        const end = matchPhrase(words, i, ph);
        if (end < 0) continue;
        const phrase = words.slice(i, Math.min(words.length, end + 3)).map((x) => x.text).join(" ");
        out.push({ id: "", kind: "cta", ...at(w, 3), text: tidy(phrase), wordId: w.id });
      }
    }
  });

  // Questions: a sentence ending in "?", short enough to read as a title.
  let sentence: Word[] = [];
  for (const w of words) {
    sentence.push(w);
    if (endsSentence(w.text)) {
      const tail = sentence.slice(-3).map((x) => norm(x.text)).join(" ");
      const rhetorical = TAG_QUESTIONS.some((q) => tail.endsWith(q));
      if (w.text.trim().endsWith("?") && !rhetorical && sentence.length >= 3 && sentence.length <= 9) {
        out.push({ id: "", kind: "question", start: Math.max(0.1, sentence[0].start - 0.1), end: Math.min(duration - 0.1, w.end + 1.2),
          text: sentence.map((x) => x.text).join(" "), wordId: sentence[0].id });
      }
      sentence = [];
    }
  }
  return out.map((m) => ({ ...m, start: r(m.start), end: r(m.end) }));
}

const r = (t: number) => Math.round(t * 1000) / 1000;

type Scene = Beats["scenes"][number];

/**
 * Kinetic typography scenes: the strongest short clauses (3–8 words, said in ≤3.2 s) cut to full-screen type, the
 * punchline device of top short-form edits. Clauses split at punctuation or a 0.5 s pause; a clause scores by its
 * two strongest words, plus a number or an exclamation. Never on a screen recording, a reduced frame, a behind-word.
 */
export function pickScenes(
  words: Word[], scores: Map<string, number>, duration: number, style: Style, blocked: { start: number; end: number }[],
): Scene[] {
  if (!style.scenes.max) return [];
  const clauses: Word[][] = [];
  let cur: Word[] = [];
  words.forEach((w, i) => {
    cur.push(w);
    const next = words[i + 1];
    if (!next || /[,.;:!?…]$/.test(w.text.trim()) || next.start - w.end >= 0.5) {
      clauses.push(cur);
      cur = [];
    }
  });
  // A scene needs two real content words: "donc du coup," was once picked as a punchline.
  const content = (w: Word) => {
    const n = norm(w.text);
    return n.length >= 4 && !STOPWORDS.has(n) && !GREETINGS.has(n) && !DISCOURSE.has(n);
  };
  const scored = clauses
    .map(trimDiscourse)
    .filter((c) => c.length >= 3 && c.length <= 10 && c[c.length - 1].end - c[0].start <= 3.6 && c[0].start > 1)
    .filter((c) => c.filter(content).length >= 2)
    .map((c) => {
      const s = c.map((w) => (norm(w.text).length >= 3 && !STOPWORDS.has(norm(w.text)) ? scores.get(w.id) ?? 0 : -9)).sort((a, b) => b - a);
      const bonus = (c.some((w) => /\d/.test(w.text)) ? 0.8 : 0) + (/!$/.test(c[c.length - 1].text) ? 0.3 : 0);
      return { c, score: (s[0] + (s[1] ?? 0)) / 2 + bonus };
    })
    // Better no scene than a limp one: the clause must stand out from the speaker's average (scores are z-scores).
    .filter((x) => x.score >= 0.6)
    .sort((a, b) => b.score - a.score);
  const out: Scene[] = [];
  for (const { c } of scored) {
    if (out.length >= style.scenes.max) break;
    const win = { start: Math.max(0, c[0].start - 0.12), end: Math.min(duration - 0.05, c[c.length - 1].end + 0.3) };
    // A full-screen cut can follow another graphic almost at once: 0.1 s apart is enough.
    if (blocked.some((b) => win.start < b.end + 0.1 && b.start - 0.1 < win.end)) continue;
    if (out.some((o) => Math.abs(o.start - win.start) < style.scenes.minGap)) continue;
    let emphasis = -1, best = -Infinity;
    c.forEach((w, i) => {
      const n = norm(w.text);
      if (n.length < 3 || STOPWORDS.has(n) || GREETINGS.has(n)) return;
      const sc = scores.get(w.id) ?? 0;
      if (sc > best) [emphasis, best] = [i, sc];
    });
    out.push({ id: "", start: r(win.start), end: r(win.end), words: c, ...(emphasis >= 0 ? { emphasis } : {}) });
  }
  return out.sort((a, b) => a.start - b.start).map((s, i) => ({ ...s, id: `sc${i}` }));
}
