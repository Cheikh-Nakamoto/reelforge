import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSegments, makePlan, mapTime, markWords, remapWords, type CutParams } from "../src/steps/cutplan.js";
import type { Word } from "../src/lib/words.js";

const P: CutParams = { minPause: 0.35, keep: 0.1, removeFillers: true, removeRetakes: true };

/** Words from "text@start-end" tokens. */
function W(spec: string): Word[] {
  return spec.split(/\s+/).map((tok, i) => {
    const [text, times] = tok.split("@");
    const [s, e] = times.split("-").map(Number);
    return { id: `w${i}`, text: text.replace(/_/g, " "), start: s, end: e };
  });
}

const kept = (ws: { text: string; keep: boolean }[]) => ws.filter((w) => w.keep).map((w) => w.text).join(" ");

test("fillers and stutters are removed", () => {
  const ws = W("Alors@0-0.3 euh@0.4-0.7 le@0.8-0.9 le@0.95-1.05 projet@1.1-1.6 avance.@1.7-2.2");
  assert.equal(kept(markWords(ws, P)), "Alors le projet avance.");
});

test("a restarted phrase keeps the last take", () => {
  const ws = W(
    "Aujourd'hui@0-0.5 je@0.55-0.7 vais@0.75-0.9 vous@0.95-1.1 mon-@1.15-1.4 " +
      "Aujourd'hui@2.5-3 je@3.05-3.2 vais@3.25-3.4 vous@3.45-3.6 montrer@3.65-4 ça.@4.05-4.4",
  );
  assert.equal(kept(markWords(ws, P)), "Aujourd'hui je vais vous montrer ça.");
});

test("a restart marker drops its phrase and the failed take", () => {
  const ws = W(
    "Le@0-0.2 budget@0.25-0.7 est@0.75-0.9 de@0.95-1.0 trente,@1.05-1.5 " +
      "non@2.3-2.5 attends@2.55-2.9 je@2.95-3.05 recommence.@3.1-3.6 " +
      "Le@4.5-4.7 budget@4.75-5.2 est@5.25-5.4 de@5.45-5.5 quarante@5.55-6 euros.@6.05-6.5",
  );
  assert.equal(kept(markWords(ws, P)), "Le budget est de quarante euros.");
});

test("manual remove / restore override the heuristics", () => {
  const ws = W("Bon@0-0.3 euh@0.4-0.7 voilà@0.8-1.2");
  assert.equal(kept(markWords(ws, { ...P, remove: ["w0"], restore: ["w1"] })), "euh voilà");
});

test("long pauses are tightened to the breath, short ones kept", () => {
  const ws = W("Un@0-0.4 deux@0.5-0.9 trois@2.0-2.4");
  const segs = buildSegments(markWords(ws, P), [{ start: 0.95, end: 1.95 }], 3, P);
  assert.deepEqual(segs, [{ start: 0, end: 1.05 }, { start: 1.85, end: 2.6 }]);
});

test("segments never reach into a removed word", () => {
  const ws = W("Bonjour@0-0.5 euh@0.55-0.9 tout@0.95-1.2 le@1.25-1.35 monde@1.4-1.8");
  const segs = buildSegments(markWords(ws, P), [], 2, P);
  assert.equal(segs.length, 2);
  assert.ok(segs[0].end <= 0.55 && segs[1].start >= 0.9, JSON.stringify(segs));
});

test("cuts around a removed take land in the measured pauses, not on drifting word edges", () => {
  // ASR says "son." ends at 7.82 and the restart "Le" starts at 13.10; the audio says 7.73 and 13.34.
  const ws = W(
    "le@7.18-7.42 son.@7.42-7.82 Le@8.06-8.3 budget@8.3-8.86 est@8.86-9.1 de@9.1-9.34 30.@9.34-10.22 " +
      "Non@10.54-10.78 attends@11.02-11.58 je@11.58-11.82 recommence.@11.82-13.1 " +
      "Le@13.1-13.34 budget@13.34-13.82 est@13.82-13.98 de@14.14-14.3 50@14.3-14.7 euros.@14.7-15.0",
  );
  const silences = [{ start: 7.73, end: 8.23 }, { start: 9.87, end: 10.77 }, { start: 12.74, end: 13.34 }];
  const segs = buildSegments(markWords(ws, P), silences, 16, P);
  assert.equal(segs.length, 2);
  assert.equal(segs[0].end, 7.83);
  assert.equal(segs[1].start, 13.24);
});

test("a kept word stretched into a tightened pause stays in the transcript", () => {
  // "mois." is spoken until 15.47 but the ASR stretches it to 15.98; the pause 15.47–16.04 is tightened.
  const ws = W("par@15.02-15.26 mois.@15.26-15.98 Attention@16.04-16.8");
  const plan = makePlan(ws, [{ start: 15.47, end: 16.04 }], 17, P);
  assert.deepEqual(remapWords(plan).map((w) => w.text), ["par", "mois.", "Attention"]);
});

test("words are remapped onto the cut timeline", () => {
  const ws = W("Un@1-1.4 euh@1.5-2.5 deux@3-3.4");
  const plan = makePlan(ws, [], 4, P);
  const out = remapWords(plan);
  assert.deepEqual(out.map((w) => w.text), ["Un", "deux"]);
  assert.ok(Math.abs(out[0].start - mapTime(plan.keep, 1)!) < 1e-3);
  assert.ok(out[1].start < 1.5, `deux should follow closely, got ${out[1].start}`);
});
