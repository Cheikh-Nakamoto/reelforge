import assert from "node:assert/strict";
import { test } from "node:test";
import type { Beats } from "../src/steps/beats.js";
import { seamLedger, seamWarnings } from "../src/steps/seams.js";
import { sceneSeams } from "../src/steps/stage.js";

const scene = (start: number, end: number): Beats["scenes"][number] => ({
  id: "x", start, end, words: [{ id: "w", text: "budget", start: start + 0.1, end: start + 0.5 }],
});

test("a scene has two seams, both pulls (inverse zoom-through), between the rush and its type", () => {
  const seams = sceneSeams([scene(7.683, 9.773)], 16.9);
  assert.deepEqual(seams, [
    {
      id: "rush→sc0", cut: 7.683, technique: "inverse zoom-through",
      exit: { selector: "#frame-cam .drift", axis: "z", dir: -1 },
      entry: { selector: "#sc0 .sctf", axis: "z", dir: -1, scanRoot: "#sc0" },
    },
    {
      id: "sc0→rush", cut: 9.773, technique: "inverse zoom-through",
      exit: { selector: "#sc0 .sctf", axis: "z", dir: -1 },
      entry: { selector: "#frame-cam .drift", axis: "z", dir: -1, scanRoot: "#frame-cam" },
    },
  ]);
});

test("no seam against the start or the end of the video, one seam between two scenes that touch", () => {
  const seams = sceneSeams([scene(0, 2), scene(2, 4), scene(6, 8)], 8);
  assert.deepEqual(seams.map((s) => [s.id, s.cut]), [["sc0→sc1", 2], ["sc1→rush", 4], ["rush→sc2", 6]]);
  assert.equal(seams[0].entry.selector, "#sc1 .sctf");
});

test("the ledger carries the composition's frame rate and nothing without a scene", () => {
  assert.deepEqual(seamLedger({ scenes: [], duration: 10 }, 30), { fps: 30, seams: [] });
  assert.equal(seamLedger({ scenes: [scene(3, 5)], duration: 10 }, 30).seams.length, 2);
});

test("vector and Z-sign failures become QA warnings; zero-overlap and passes do not", () => {
  const results = [{
    id: "rush→sc0", cut: 7.683, type: "cut",
    rows: [
      { check: "ledger", status: "PASS", detail: "z- both sides" },
      { check: "exit-moving", status: "FAIL", detail: "#frame-cam .drift static at the cut (0.000 es/s)" },
      { check: "entry-vector", status: "PASS", detail: "-1.780 es/s z-" },
      { check: "speed-match", status: "WARN", detail: "ratio 9" },
      { check: "zero-overlap", status: "FAIL", detail: "outgoing still visible" },
      { check: "z-sign-scan", status: "FAIL", detail: "elements scaling AGAINST the seam's Z sign" },
    ],
  }];
  assert.deepEqual(seamWarnings("9x16", results), [
    "9x16: couture rush→sc0 (7,683 s) — exit-moving : #frame-cam .drift static at the cut (0.000 es/s)",
    "9x16: couture rush→sc0 (7,683 s) — z-sign-scan : elements scaling AGAINST the seam's Z sign",
  ]);
});
