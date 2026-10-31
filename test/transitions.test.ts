import assert from "node:assert/strict";
import { test } from "node:test";
import { loadStyle } from "../src/lib/style.js";
import type { Beats } from "../src/steps/beats.js";
import { buildHtml, FORMATS } from "../src/steps/html.js";
import { proposeCamera } from "../src/steps/rig.js";
import { IN_T, OUT_T, planTransitions, proposeTransitions, seamAxis, seamMotion } from "../src/steps/transitions.js";
import { sceneSeams } from "../src/steps/stage.js";

const MOVES = ["cube", "flip"] as const;
const w = (s: number) => [{ id: "w0", text: "Bonjour", start: s + 0.1, end: s + 0.6 }];
const scene = (start: number, end: number, transition?: "portal" | "cube" | "flip"): Beats["scenes"][number] =>
  ({ id: "x", start, end, words: w(start), ...(transition ? { transition } : {}) });
const base: Beats = {
  duration: 20, captions: [], behind: [], mographs: [], sfx: [], cuts: [], fx: [], frames: [], scenes: [], parts: [], notes: [], camera: [], spaces: [],
};
const style = loadStyle("reel-dynamique");
const html = (beats: Beats) =>
  buildHtml({ beats, style, format: FORMATS["9x16"], src: { width: 1080, height: 1920 }, matte: null, hasCutout: false });
const sign = (n: number) => Math.sign(n);
const delta = (m: ReturnType<typeof seamMotion>, k: string) => ((m.to as Record<string, number>)[k] ?? 0) - ((m.from as Record<string, number>)[k] ?? 0);

test("both sides of a cut turn the same way: the face that leaves and the face that arrives share axis and sign", () => {
  for (const kind of MOVES) {
    const out = seamMotion(kind, "out", 1080, 1920);
    const inn = seamMotion(kind, "in", 1080, 1920);
    const keys = Object.keys(out.to);
    assert.ok(keys.length >= 2, `${kind}: a rotation and the travel that goes with it`);
    assert.deepEqual(Object.keys(inn.from).sort(), keys.sort());
    for (const k of keys) {
      assert.notEqual(delta(out, k), 0);
      assert.equal(sign(delta(out, k)), sign(delta(inn, k)), `${kind}.${k}: one direction on both sides`);
      // one hinge: the arriving face starts where the leaving face's mirror stands, so the pose is continuous
      assert.equal((inn.from as Record<string, number>)[k], -(out.to as Record<string, number>)[k], `${kind}.${k}: mirror poses`);
      assert.equal((out.from as Record<string, number>)[k], 0);
      assert.equal((inn.to as Record<string, number>)[k], 0);
    }
    // cut-the-curve: accelerate into the cut, decelerate out of it, no overshoot, short
    assert.match(out.ease, /^power\d\.in$/);
    assert.match(inn.ease, /^power\d\.out$/);
    assert.ok(out.duration === OUT_T && inn.duration === IN_T && IN_T <= 0.5);
  }
});

test("the ledger reads the horizontal current for a cube, the vertical one for a flip, and keeps the portal's Z", () => {
  assert.deepEqual(seamAxis("cube"), { axis: "x", dir: -1 });
  assert.deepEqual(seamAxis("flip"), { axis: "y", dir: -1 });
  const [into, outof] = sceneSeams([scene(5, 8, "cube")], 20);
  assert.equal(into.technique, "cube");
  assert.deepEqual([into.exit.axis, into.exit.dir, into.entry.axis, into.entry.dir], ["x", -1, "x", -1]);
  assert.equal(into.exit.selector, "#frame-cam .drift");
  assert.equal(into.entry.selector, "#sc0 .sctf");
  assert.deepEqual([outof.exit.axis, outof.entry.axis, outof.entry.dir], ["x", "x", -1]);
  assert.equal(outof.entry.selector, "#frame-cam .drift");
  const flip = sceneSeams([scene(5, 8, "flip")], 20);
  assert.deepEqual(flip.map((s) => [s.exit.axis, s.entry.axis]), [["y", "y"], ["y", "y"]]);
  const portal = sceneSeams([scene(5, 8)], 20);
  assert.equal(portal[0].technique, "inverse zoom-through");
  assert.equal(portal[0].exit.axis, "z");
});

