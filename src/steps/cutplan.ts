import type { Silence } from "../lib/ffmpeg.js";
import { endsClause, FILLERS, norm, RESTART_MARKERS, type Word } from "../lib/words.js";

export type CutReason = "filler" | "stutter" | "retake" | "restart-marker" | "manual";

export interface PlanWord extends Word {
  keep: boolean;
  reason?: CutReason;
}

export interface Segment {
  start: number;
  end: number;
}

export interface CutParams {
  minPause: number;
  keep: number;
  removeFillers: boolean;
  removeRetakes: boolean;
  /** Word ids the reviewer wants removed / kept regardless of the heuristics. */
  remove?: string[];
  restore?: string[];
}

export interface CutPlan {
  version: 1;
  sourceDuration: number;
  params: CutParams;
  words: PlanWord[];
  /** Source-time ranges that survive, in order. */
  keep: Segment[];
  keptDuration: number;
  approved: boolean;
}

/** A take: words between two pauses (or clause ends), the unit retake detection compares. */
interface Phrase {
  idx: number[];
}

function splitPhrases(words: Word[], pause = 0.45): Phrase[] {
  const out: Phrase[] = [];
  let cur: number[] = [];
  words.forEach((w, i) => {
    if (cur.length) {
      const prev = words[cur[cur.length - 1]];
      if (w.start - prev.end >= pause || endsClause(prev.text)) {
        out.push({ idx: cur });
        cur = [];
      }
    }
    cur.push(i);
  });
  if (cur.length) out.push({ idx: cur });
  return out;
}

/** Number of leading tokens two token lists share. */
function commonPrefix(a: string[], b: string[]): number {
  let k = 0;
  while (k < a.length && k < b.length && a[k] === b[k]) k++;
  return k;
}

/**
 * Mark words to drop. Deterministic, no model:
 *  - fillers ("euh", "bah"…) when they stand alone;
 *  - stutters: a word immediately repeated ("le le") keeps the second;
 *  - retakes: a phrase whose opening is restarted by one of the next two phrases is a failed take (keep the last);
 *  - restart markers ("je recommence"…) drop the phrase that contains them and the failed take before.
 */
export function markWords(words: Word[], p: CutParams): PlanWord[] {
  const out: PlanWord[] = words.map((w) => ({ ...w, keep: true }));
  const toks = words.map((w) => norm(w.text));

  if (p.removeFillers) {
    toks.forEach((t, i) => {
      if (FILLERS.has(t)) Object.assign(out[i], { keep: false, reason: "filler" });
    });
    for (let i = 0; i + 1 < toks.length; i++) {
      // A repeated word, even across a short hesitation ("vos… vos invitations": 0.72 s on a real rush).
      if (toks[i] && toks[i] === toks[i + 1] && words[i + 1].start - words[i].end < 1.2 && out[i].keep) {
        Object.assign(out[i], { keep: false, reason: "stutter" });
      }
    }
  }

  if (p.removeRetakes) {
    const phrases = splitPhrases(words);
    const ptoks = phrases.map((ph) => ph.idx.map((i) => toks[i]).filter((t) => t && !FILLERS.has(t)));
    const drop = new Set<number>();
    phrases.forEach((ph, a) => {
      const text = ptoks[a].join(" ");
      const marker = RESTART_MARKERS.find((m) => (" " + text + " ").includes(" " + m + " "));
      if (marker) {
        drop.add(a);
        if (a > 0) drop.add(a - 1);
        out[ph.idx[0]].reason = "restart-marker";
      }
      for (const b of [a + 1, a + 2]) {
        if (b >= phrases.length) break;
        const k = commonPrefix(ptoks[a], ptoks[b]);
        // Two shared opening words, or most of a short aborted phrase, means the speaker started over.
        const restarted = k >= 2 && (k >= 3 || ptoks[a].length <= 6 || k / ptoks[a].length >= 0.5);
        if (restarted) {
          drop.add(a);
          // Anything spoken between the failed take and its restart goes too ("non attends", a sigh).
          for (let c = a + 1; c < b; c++) drop.add(c);
          break;
        }
      }
    });
    for (const a of drop) {
      for (const i of phrases[a].idx) {
        const reason = out[phrases[a].idx[0]].reason === "restart-marker" ? "restart-marker" : "retake";
        Object.assign(out[i], { keep: false, reason });
      }
    }
  }

  for (const id of p.remove ?? []) {
    const w = out.find((x) => x.id === id);
    if (w) Object.assign(w, { keep: false, reason: "manual" });
  }
  for (const id of p.restore ?? []) {
    const w = out.find((x) => x.id === id);
    if (w) Object.assign(w, { keep: true, reason: undefined });
  }
  return out;
}

