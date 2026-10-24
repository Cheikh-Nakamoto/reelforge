import assert from "node:assert/strict";
import { test } from "node:test";
import { computeLayout, FORMATS } from "../src/steps/html.js";
import { coverage, placeBehind, type Mask } from "../src/steps/placement.js";

/** A person: a head disc and a body below it, in a 108×192 mask of a vertical source. */
function person(): Mask {
  const w = 108, h = 192, data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const head = (x - 54) ** 2 + (y - 70) ** 2 < 18 ** 2;
      const body = y > 88 && Math.abs(x - 54) < 34;
      if (head || body) data[y * w + x] = 255;
    }
  }
  return { w, h, data };
}

const f = FORMATS["9x16"];
const layout = computeLayout({ width: 1080, height: 1920 }, f, 0.5);
const base = {
  masks: [person()], layout, W: f.width, H: f.height, scale: 1, origin: { x: 540, y: 768 },
  em: 0.4, chars: 6, fsMax: 700, maxBottom: 1200,
};

test("coverage is 0 above the head and high on the body", () => {
  assert.equal(coverage(base, 200, 150).mean, 0);
  assert.ok(coverage(base, 1100, 150).mean > 0.5);
});

test("the word is placed so the head hides a readable share of it", () => {
  const p = placeBehind(base);
  assert.ok(p.ok, JSON.stringify(p));
  assert.ok(p.coverage >= 0.2 && p.coverage <= 0.58, `coverage ${p.coverage}`);
  assert.ok(p.cy + p.fs / 2 <= base.maxBottom, "clear of the captions");
});

test("a camera zoom moves the placement with the subject", () => {
  const still = placeBehind(base);
  const zoomed = placeBehind({ ...base, scale: 1.2 });
  assert.ok(zoomed.ok);
  assert.notDeepEqual([still.cy, still.fs], [zoomed.cy, zoomed.fs]);
});

test("a placement that hides the end of the word is not readable", () => {
  // Subject on the right half of the frame: at body height it would swallow the second half of the word.
  const w = 108, h = 192, data = new Uint8Array(w * h);
  for (let y = 60; y < h; y++) for (let x = 54; x < w; x++) data[y * w + x] = 255;
  const p = placeBehind({ ...base, masks: [{ w, h, data }] });
  assert.ok(p.lostLetters <= 1, `lost ${p.lostLetters} of 6 letters`);
  const eaten = coverage({ ...base, masks: [{ w, h, data }] }, 1000, 300);
  assert.ok(eaten.lost >= 3, "the body region really hides half the word");
});
