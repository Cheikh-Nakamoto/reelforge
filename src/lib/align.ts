import { norm, type Word } from "./words.js";

export interface Aligned {
  words: Word[];
  /** Share of text words that found a timing word. */
  matched: number;
}

/**
 * Text from one transcript, timing from another. On the first real rushes Parakeet kept word edges within ~0.2 s but
 * lost half the words of a noisy recording, while whisper got the text right with edges up to 0.7 s off. Align the
 * two token sequences (longest common subsequence on normalized words); matched text words take the timing word's
 * times, unmatched runs are spread by character count between their timed neighbours.
 */
export function alignTimings(text: Word[], timing: Word[]): Aligned {
  const a = text.map((w) => norm(w.text));
  const b = timing.map((w) => norm(w.text));
  const n = a.length, m = b.length;
  // LCS table (Uint16 rows keep 10-minute transcripts small).
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] && a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const match = new Array<number>(n).fill(-1);
  for (let i = 0, j = 0; i < n && j < m;) {
    if (a[i] && a[i] === b[j]) {
      match[i] = j;
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }

  const out: Word[] = text.map((w, i) => (match[i] >= 0 ? { ...w, start: timing[match[i]].start, end: timing[match[i]].end } : { ...w }));
  // Unmatched runs: between the previous anchor's end and the next anchor's start, by character count.
  let i = 0;
  while (i < n) {
    if (match[i] >= 0) {
      i++;
      continue;
    }
    let k = i;
    while (k < n && match[k] < 0) k++;
    const prev = i > 0 ? out[i - 1] : null;
    const next = k < n ? out[k] : null;
    // Without an anchor on one side, keep the text transcript's own times for that edge.
    const from = prev ? prev.end : Math.min(text[i].start, next ? next.start : text[i].start);
    const to = next ? next.start : Math.max(text[k - 1].end, from + 0.1);
    const run = out.slice(i, k);
    const total = run.reduce((s, w) => s + Math.max(1, norm(w.text).length), 0);
    let t = from;
    const span = Math.max(0.04 * run.length, to - from);
    for (const w of run) {
      const d = (span * Math.max(1, norm(w.text).length)) / total;
      w.start = round(t);
      w.end = round(t + d);
      t += d;
    }
    i = k;
  }
  return { words: out, matched: n ? match.filter((x) => x >= 0).length / n : 0 };
}

const round = (t: number) => Math.round(t * 1000) / 1000;