/**
 * Turn kept words into source ranges. A range closes when a dropped word sits between two kept words, or when a
 * pause of at least `minPause` (measured on the audio, whisper stretches words over pauses) separates them.
 * Each boundary keeps `keep` seconds of breath, never reaching into a dropped word.
 */
export function buildSegments(words: PlanWord[], silences: Silence[], duration: number, p: CutParams): Segment[] {
  const kept = words.map((w, i) => ({ w, i })).filter((x) => x.w.keep);
  if (!kept.length) return [];
  const segs: Segment[] = [];
  let start = Math.max(0, kept[0].w.start - p.keep);
  // Never open before a dropped word that precedes the first kept one.
  if (kept[0].i > 0) start = Math.max(start, words[kept[0].i - 1].end);

  for (let k = 0; k + 1 < kept.length; k++) {
    const a = kept[k];
    const b = kept[k + 1];
    const removedBetween = b.i - a.i > 1;
    // A pause belongs to this gap when its centre falls between the two words' centres: ASR edges stretch into
    // pauses, so a pause overlapping the next word's span may still be the gap after it.
    const midA = (a.w.start + a.w.end) / 2;
    const midB = (b.w.start + b.w.end) / 2;
    const pause = silences.find((s) => {
      const c = (s.start + s.end) / 2;
      return s.end - s.start >= p.minPause && c > midA && c < midB;
    });
    if (removedBetween) {
      const firstRemoved = words[a.i + 1];
      const lastRemoved = words[b.i - 1];
      // ASR word edges drift by 0.2–0.7 s: when the audio has a pause near the edge, cut inside that pause instead.
      let end = Math.min(a.w.end + p.keep, Math.max(a.w.end, firstRemoved.start));
      const close = silences
        .filter((s) => s.end - s.start >= 0.12 && s.start >= a.w.start && s.start <= firstRemoved.start + 0.3 && s.end >= a.w.end - 0.3)
        .sort((x, y) => x.start - y.start)[0];
      if (close) end = Math.min(close.start + p.keep, close.end);
      segs.push({ start, end });
      let open = Math.max(b.w.start - p.keep, Math.min(b.w.start, lastRemoved.end));
      const reopen = silences
        .filter((s) => s.end - s.start >= 0.12 && s.end <= b.w.end && s.end >= lastRemoved.end - 0.3 && s.start <= b.w.start + 0.3)
        .sort((x, y) => y.end - x.end)[0];
      if (reopen) open = Math.max(reopen.end - p.keep, reopen.start);
      start = Math.max(open, end);
    } else if (pause) {
      // The measured pause bounds the cut, not the ASR word edges (which may sit inside it).
      const end = Math.min(pause.start + p.keep, pause.end);
      segs.push({ start, end });
      start = Math.max(pause.end - p.keep, end);
    }
  }
  const last = kept[kept.length - 1];
  let end = Math.min(duration, last.w.end + p.keep * 2);
  if (last.i + 1 < words.length) end = Math.min(end, Math.max(last.w.end, words[last.i + 1].start));
  segs.push({ start, end });

  // Merge ranges separated by less than a frame, drop slivers.
  const merged: Segment[] = [];
  for (const s of segs) {
    if (s.end - s.start < 0.08) continue;
    const prev = merged[merged.length - 1];
    if (prev && s.start - prev.end < 0.04) prev.end = Math.max(prev.end, s.end);
    else merged.push({ start: r(s.start), end: r(s.end) });
  }
  return merged.map((s) => ({ start: r(s.start), end: r(s.end) }));
}

const r = (t: number) => Math.round(t * 1000) / 1000;

export function makePlan(words: Word[], silences: Silence[], duration: number, p: CutParams): CutPlan {
  const marked = markWords(words, p);
  const keep = buildSegments(marked, silences, duration, p);
  return {
    version: 1,
    sourceDuration: r(duration),
    params: p,
    words: marked,
    keep,
    keptDuration: r(keep.reduce((s, x) => s + x.end - x.start, 0)),
    approved: false,
  };
}