test("the composition: the rush turns out on .shake and ends on the cut, the scene arrives from the mirror pose, one side at a time", () => {
  const out = html({ ...base, scenes: [scene(5, 8, "cube")] });
  const lines = out.split("\n").filter((l) => /tl\./.test(l));
  // rush leaves: ends exactly on the cut (5 s), starts OUT_T before
  const rushOut = lines.find((l) => /"\.shake", \{ rotationY: -/.test(l) && /duration: 0\.3,/.test(l));
  assert.ok(rushOut, "the rush's turn out");
  assert.match(rushOut!, /, 4\.7\);$/);
  // scene arrives on the cut from the opposite pose
  assert.ok(lines.some((l) => /tl\.set\("#sc0", \{[^}]*rotationY: 45/.test(l) && /, 5\);$/.test(l)));
  assert.ok(lines.some((l) => /tl\.to\("#sc0", \{[^}]*rotationY: 0/.test(l) && /duration: 0\.45/.test(l) && /, 5\);$/.test(l)));
  // scene leaves on the cut at 8 s, rush arrives from the mirror pose right after
  assert.ok(lines.some((l) => /tl\.to\("#sc0", \{[^}]*rotationY: -45/.test(l) && /, 7\.7\);$/.test(l)));
  assert.ok(lines.some((l) => /tl\.set\("\.shake", \{[^}]*rotationY: 45/.test(l) && /, 8\);$/.test(l)));
  assert.ok(lines.some((l) => /tl\.to\("\.shake", \{[^}]*rotationY: 0/.test(l) && /duration: 0\.45/.test(l) && /, 8\);$/.test(l)));
  // the rush is hidden while the scene is on: never two sides on screen
  assert.ok(lines.some((l) => /#frame-cam/.test(l) && /opacity: 0/.test(l) && /, 5\);$/.test(l)));
  assert.ok(lines.some((l) => /#frame-cam/.test(l) && /opacity: 1/.test(l) && /, 8\);$/.test(l)));
  // the scene is opaque on its first frame (no fade-through) and no portal scale entry
  assert.doesNotMatch(out, /tl\.set\("#sc0 \.scbg", \{ opacity: 0\.15/);
  assert.doesNotMatch(out, /tl\.set\("#sc0 \.scbgf", \{ scale: 1\.25/);
  // never on the other camera levels; root stays opaque
  assert.doesNotMatch(out, /tl\.\w+\("(\.cam|\.push|\.drift|#cam|#cutcam)"[^;]*rotation/);
  assert.match(out, /#root\s*\{[^}]*background(-color)?:\s*#?\w+/);
  // a portal composition has none of this
  const portal = html({ ...base, scenes: [scene(5, 8)] });
  assert.doesNotMatch(portal, /rotationY: -45|transformPerspective/);
});

test("the plan keeps what the composition can honour and says why it drops the rest", () => {
  const ctx = { fx: [] as Beats["fx"], behind: [] as Beats["behind"], duration: 40 };
  const three = [scene(5, 8, "cube"), scene(14, 17, "cube"), scene(24, 27, "cube")];
  const p = planTransitions(three, ctx, 2);
  assert.deepEqual(p.kinds, ["cube", "cube", "portal"]);
  assert.equal(p.notes.length, 1);
  assert.match(p.notes[0], /budget/);
  // a camera effect on the rush in the window
  const shake: Beats["fx"] = [{ id: "f", kind: "shake", at: 4.8, duration: 0.3 }];
  assert.deepEqual(planTransitions([scene(5, 8, "cube")], { ...ctx, fx: shake }, 2).kinds, ["portal"]);
  // no room on the rush before the first scene or after the last one
  assert.deepEqual(planTransitions([scene(0.2, 3, "cube")], ctx, 2).kinds, ["portal"]);
  assert.deepEqual(planTransitions([scene(5, 39.8, "cube")], ctx, 2).kinds, ["portal"]);
  // scenes that touch turn as one: the second takes the first's kind
  assert.deepEqual(planTransitions([scene(5, 8, "cube"), scene(8, 10, "flip")], ctx, 2).kinds, ["cube", "cube"]);
  // budget 0 = off
  assert.deepEqual(planTransitions([scene(5, 8, "cube")], ctx, 0).kinds, ["portal"]);
});

test("the default follows the style, at most two scenes, and leaves the rig the rest of the budget", () => {
  const ctx = { fx: [] as Beats["fx"], behind: [] as Beats["behind"], duration: 60 };
  const scenes = [scene(5, 8), scene(15, 18), scene(25, 28)];
  assert.deepEqual(proposeTransitions(scenes, ctx, { ...style, scenes: { ...style.scenes, transition: "cube" }, camera: { max: 3 } }), ["cube", "cube", "portal"]);
  assert.deepEqual(proposeTransitions(scenes, ctx, { ...style, scenes: { ...style.scenes, transition: "portal" } }), ["portal", "portal", "portal"]);
  assert.deepEqual(proposeTransitions(scenes, ctx, { ...style, scenes: { ...style.scenes, transition: "cube" }, camera: { max: 0 } }), ["portal", "portal", "portal"]);
  // the rig skips a scene that already turns, and counts the transitions in the budget
  const st = { ...style, camera: { max: 3 } };
  const cam = proposeCamera(
    { scenes: [scene(5, 8, "cube"), scene(15, 18)], mographs: [], devices: [] }, st, { used: 1, skip: new Set(["sc0"]) });
  assert.deepEqual(cam.map((c) => c.target), ["sc1"]);
  assert.equal(proposeCamera({ scenes: [scene(15, 18)], mographs: [], devices: [] }, st, { used: 3 }).length, 0);
});

test("the perspective follows the side that turns, so a wide frame does not shift the projected centre against the seam", async () => {
  const { seamPerspective } = await import("../src/steps/transitions.js");
  assert.equal(seamPerspective("cube", 1080, 1920), 1804);
  assert.ok(Math.abs(seamPerspective("cube", 1920, 1080) / 1920 - seamPerspective("cube", 1080, 1920) / 1080) < 0.01);
  assert.equal(seamPerspective("flip", 1920, 1080), 1804);
});
