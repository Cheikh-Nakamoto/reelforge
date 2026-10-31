import assert from "node:assert/strict";
import { test } from "node:test";
import { loadStyle } from "../src/lib/style.js";
import type { Beats } from "../src/steps/beats.js";
import { buildHtml, FORMATS } from "../src/steps/html.js";
import { MOVES, planRig, proposeCamera, rigTween } from "../src/steps/rig.js";

const words = (s: number) => [{ id: "w0", text: "Bonjour", start: s + 0.1, end: s + 0.6 }];
const base: Beats = {
  duration: 20, captions: [], behind: [], mographs: [], sfx: [], cuts: [], fx: [], frames: [], scenes: [], parts: [], notes: [], camera: [], spaces: [],
};
const scenes: Beats["scenes"] = [
  { id: "sc0", start: 4, end: 6.5, words: words(4) },
  { id: "sc1", start: 12, end: 13, words: words(12) },
];
const vertical = { width: 1080, height: 1920 };
const html = (beats: Beats, devices?: Parameters<typeof buildHtml>[0]["devices"]) =>
  buildHtml({ beats, style: loadStyle("reel-dynamique"), format: FORMATS["9x16"], src: vertical, matte: null, hasCutout: false, devices });

test("each move is one tween on the rig, in one direction, with a doctrine-conformant ease and duration", () => {
  for (const move of MOVES) {
    const tw = rigTween("#sc0 .rigcam", { id: "cam0", at: 5, duration: 1.4, move, target: "sc0" }, 1, 1080);
    assert.equal(tw.split("tl.to(").length - 1, 1, `${move}: one tween`);
    assert.match(tw, /^tl\.to\("#sc0 \.rigcam", /);
    assert.doesNotMatch(tw, /bounce|elastic|back\./, `${move}: no forbidden ease`);
    assert.match(tw, /ease: "(power[23]\.inOut|power3\.out)"/);
    // Every target value starts from rest (0) and goes one way: no pair of opposite signs in one move.
    const nums = [...tw.matchAll(/(rotationX|rotationY|x|y|z): (-?\d+(?:\.\d+)?)/g)].map((m) => ({ k: m[1], v: Number(m[2]) }));
    assert.ok(nums.length >= 1);
    assert.ok(nums.every((n) => n.v !== 0));
  }
  // dolly forward is a push (z grows); orbit and truck follow the film's current
  assert.match(rigTween("#a", { id: "c", at: 1, duration: 1, move: "dolly", target: "a" }, 1, 1080), /z: 1[0-9]{2}/);
  assert.match(rigTween("#a", { id: "c", at: 1, duration: 1, move: "orbit", target: "a" }, 1, 1080), /rotationY: -/);
});

test("the default plan puts an orbit on a scene and a dolly on a phone, after the entry and before the exit", () => {
  const cam = proposeCamera(
    { scenes, mographs: [], devices: [{ target: "dv0", start: 8, end: 11 }] },
    { ...loadStyle("reel-dynamique"), camera: { max: 3 } },
  );
  const sc0 = cam.find((c) => c.target === "sc0")!;
  const dv0 = cam.find((c) => c.target === "dv0")!;
  assert.equal(sc0.move, "orbit");
  assert.equal(dv0.move, "dolly");
  assert.ok(sc0.at >= 4 + 0.5 && sc0.at + sc0.duration <= 6.5 - 0.2, "inside the scene's calm part");
  assert.ok(dv0.at >= 8 + 0.8 && dv0.at + dv0.duration <= 11 - 0.45, "inside the phone's calm part");
  assert.ok(cam.every((c) => c.reason));
  assert.equal(cam.find((c) => c.target === "sc1"), undefined, "a 1 s scene has no room for a move");
});

test("the budget is 3 3D effects per video, rig included", () => {
  const many = Array.from({ length: 5 }, (_, i) => ({ id: `sc${i}`, start: 2 + i * 6, end: 5 + i * 6, words: words(2 + i * 6) }));
  const style = { ...loadStyle("reel-dynamique"), camera: { max: 3 } };
  assert.equal(proposeCamera({ scenes: many, mographs: [], devices: [] }, style).length, 3);
  assert.equal(proposeCamera({ scenes: many, mographs: [], devices: [] }, { ...style, camera: { max: 0 } }).length, 0);
  assert.throws(() => loadStyle("reel-dynamique", { camera: { max: 4 } }));
});

test("planRig drops hand-edited moves that break the rules and says why", () => {
  const { kept, notes } = planRig(
    [
      { id: "ok", at: 4.6, duration: 1.2, move: "orbit", target: "sc0", reason: "x" },
      { id: "intoEntry", at: 4.1, duration: 1, move: "orbit", target: "sc0" },
      { id: "nowhere", at: 4.6, duration: 1, move: "dolly", target: "zz9" },
      { id: "overlap", at: 5, duration: 1, move: "truck", target: "sc0" },
    ],
    { scenes, mographs: [], devices: [] },
  );
  assert.deepEqual(kept.map((k) => k.id), ["ok"]);
  assert.equal(notes.length, 3);
});

test("the composition tweens the rig only: the camera stacks and the rush are untouched", () => {
  const beats: Beats = { ...base, scenes, camera: [{ id: "cam0", at: 4.6, duration: 1.2, move: "orbit", target: "sc0", reason: "x" }] };
  const out = html(beats);
  const rigLines = out.split("\n").filter((l) => /rigcam/.test(l) && /tl\./.test(l));
  assert.ok(rigLines.length >= 2, "a baseline set and a move");
  assert.ok(rigLines.every((l) => /"#sc0 \.rigcam"/.test(l)));
  assert.doesNotMatch(out, /tl\.\w+\("(\.cam|\.push|\.shake|\.drift|\.frame|#cam|#cutcam)"[^;]*rotationY/);
  // the type sits inside the rig, the background does not
  assert.match(out, /<div class="rig"><div class="rigcam"><div class="sctf"/);
  // the seams of the scene keep their selector
  assert.match(out, /#sc0 \.sctf/);
  // no rig markup without a move
  assert.doesNotMatch(html({ ...beats, camera: [] }), /rigcam/);
});

test("a phone with a dolly gives up its own slow turn: one camera, not two", () => {
  const devices = [{ src: "assets/part-1.mp4", start: 3, end: 8, from: 0, role: "screen" as const }];
  const plain = html({ ...base, duration: 10 }, devices);
  const rigged = html({ ...base, duration: 10, camera: [{ id: "cam0", at: 3.9, duration: 2, move: "dolly", target: "dv0" }] }, devices);
  assert.match(plain, /rotationY: 9, rotationX: -2/);
  assert.doesNotMatch(rigged, /rotationY: 9, rotationX: -2/);
  assert.match(rigged, /"#dv0 \.rigcam", \{ z: /);
});

test("a graphic can take a dolly; its exit still targets the graphic, not the rig", () => {
  const mographs: Beats["mographs"] = [{ id: "mg0", kind: "question", start: 2, end: 5, text: "Pourquoi" }];
  const out = html({ ...base, mographs, camera: [{ id: "cam0", at: 2.6, duration: 1.2, move: "dolly", target: "mg0" }] });
  assert.match(out, /"#mg0 \.rigcam", \{ z: /);
  assert.match(out, /tl\.to\("#mg0 \.mg-pos", \{ x: -/);
});