/** Map a source time into the cut timeline, or null when it falls in a removed range. */
export function mapTime(keep: Segment[], t: number): number | null {
  let offset = 0;
  for (const s of keep) {
    if (t < s.start) return null;
    if (t <= s.end) return offset + (t - s.start);
    offset += s.end - s.start;
  }
  return null;
}

/** Kept words re-timed onto the cut timeline (clamped into their segment). */
export function remapWords(plan: CutPlan): Word[] {
  const out: Word[] = [];
  let offset = 0;
  const offsets = plan.keep.map((s) => {
    const o = offset;
    offset += s.end - s.start;
    return o;
  });
  for (const w of plan.words) {
    if (!w.keep) continue;
    // The segment it overlaps most: ASR stretches a word into the following pause, so its midpoint can fall in a
    // tightened gap while the spoken part is kept.
    let si = -1, best = 0;
    plan.keep.forEach((s, k) => {
      const ov = Math.min(s.end, w.end) - Math.max(s.start, w.start);
      if (ov > best) [si, best] = [k, ov];
    });
    if (si < 0 || best < 0.03) continue;
    const s = plan.keep[si];
    const start = offsets[si] + Math.max(0, w.start - s.start);
    const end = offsets[si] + Math.min(s.end - s.start, w.end - s.start);
    out.push({ id: w.id, text: w.text, start: r(start), end: r(Math.max(end, start + 0.04)) });
  }
  return out;
}

const REASON_FR: Record<CutReason, string> = {
  filler: "hésitation",
  stutter: "bégaiement",
  retake: "prise ratée",
  "restart-marker": "reprise annoncée",
  manual: "retiré à la main",
};

const ts = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, "0")}`;

/** Human-readable plan: transcript with ~~removed~~ words, tightened pauses and the reason for each cut. */
export function planMarkdown(plan: CutPlan): string {
  const lines: string[] = [];
  lines.push(`# Plan de coupe`, "");
  lines.push(
    `Durée source **${plan.sourceDuration.toFixed(1)} s** → montée **${plan.keptDuration.toFixed(1)} s** ` +
      `(${(plan.sourceDuration - plan.keptDuration).toFixed(1)} s retirées, ${plan.keep.length} plans). ` +
      `Statut : ${plan.approved ? "**appliqué**" : "**en attente de validation**"}.`,
    "",
  );
  lines.push(`## Texte`, "", "Les mots ~~barrés~~ sont retirés. `‖` marque une coupe de silence.", "");
  let para = "";
  let prevEnd = 0;
  for (const w of plan.words) {
    const gapCut = plan.keep.some((s) => s.start > prevEnd + 0.01 && s.start <= w.start + 0.01) && w.keep;
    if (gapCut && para) para += " ‖";
    para += " " + (w.keep ? w.text : `~~${w.text}~~`);
    prevEnd = w.end;
    if (endsClause(w.text) && para.length > 200) {
      lines.push(para.trim(), "");
      para = "";
    }
  }
  if (para) lines.push(para.trim(), "");

  lines.push(`## Coupes`, "", "| Début | Fin | Raison | Mots (ids) |", "|---|---|---|---|");
  let run: PlanWord[] = [];
  const flush = () => {
    if (!run.length) return;
    const reason = REASON_FR[run[0].reason ?? "manual"];
    const text = run.map((w) => w.text).join(" ");
    lines.push(`| ${ts(run[0].start)} | ${ts(run[run.length - 1].end)} | ${reason} | ${text} (${run[0].id}…${run[run.length - 1].id}) |`);
    run = [];
  };
  for (const w of plan.words) {
    if (!w.keep && (!run.length || run[0].reason === w.reason)) run.push(w);
    else {
      flush();
      if (!w.keep) run.push(w);
    }
  }
  flush();
  lines.push("", `## Plans conservés`, "", plan.keep.map((s) => `${ts(s.start)}→${ts(s.end)}`).join(" · "), "");
  lines.push(
    "Pour corriger : `studio_cut_review` avec `remove: [ids]` / `restore: [ids]` (ou `studio cut --remove w12,w13`), puis `studio_cut_apply`.",
  );
  return lines.join("\n") + "\n";
}
