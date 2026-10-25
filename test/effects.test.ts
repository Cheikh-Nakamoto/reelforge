import assert from "node:assert/strict";
import { test } from "node:test";
import { loadStyle } from "../src/lib/style.js";
import { fxBakeFilter, proposeEffects } from "../src/steps/effects.js";
import type { Word } from "../src/lib/words.js";

const words: Word[] = [
  { id: "w0", text: "Et", start: 1, end: 1.2 },
  { id: "w1", text: "boom,", start: 1.3, end: 1.7 },
  { id: "w2", text: "voilà.", start: 9, end: 9.5 },
];
const beats = {
  duration: 20,
  behind: [{ id: "bh0", text: "budget", start: 5, end: 6.3 }],
  mographs: [{ id: "mg0", kind: "counter" as const, start: 12, end: 14, text: "50" }],
  cuts: [2.5, 4.2, 7, 8.1, 10, 13.5, 16],
};

test("reel-dynamique: keyword, strong words, cuts and colour pop, within the density budget", () => {
  const style = loadStyle("reel-dynamique");
  const fx = proposeEffects(words, beats, style);
  const kinds = fx.map((f) => f.kind);
  assert.ok(fx.some((f) => f.kind === "shake" && f.reason?.includes("boom")), "keyword shake");
  assert.ok(kinds.includes("zoomPunch"), "punch on a strong word");
  assert.ok(kinds.includes("colorPop"), "colour pop under the behind-word");
  // Colour pop and RGB split ride on other effects, outside the budget.
  const counted = fx.filter((f) => f.kind !== "colorPop" && f.kind !== "rgbSplit");
  for (const f of counted) {
    const near = counted.filter((g) => Math.abs(g.at - f.at) < 5).length;
    assert.ok(near <= style.effects.maxPer10s, `density around ${f.at}: ${near}`);
  }
  for (let i = 1; i < counted.length; i++) assert.ok(counted[i].at - counted[i - 1].at >= 0.8, "spacing");
});

test("cinematic: only light leaks and colour pop, never a shake", () => {
  const fx = proposeEffects(words, beats, loadStyle("cinematic"));
  assert.ok(fx.every((f) => f.kind === "lightLeak" || f.kind === "colorPop"), JSON.stringify(fx));
  assert.ok(fx.some((f) => f.kind === "lightLeak"));
});

test("no cut effect lands inside a behind-word", () => {
  const fx = proposeEffects(words, { ...beats, cuts: [5.5, 5.9, 6.1, 10, 13.5] }, loadStyle("reel-dynamique"));
  for (const f of fx.filter((x) => x.kind === "whip" || x.kind === "flash")) {
    assert.ok(f.at + f.duration < 4.7 || f.at > 6.6, `cut effect at ${f.at} inside the word 5–6.3`);
  }
});

test("zoom ladders open the longest takes, never under a behind-word or a scene", () => {
  const style = loadStyle("reel-dynamique", { effects: { ladder: 2, cuts: "none", strongWord: "none", keywords: [] } });
  const scenes = [{ id: "sc0", start: 16.2, end: 19, words: [], emphasis: undefined }];
  const fx = proposeEffects(words, { ...beats, scenes } as never, style).filter((f) => f.kind === "ladder");
  assert.equal(fx.length, 2);
  // Takes: 0–2.5, 2.5–4.2, 4.2–7 (behind-word at 5), 7–8.1, 8.1–10, 10–13.5, 13.5–16, 16–20 (scene): the two
  // longest free ones are 10–13.5 and, of the 2.5 s ties, the first.
  assert.deepEqual(fx.map((f) => f.at).sort((a, b) => a - b), [0.15, 10.15]);
});

test("two effects never overlap on one layer, and the RGB split rides on punches", () => {
  const style = loadStyle("reel-dynamique", { effects: { ladder: 3, rgbSplit: true } });
  const fx = proposeEffects(words, beats, style);
  const camera = fx.filter((f) => ["shake", "zoomPunch", "whip", "ladder"].includes(f.kind));
  for (const a of camera) for (const b of camera) {
    if (a !== b) assert.ok(a.at + a.duration <= b.at || b.at + b.duration <= a.at, `${a.kind}@${a.at} / ${b.kind}@${b.at}`);
  }
  for (const p of fx.filter((f) => f.kind === "zoomPunch")) assert.ok(fx.some((f) => f.kind === "rgbSplit" && f.at === p.at));
});

test("baked effects are FFmpeg filters active only inside their windows", () => {
  const f = fxBakeFilter([{ kind: "glitch", at: 1, duration: 0.3 }, { kind: "rgbSplit", at: 4, duration: 0.3 }], 1080, 1920)!;
  assert.match(f, /^\[0:v\]split=10/, "nine torn bands");
  assert.match(f, /overlay=x=-?\d+:y=\d+:enable='between\(t,1,1\.1\)'/);
  assert.match(f, /rgbashift=rh=-12:bh=12:edge=smear:enable='between\(t,4,4\.15\)'/);
  assert.match(f, /\[fx\]$/);
  assert.equal(fxBakeFilter([{ kind: "shake", at: 1, duration: 0.4 }], 1080, 1920), null);
});
