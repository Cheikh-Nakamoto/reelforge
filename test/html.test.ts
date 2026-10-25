import assert from "node:assert/strict";
import { test } from "node:test";
import { listStyles, loadStyle } from "../src/lib/style.js";
import type { Beats } from "../src/steps/beats.js";
import { captionZone } from "../src/steps/captions.js";
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
  fx: [],
  frames: [],
  scenes: [],
  parts: [],
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
  assert.match(html, /#frame-cam \{ z-index: 1;/);
  assert.match(html, /#frame-cut \{ z-index: 3; \}/);
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
  const style = loadStyle("tech-explainer");
  const html = buildHtml({ beats, style, format: FORMATS["9x16"], src: vertical, matte, hasCutout: true });
  const word = /<div class="w"[^>]* style="top:(\d+)px;left:-?\d+px;font-size:(\d+)px/.exec(html)!;
  const capTop = captionZone(style, vertical.width, vertical.height).top;
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

test("effects move the .shake level of both stacks and add overlays", () => {
  const style = loadStyle("reel-dynamique");
  const fx: Beats["fx"] = [
    { id: "fx0", kind: "zoomPunch", at: 2, duration: 0.45 },
    { id: "fx1", kind: "shake", at: 4, duration: 0.4 },
    { id: "fx2", kind: "whip", at: 5.9, duration: 0.24 },
    { id: "fx3", kind: "flash", at: 7, duration: 0.28 },
    { id: "fx4", kind: "lightLeak", at: 8, duration: 1.4 },
    { id: "fx5", kind: "colorPop", at: 2, duration: 1.6 },
  ];
  const html = buildHtml({ beats: { ...beats, fx }, style, format: FORMATS["9x16"], src: vertical, matte, hasCutout: true });
  assert.equal((html.match(/class="shake"/g) ?? []).length, 2, "both camera stacks carry the shake level");
  assert.match(html, /tl\.to\("\.shake", \{ scale: 1\.13/);
  assert.match(html, /id="flash"/);
  assert.match(html, /id="leak4" class="clip leak"/);
  assert.match(html, /<video id="bw" src="assets\/bw\.mp4"/);
  assert.ok(html.indexOf('id="bw"') < html.indexOf('id="bh0"'), "black-and-white layer sits under the words and the cutout");
  assert.doesNotMatch(html, /filter:/, "no CSS filters on footage");
});

test("frame reductions move both stacks and play B-roll under the bubble", () => {
  const frames: Beats["frames"] = [
    { id: "fr0", mode: "card", start: 3, end: 5 },
    { id: "fr1", mode: "bubble", start: 6, end: 9.5, broll: { src: "landing", from: 2 } },
  ];
  const html = buildHtml({ beats: { ...beats, behind: [], frames }, style: loadStyle("tech-explainer"), format: FORMATS["9x16"], src: vertical, matte, hasCutout: false });
  assert.match(html, /tl\.to\("\.frame", \{ x: \d+, y: \d+, scale: 0\.74/);
  assert.match(html, /tl\.to\("\.frame", \{ x: \d+, y: \d+, scale: 0\.36/);
  assert.match(html, /<video id="broll1" class="broll" src="assets\/broll-1\.mp4" data-start="6" data-duration="3\.5" data-media-start="2"/);
  assert.ok(html.indexOf('id="stage"') < html.indexOf('id="frame-cam"'), "stage under the footage");
  assert.doesNotMatch(html, /tl\.\w+\("#frame-/, "never one stack alone");
});

test("a scene covers the picture, its words slam in on their own times, captions step aside", () => {
  const style = loadStyle("reel-dynamique");
  const scenes: Beats["scenes"] = [{ id: "sc0", start: 0.1, end: 1.2, words: [{ id: "w0", text: "Bonjour", start: 0.1, end: 0.6 }], emphasis: 0 }];
  const html = buildHtml({ beats: { ...beats, behind: [], scenes }, style, format: FORMATS["9x16"], src: vertical, matte, hasCutout: false });
  assert.match(html, /id="sc0" class="clip scene"/);
  assert.match(html, /tl\.fromTo\("#sc0w0", \{ scale: 2\.6/);
  assert.doesNotMatch(html, /id="cap0"/, "the caption under the scene is not shown");
  assert.match(html, /data-hf-motion-blur/);
  assert.match(html, /<script src="assets\/motion-blur\.js"><\/script>/);
});

test("a scene arrives and leaves as an inverse zoom-through, blurred on its wrappers only", () => {
  const style = loadStyle("reel-dynamique");
  const scenes: Beats["scenes"] = [{ id: "sc0", start: 1, end: 3, words: [{ id: "w0", text: "Bonjour", start: 1.1, end: 1.6 }] }];
  const html = buildHtml({ beats: { ...beats, behind: [], scenes }, style, format: FORMATS["9x16"], src: vertical, matte, hasCutout: false });
  // Full-frame surface 20 px, type 10 px, both shrinking in and out: one Z sign (pull) across the scene.
  assert.match(html, /tl\.set\("#sc0 \.scbgf", \{ scale: 1\.25, filter: "blur\(20px\)" \}, 1\)/);
  assert.match(html, /tl\.to\("#sc0 \.scbgf", \{ scale: 1, filter: "blur\(0px\)", duration: 0\.5, ease: "expo\.out" \}, 1\)/);
  assert.match(html, /tl\.set\("#sc0 \.sctf", \{ scale: 1\.25, filter: "blur\(10px\)" \}, 1\)/);
  assert.match(html, /tl\.to\("#sc0 \.sctf", \{ scale: 0\.8, filter: "blur\(10px\)", duration: 0\.2, ease: "power3\.in" \}, 2\.8\)/);
  assert.match(html, /tl\.to\("#sc0 \.sctext", \{ opacity: 0\.15, duration: 0\.2, ease: "none" \}, 2\.8\)/);
  const tweens = html.split("\n").filter((l) => /tl\.\w+\(/.test(l));
  assert.ok(!tweens.some((l) => l.includes("filter") && l.includes("opacity")), "blur and opacity never share a tween");
  assert.ok(!tweens.some((l) => l.includes("filter") && /"\.(cam|push|shake|drift|frame)"|#cutout|#base/.test(l)), "never on the footage");
});

test("graphics perform, then leave: no idle loop on any of them", () => {
  const kinds = ["counter", "callout", "underline", "badge", "list", "question", "url", "compare", "definition", "cta", "hook"] as const;
  const mographs: Beats["mographs"] = kinds.map((kind, i) => ({
    id: `mg${i}`, kind, start: 0.2 + i * 0.85, end: 0.95 + i * 0.85, text: "go", value: kind === "counter" ? 5 : undefined,
  }));
  for (const { name } of listStyles()) {
    const html = buildHtml({ beats: { ...beats, behind: [], mographs }, style: loadStyle(name), format: FORMATS["9x16"], src: vertical, matte, hasCutout: false });
    assert.doesNotMatch(html, /yoyo|repeat:/, name);
  }
});

test("the call to action lands its arrow after the label, then presses once", () => {
  const mographs: Beats["mographs"] = [{ id: "mg0", kind: "cta", start: 5, end: 8, text: "abonne-toi" }];
  const html = buildHtml({ beats: { ...beats, behind: [], mographs }, style: loadStyle("reel-dynamique"), format: FORMATS["9x16"], src: vertical, matte, hasCutout: false });
  assert.match(html, /tl\.set\("#mg0 \.cta svg", \{ x: -\d+, opacity: 0 \}, 5\)/);
  assert.match(html, /tl\.to\("#mg0 \.cta svg", \{ x: 0, opacity: 1, duration: 0\.3, ease: "power4\.out" \}, 5\.35\)/);
  assert.equal((html.match(/tl\.to\("#mg0 \.cta", \{ scale: /g) ?? []).length, 2, "one press: down, then release");
});

test("screen recordings play in a 3D phone", () => {
  const style = loadStyle("tech-explainer");
  const html = buildHtml({
    beats: { ...beats, behind: [] }, style, format: FORMATS["9x16"], src: vertical, matte, hasCutout: false,
    devices: [{ src: "assets/part-1.mp4", start: 3, end: 8, from: 0, role: "screen" }],
  });
  assert.match(html, /<div id="dv0" class="devstage" style="opacity:0;z-index:2">/);
  assert.match(html, /tl\.set\("#dv0", \{ opacity: 1 \}, 3\)/);
  assert.match(html, /<video id="dv0v" src="assets\/part-1\.mp4" data-start="3" data-duration="5" data-media-start="0"/);
  assert.match(html, /tl\.fromTo\("#dv0 \.phone", \{ rotationY: 38/);
});
