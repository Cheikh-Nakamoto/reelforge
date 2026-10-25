import assert from "node:assert/strict";
import { test } from "node:test";
import { compareEnergy, detectEvents, estimateMotion, overridesFrom, summarize } from "../src/reference.js";

const W = 96, H = 170, FPS = 30;

/** Smooth seeded texture: a coarse random grid, bilinearly upsampled (gradients for the motion search). */
function texture(seed: number): Uint8Array {
  let s = seed;
  const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  const gw = 13, gh = 22;
  const grid = Array.from({ length: gw * gh }, () => 30 + rnd() * 190);
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const gx = (x / (W - 1)) * (gw - 1), gy = (y / (H - 1)) * (gh - 1);
    const x0 = Math.floor(gx), y0 = Math.floor(gy), x1 = Math.min(gw - 1, x0 + 1), y1 = Math.min(gh - 1, y0 + 1);
    const fx = gx - x0, fy = gy - y0;
    const v = grid[y0 * gw + x0] * (1 - fx) * (1 - fy) + grid[y0 * gw + x1] * fx * (1 - fy) + grid[y1 * gw + x0] * (1 - fx) * fy + grid[y1 * gw + x1] * fx * fy;
    out[y * W + x] = Math.round(v);
  }
  return out;
}

/** `a` moved by (dx, dy) and scaled by s about the centre (edges clamped). */
function warp(a: Uint8Array, dx: number, dy: number, sc: number): Uint8Array {
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const sx = Math.min(W - 1, Math.max(0, Math.round(W / 2 + (x - W / 2 - dx) / sc)));
    const sy = Math.min(H - 1, Math.max(0, Math.round(H / 2 + (y - H / 2 - dy) / sc)));
    out[y * W + x] = a[sy * W + sx];
  }
  return out;
}
const brighten = (a: Uint8Array, k: number) => a.map((v) => Math.min(255, v + k));

test("the motion search finds a move and a zoom", () => {
  const a = texture(3);
  const m = estimateMotion(a, warp(a, 3, -2, 1), W, H);
  assert.deepEqual([m.dx, m.dy, m.scale], [3, -2, 1]);
  assert.equal(estimateMotion(a, warp(a, 0, 0, 1.12), W, H).scale, 1.12);
});

test("cuts, a flash, a punch, a shake, a ladder and a whip are found where they are", () => {
  const [A, B, C, D, E, F] = [1, 2, 3, 4, 5, 6].map(texture);
  const f: Uint8Array[] = [];
  const hold = (img: Uint8Array, n: number) => { for (let k = 0; k < n; k++) f.push(img); };
  hold(A, 30);                                                   // 0–1 s
  hold(B, 15); f.push(brighten(B, 90), brighten(B, 90)); hold(B, 13);                    // cut at 1 s, flash at 1.5 s
  // Cut at 2 s, punch at 2.33 s: in over three frames, back over eight (a punch returns to its framing).
  hold(C, 10); [1.04, 1.08, 1.12, 1.1, 1.08, 1.06, 1.04, 1.03, 1.02, 1.01, 1].forEach((s) => f.push(warp(C, 0, 0, s))); hold(C, 9);
  [3, -3, 3, -3, 3, -3, 3, -3].forEach((dx, k) => f.push(warp(D, dx, k % 2 ? 2 : -2, 1))); hold(D, 22);   // cut + shake at 3 s
  for (const s of [1, 1.06, 1.12, 1.18]) hold(warp(E, 0, 0, s), 8);                       // cut 4 s, ladder 4.27 s
  f.push(warp(E, -8, 0, 1.18), warp(E, -16, 0, 1.18)); hold(F, 28);                       // whip into a cut at 5.13 s
  const ev = detectEvents(f, W, H, FPS);
  const near = (xs: number[], x: number, d = 0.1) => xs.some((y) => Math.abs(y - x) <= d);
  for (const c of [1, 2, 3, 4]) assert.ok(near(ev.cuts, c), `cut at ${c}: ${ev.cuts}`);
  assert.deepEqual(ev.flashes.length, 1, `flashes ${ev.flashes}`);
  assert.ok(near(ev.flashes, 1.5), `flash ${ev.flashes}`);
  assert.ok(near(ev.punches, 2.33, 0.15), `punch ${ev.punches}`);
  assert.ok(near(ev.shakes, 3, 0.2), `shake ${ev.shakes}`);
  assert.ok(near(ev.ladders, 4.27, 0.15), `ladder ${ev.ladders}`);
  assert.ok(near(ev.whips, 5.13, 0.15), `whip ${ev.whips} cuts ${ev.cuts}`);
  assert.equal(ev.strobes.length, 0);
  const s = summarize(ev, f.length / FPS);
  assert.ok(s.punchZoom! >= 1.1, `punch zoom ${s.punchZoom}`);
  assert.equal(ev.whips.length, 1, `whips ${ev.whips}`);
});

test("three flashes in half a second are one strobe", () => {
  const A = texture(9);
  const f: Uint8Array[] = [];
  for (let k = 0; k < 10; k++) f.push(A);
  for (let k = 0; k < 6; k++) f.push(k % 2 ? A : brighten(A, 100));
  for (let k = 0; k < 14; k++) f.push(A);
  const ev = detectEvents(f, W, H, FPS);
  assert.equal(ev.strobes.length, 1);
  assert.equal(ev.flashes.length, 0);
  assert.equal(ev.cuts.length, 0);
});

test("a fast, punchy reference becomes a tight, effect-heavy style", () => {
  const { overrides, why } = overridesFrom({
    per10s: { cuts: 9, flashes: 1.5, strobes: 0, punches: 2, ladders: 0.4, shakes: 1, whips: 1 },
    meanShot: 1.1, punchZoom: 1.15, shakeAmp: 2.1, flashCuts: 0.2, whipCuts: 0.15,
    look: { luma: 120, saturation: 55, contrast: 160, letterbox: null },
  });
  assert.deepEqual(overrides.rhythm, { minPause: 0.25, keep: 0.07 });
  assert.equal(overrides.motion?.jumpZoom, 1.1);
  assert.equal(overrides.effects?.maxPer10s, 6);
  assert.equal(overrides.effects?.strongWord, "both");
  assert.equal(overrides.effects?.cuts, "mix");
  assert.equal(overrides.effects?.ladder, 1);
  assert.equal(overrides.look?.grade, "bright-pop");
  assert.ok(why.length >= 4);
});

test("the energy check reports a clear gap with the reference only", () => {
  const p = (cuts: number, punches: number) => ({ per10s: { cuts, flashes: 0, strobes: 0, punches, ladders: 0, shakes: 0, whips: 0 } });
  assert.deepEqual(compareEnergy(p(6, 2), p(5.5, 1.8)), []);
  const calm = compareEnergy(p(8, 3), p(3, 1));
  assert.equal(calm.length, 2);
  assert.match(calm[0], /3,0 coupes par 10 s contre 8,0 .* plus calme/);
  assert.match(compareEnergy(p(2, 0), p(2, 4))[0], /effets .* plus chargé/);
});
