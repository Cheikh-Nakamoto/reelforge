import assert from "node:assert/strict";
import { test } from "node:test";
import { loadStyle } from "../src/lib/style.js";

// These tests are about keyword graphics: no opening title taking the first seconds.
const tech = () => {
  const s = loadStyle("tech-explainer");
  return { ...s, mograph: { ...s.mograph, hook: false }, scenes: { ...s.scenes, max: 0 } };
};
import { proposeBeats } from "../src/steps/beats.js";
import type { Word } from "../src/lib/words.js";

const W = (text: string): Word[] => text.split(" ").map((t, i) => ({ id: `w${i}`, text: t, start: i * 0.4, end: i * 0.4 + 0.35 }));

test("a negated keyword raises no callout", async () => {
  const words = W("ça ne pose pas de problème. Attention au piège.");
  const b = await proposeBeats(words, [], 10, tech(), null);
  const texts = b.mographs.map((m) => m.text.toLowerCase());
  assert.ok(!texts.includes("problème"), JSON.stringify(b.mographs));
  assert.ok(texts.includes("attention") || texts.includes("piège"), "the positive keyword still triggers");
});

test("a counter label stops at the comma", async () => {
  const words = W("votre site prêt en 10 minutes, vous voyez");
  const b = await proposeBeats(words, [], 10, tech(), null);
  assert.equal(b.mographs.find((m) => m.kind === "counter")?.label, "minutes");
});

test("word loudness is judged against the voice around it, not the whole video", async () => {
  const { scoreWords } = await import("../src/steps/beats.js");
  // First half loud (−10 dB), second half recorded 20 dB lower; one word stands out in each half.
  const words = Array.from({ length: 40 }, (_, i) => ({ id: `w${i}`, text: "mot", start: i * 0.5, end: i * 0.5 + 0.4 }));
  const rms = Array.from({ length: 400 }, (_, k) => {
    const t = k * 0.05, base = t < 10 ? -10 : -30;
    return (t >= 5 && t < 5.4) || (t >= 15 && t < 15.4) ? base + 8 : base;
  });
  const s = scoreWords(words, rms);
  assert.ok(s[30].score > 1, `the quiet half's stressed word stands out: ${s[30].score}`);
  assert.ok(s[25].score < 0.5, "an ordinary quiet word does not");
});
