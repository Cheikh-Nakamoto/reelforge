import assert from "node:assert/strict";
import { test } from "node:test";
import { listStyles, loadStyle } from "../src/lib/style.js";
import type { Beats } from "../src/steps/beats.js";
import { buildHtml, computeLayout, FORMATS } from "../src/steps/html.js";
import { lookFilter } from "../src/steps/look.js";
import type { MatteReport } from "../src/steps/matte.js";

const beats: Beats = {
  duration: 10,
  captions: [{ id: "cap0", start: 0.1, end: 1.2, words: [{ id: "w0", text: "Bonjour", start: 0.1, end: 0.6 }] }],
  behind: [{ id: "bh0", text: "monter", start: 2, end: 3.6 }],
  mographs: [{ id: "mg0", kind: "counter", start: 5, end: 7, text: "50", value: 50, suffix: "€", label: "par mois" }],
  sfx: [],
  cuts: [2.5, 6],
  notes: [],
};

const matte = {
  fps: 1, bbox: { x0: 0.3, y0: 0.2, x1: 0.8, y1: 1 }, centerX: 0.55, headTop: 0.25, presence: 1,
  track: [{ t: 2, x0: 0.3, y0: 0.25, x1: 0.8, y1: 1 }],
  windows: [], flicker: [], lost: [], verdict: "ok", flaggedShare: 0, thresholds: { oscillation: 0.06, minRun: 3 },
} satisfies MatteReport;

const vertical = { width: 1080, height: 1920 };

test("every shipped style loads", () => {
  const names = listStyles().map((s) => s.name).sort();
  assert.deepEqual(names, ["cinematic", "reel-dynamique", "tech-explainer"]);
});

test("the cutout stack paints above the behind-word, the footage below it", () => {
  const html = buildHtml({ beats, style: loadStyle("reel-dynamique"), format: FORMATS["9x16"], src: vertical, matte, hasCutout: true });
  const cam = html.indexOf('id="cam"');
  const word = html.indexOf('id="bh0"');
  const cut = html.indexOf('id="cutcam"');
  assert.ok(cam < word && word < cut, "markup order footage → word → cutout");
  // The cutout must not live inside the footage's stacking context.
  assert.ok(!html.slice(cam, word).includes("subject.webm"));
  assert.match(html, /#cam \{ z-index: 1; \}/);
  assert.match(html, /#cutcam \{ z-index: 3; \}/);
  assert.match(html, /class="clip behind"[^>]*style="z-index:2"/);
});

test("both camera stacks get the same moves, and no in-browser grading", () => {
  const html = buildHtml({ beats, style: loadStyle("cinematic"), format: FORMATS["16x9"], src: vertical, matte, hasCutout: true });
  assert.ok(!/tl\.\w+\("#cam"/.test(html), "moves target the .cam/.push classes, never one stack alone");
  assert.doesNotMatch(html, /data-color-grading/, "the look is baked by FFmpeg (in-browser grading is 5x slower on CPU)");
});

test("every style's look compiles to an FFmpeg filter chain", () => {
  for (const { name } of listStyles()) {
    const f = lookFilter(loadStyle(name));
    if (f) assert.match(f, /^[a-z]+=[^,]+(,[a-z]+=[^,]+)*$/, `${name}: ${f}`);
  }
  assert.match(lookFilter(loadStyle("cinematic"))!, /vignette=angle=/);
});

test("jump cuts alternate framing, skipping slivers", () => {
  const style = loadStyle("reel-dynamique");
  const html = buildHtml({ beats: { ...beats, cuts: [2.5, 2.9, 6] }, style, format: FORMATS["9x16"], src: vertical, matte, hasCutout: false });
  const sets = [...html.matchAll(/tl\.set\("\.cam", \{ scale: ([\d.]+) \}, ([\d.]+)\)/g)].map((m) => [Number(m[2]), Number(m[1])]);
  assert.deepEqual(sets, [[0, 1], [2.9, style.motion.jumpZoom], [6, 1]]);
});

test("letterbox only on landscape exports", () => {
  const style = loadStyle("cinematic");
  assert.match(buildHtml({ beats, style, format: FORMATS["16x9"], src: vertical, matte, hasCutout: false }), /id="lb-top"/);
  assert.doesNotMatch(buildHtml({ beats, style, format: FORMATS["9x16"], src: vertical, matte, hasCutout: false }), /id="lb-top"/);
});

test("a vertical rush in 16:9 is pillar-boxed, a landscape rush in 9:16 is cropped on the subject", () => {
  assert.equal(computeLayout(vertical, FORMATS["16x9"], 0.5).mode, "pillar");
  const crop = computeLayout({ width: 1920, height: 1080 }, FORMATS["9x16"], 0.8);
  assert.equal(crop.mode, "cover");
  assert.ok(crop.posX > 70, `subject on the right keeps the crop right, got ${crop.posX}%`);
});

test("behind-words stay above the caption zone", () => {
  const style = loadStyle("reel-dynamique");
  const html = buildHtml({ beats, style, format: FORMATS["9x16"], src: vertical, matte, hasCutout: true });
  const word = /<div class="w" style="top:(\d+)px;font-size:(\d+)px/.exec(html)!;
  const capTop = Number(/\.cg \{[^}]*top: (\d+)px/.exec(html)![1]);
  assert.ok(Number(word[1]) + Number(word[2]) <= capTop, `word bottom ${Number(word[1]) + Number(word[2])} vs captions ${capTop}`);
});

test("the tracking animation moves letters with transforms, never letterSpacing", () => {
  const html = buildHtml({ beats, style: loadStyle("cinematic"), format: FORMATS["9x16"], src: vertical, matte, hasCutout: true });
  assert.doesNotMatch(html, /letterSpacing/);
  assert.match(html, /<span class="l0"[^>]*>M<\/span>/);
});

test("grain is an overlay layer above the cutout, not baked into the footage", () => {
  const html = buildHtml({ beats, style: loadStyle("cinematic"), format: FORMATS["9x16"], src: vertical, matte, hasCutout: true });
  assert.match(html, /#grain \{[^}]*z-index: 4/);
  assert.doesNotMatch(lookFilter(loadStyle("cinematic"))!, /noise/);
  assert.equal((html.match(/tl\.set\("#grain"/g) ?? []).length, 120, "12 jumps per second over 10 s");
});
