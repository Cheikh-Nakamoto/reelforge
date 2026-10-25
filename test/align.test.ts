import assert from "node:assert/strict";
import { test } from "node:test";
import { alignTimings } from "../src/lib/align.js";
import type { Word } from "../src/lib/words.js";

const W = (spec: string): Word[] =>
  spec.split(/\s+/).map((tok, i) => {
    const [text, t] = tok.split("@");
    const [s, e] = t.split("-").map(Number);
    return { id: `w${i}`, text, start: s, end: e };
  });

test("whisper text gets Parakeet times, missing words are spread between anchors", () => {
  // whisper: right words, edges stretched over pauses; parakeet: tight edges, two words lost.
  const text = W("Vous@0.0-0.9 savez,@0.9-1.6 c'est@1.6-1.9 la@1.9-2.0 vie.@2.0-3.4");
  const timing = W("Vous@0.5-0.8 c'est@1.7-1.9 vie.@2.1-2.5");
  const { words, matched } = alignTimings(text, timing);
  assert.equal(words.map((w) => w.text).join(" "), "Vous savez, c'est la vie.");
  assert.deepEqual([words[0].start, words[0].end], [0.5, 0.8]);
  assert.deepEqual([words[4].start, words[4].end], [2.1, 2.5]);
  // "savez," sits between "Vous" (ends 0.8) and "c'est" (starts 1.7).
  assert.ok(words[1].start >= 0.8 && words[1].end <= 1.7, JSON.stringify(words[1]));
  assert.ok(words[3].start >= 1.9 && words[3].end <= 2.1, JSON.stringify(words[3]));
  assert.equal(matched, 3 / 5);
});

test("times stay ordered when the timing transcript has extra words", () => {
  const text = W("bonjour@0-1 à@1-1.2 tous@1.2-2");
  const timing = W("euh@0.1-0.3 bonjour@0.4-0.9 à@1.0-1.1 tous@1.15-1.6 merci@3-3.5");
  const { words } = alignTimings(text, timing);
  for (let i = 1; i < words.length; i++) assert.ok(words[i].start >= words[i - 1].end - 1e-6);
  assert.equal(words[0].start, 0.4);
});
