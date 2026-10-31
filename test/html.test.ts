import assert from "node:assert/strict";
import { test } from "node:test";
import { listStyles, loadStyle } from "../src/lib/style.js";
import type { Beats } from "../src/steps/beats.js";
import { captionZone } from "../src/steps/captions.js";
import { buildComposition, buildHtml, computeLayout, FORMATS } from "../src/steps/html.js";
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
  const html = buildHtml({ beats: { ...beats, behind: [], cuts: [2.5, 2.9, 6] }, style, format: FORMATS["9x16"], src: vertical, matte, hasCutout: false });
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
  // Behind-words blur on their own wrapper (no cutout twin, decision 14); the footage never carries a CSS filter.
  const filtered = html.split("\n").filter((l) => /filter:/.test(l));
  assert.ok(!filtered.some((l) => /"\.(cam|push|shake|drift|frame)"|#cutout|#base|#bw|#cam|#cutcam|<video/.test(l)), "no CSS filters on footage");
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

test("frame reductions slide on the nudge curve: ramp-in, linear burst, long tail, both ways", () => {
  const frames: Beats["frames"] = [{ id: "fr0", mode: "card", start: 3, end: 5 }];
  const html = buildHtml({ beats: { ...beats, behind: [], frames }, style: loadStyle("tech-explainer"), format: FORMATS["9x16"], src: vertical, matte, hasCutout: false });
  const tweens = [...html.matchAll(/tl\.to\("\.frame", \{ x: (-?\d+), y: (-?\d+), scale: ([\d.]+), duration: ([\d.]+), ease: "([\w.]+)" \}, ([\d.]+)\)/g)]
    .map((m) => ({ scale: Number(m[3]), duration: Number(m[4]), ease: m[5], at: Number(m[6]) }));
  // Card scale 0.74 over 0.45 s: 10 % of the way in 20 % of the time, 65 % in 18 %, the last 25 % in 62 %.
  assert.deepEqual(tweens, [
    { scale: 0.974, duration: 0.09, ease: "power3.in", at: 3 },
    { scale: 0.805, duration: 0.081, ease: "none", at: 3.09 },
    { scale: 0.74, duration: 0.279, ease: "power4.out", at: 3.171 },
    { scale: 0.766, duration: 0.09, ease: "power3.in", at: 4.55 },
    { scale: 0.935, duration: 0.081, ease: "none", at: 4.64 },
    { scale: 1, duration: 0.279, ease: "power4.out", at: 4.721 },
  ]);
  assert.ok(tweens[2].duration >= 3 * tweens[0].duration, "the tail lasts at least three ramp-ins");
  assert.doesNotMatch(html, /"\.frame"[^\n]*inOut/, "no single inOut slide");
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

test("graphics leave in the current: a partial leftward slide that accelerates, fading out just before the cut, never a plain fade", () => {
  const kinds = ["counter", "callout", "underline", "badge", "list", "question", "url", "compare", "definition", "cta", "hook"] as const;
  const mographs: Beats["mographs"] = kinds.map((kind, i) => ({
    id: `mg${i}`, kind, start: 0.2 + i * 0.85, end: 0.95 + i * 0.85, text: "go", value: kind === "counter" ? 5 : undefined,
  }));
  for (const [fmt, travel] of [["9x16", 130], ["16x9", 230]] as const) {
    for (const { name } of listStyles()) {
      const html = buildHtml({ beats: { ...beats, behind: [], mographs }, style: loadStyle(name), format: FORMATS[fmt], src: vertical, matte, hasCutout: false });
      mographs.forEach((m, i) => {
        const at = Math.round((m.end - 0.34) * 1000) / 1000;
        const where = `${name} ${fmt} ${m.kind}`;
        assert.ok(html.includes(`tl.to("#mg${i} > div", { x: -${travel}, duration: 0.34, ease: "power4.in" }, ${at});`), `${where}: slide`);
        const fade = html.match(new RegExp(`tl\\.to\\("#mg${i} > div", \\{ opacity: 0, duration: ([\\d.]+), ease: "none" \\}, ([\\d.]+)\\)`));
        assert.ok(fade, `${where}: a separate linear fade`);
        // A lone graphic (nothing takes over): its fade dies ~0.02 s before the clip ends (cut-the-curve), so the
        // accelerating slide is seen. A fade starting with it was over at ~29 % of the path: ~15 px visible in 9:16.
        const [len, from] = [Number(fade[1]), Number(fade[2])];
        assert.ok(Math.abs(m.end - (from + len) - 0.02) < 0.005, `${where}: the fade ends 0.02 s before the clip (${from} + ${len})`);
        assert.ok(len >= 0.18 && len <= 0.3, `${where}: a fade of 0.18–0.3 s (${len})`);
        assert.ok(from > at, `${where}: the slide is under way when the fade starts`);
      });
      assert.doesNotMatch(html, /tl\.to\("#mg\d+ > div", \{ opacity: 0, duration: 0\.25, ease: "power2\.in" \}/, `${name} ${fmt}: no plain fade`);
    }
  }
});

test("side entries of graphics ride the same current as their exit", () => {
  const mographs: Beats["mographs"] = [
    { id: "mg0", kind: "compare", start: 1, end: 3, text: "A vs B", items: ["A", "B"] },
    { id: "mg1", kind: "badge", start: 4, end: 6, text: "rapide" },
  ];
  for (const { name } of listStyles()) {
    const html = buildHtml({ beats: { ...beats, behind: [], mographs }, style: loadStyle(name), format: FORMATS["16x9"], src: vertical, matte, hasCutout: false });
    for (const sel of ["#mg0 .sa", "#mg0 .sb", "#mg1 .pill"]) {
      const from = html.match(new RegExp(`tl\\.fromTo\\("${sel.replace(/\./g, "\\.")}", \\{([^}]*)\\}`));
      assert.ok(from, `${name} ${sel}: an entrance`);
      const x = from[1].match(/\bx: (-?\d+)/);
      assert.ok(x && Number(x[1]) > 0, `${name} ${sel}: enters from the right, moving left like the exit (${from[1]})`);
    }
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
  // Full-surface blur (cut-the-curve: 18–20 px) on a wrapper of the phone, never on the video, never with opacity.
  assert.match(html, /<div class="devblur">\s*<div class="phone"/, "the phone sits in a blur wrapper");
  assert.match(html, /tl\.set\("#dv0 \.devblur", \{ filter: "blur\(18px\)" \}, 3\)/, "arrives blurred");
  assert.match(html, /tl\.to\("#dv0 \.devblur", \{ filter: "blur\(0px\)", duration: [\d.]+, ease: "expo\.out" \}, 3\)/, "focuses with the push-in");
  assert.match(html, /tl\.to\("#dv0 \.devblur", \{ filter: "blur\(18px\)", duration: 0\.45, ease: "power3\.in" \}, 7\.55\)/, "blurs out with the push-out");
  const lines = html.split("\n").filter((l) => /tl\.\w+\(/.test(l) && l.includes("#dv0"));
  assert.ok(!lines.some((l) => l.includes("filter") && l.includes("opacity")), "blur and opacity share a tween");
  assert.ok(!lines.some((l) => l.includes("filter") && !l.includes('"#dv0 .devblur"')), "blur only on the wrapper");
  assert.ok(!/#dv0v[^{]*\{[^}]*filter/.test(html), "never a filter on the video");
});

test("landing shakes never overlap: a word landing mid-shake replaces the shake in progress", () => {
  const style = loadStyle("reel-dynamique");
  const scenes: Beats["scenes"] = [{ id: "sc0", start: 1, end: 3, words: [
    { id: "w0", text: "le", start: 1.5, end: 1.55 },
    { id: "w1", text: "piège", start: 1.55, end: 2 },
  ] }];
  const html = buildHtml({ beats: { ...beats, behind: [], scenes }, style, format: FORMATS["9x16"], src: vertical, matte, hasCutout: false });
  const shakes = [...html.matchAll(/tl\.to\("#sc0 \.sctext", \{ x: (-?\d+), y: (-?\d+), duration: ([\d.]+), ease: "none" \}, ([\d.]+)\)/g)]
    .map((m) => ({ x: Number(m[1]), y: Number(m[2]), from: Number(m[4]), to: Number(m[4]) + Number(m[3]) }))
    .sort((a, b) => a.from - b.from);
  assert.ok(shakes.length >= 4, "both landings shake");
  for (let i = 1; i < shakes.length; i++) assert.ok(shakes[i].from >= shakes[i - 1].to - 1e-6, `tween at ${shakes[i].from} overlaps the one ending ${shakes[i - 1].to}`);
  // The second landing plays whole and the block comes to rest.
  assert.deepEqual(shakes.slice(-3).map((s) => [s.x, s.y]), [[9, -6], [-6, 4], [0, 0]]);
  assert.ok(Math.abs(shakes.at(-3)!.from - (1.55 - 0.04 + 0.2)) < 1e-6, "second shake starts on its own landing");
});

// Tweens of one behind-word (the word, its wrapper, its letters), in timeline order.
function behindTweens(html: string, id: string) {
  return html.split("\n").filter((l) => /tl\.\w+\(/.test(l) && l.includes(`"#${id} `))
    .map((l) => ({ line: l, at: Number(/, ([\d.]+)\);\s*$/.exec(l)?.[1] ?? NaN) }))
    .sort((a, b) => a.at - b.at);
}

test("a slam behind-word arrives as an inverse zoom-through: oversized and blurred on its wrapper, then retracts", () => {
  const style = loadStyle("reel-dynamique", { behind: { animation: "slam" } });
  const html = buildHtml({ beats, style, format: FORMATS["9x16"], src: vertical, matte, hasCutout: true });
  assert.match(html, /<div class="bwf"[^>]*>\s*<div class="w"/, "the word sits in a wrapper");
  assert.match(html, /tl\.set\("#bh0 \.bwf", \{ scale: [\d.]+, filter: "blur\(10px\)" \}, 2\)/);
  assert.match(html, /tl\.to\("#bh0 \.bwf", \{ scale: 1, filter: "blur\(0px\)", duration: [\d.]+, ease: "expo\.out" \}, 2\)/);
  const entry = Number(/tl\.set\("#bh0 \.bwf", \{ scale: ([\d.]+)/.exec(html)![1]);
  assert.ok(entry > 1, "arrives oversized");
});

test("every behind-word animation keeps one Z sign and leaves shrinking, blur on the wrapper, never with opacity", () => {
  for (const animation of ["slam", "flip", "rise", "track"] as const) {
    const style = loadStyle("reel-dynamique", { behind: { animation } });
    const html = buildHtml({ beats, style, format: FORMATS["9x16"], src: vertical, matte, hasCutout: true });
    const tweens = behindTweens(html, "bh0");
    assert.ok(!tweens.some((t) => t.line.includes("filter") && t.line.includes("opacity")), `${animation}: blur and opacity share a tween`);
    assert.ok(!tweens.some((t) => t.line.includes("filter") && !t.line.includes('"#bh0 .bwf"')), `${animation}: blur only on the wrapper`);
    // Scale only ever falls, wrapper and word alike: a pull from arrival to exit.
    const scales = tweens.flatMap((t) => [...t.line.matchAll(/\bscale: ([\d.]+)/g)].map((m) => Number(m[1])));
    for (let k = 1; k < scales.length; k++) assert.ok(scales[k] <= scales[k - 1], `${animation}: scale grows ${scales[k - 1]} → ${scales[k]}`);
    assert.match(html, /tl\.to\("#bh0 \.bwf", \{ scale: 0\.8, filter: "blur\(10px\)", duration: 0\.2, ease: "power3\.in" \}, 3\.4\)/, animation);
    assert.match(html, /tl\.to\("#bh0 \.w", \{ opacity: 0\.15, duration: 0\.2, ease: "none" \}, 3\.4\)/, animation);
  }
});

// Scale of a camera level over the timeline, from its generated set/to lines: each tween runs from the value the
// level holds at its start (the last set or tween end before it) to its own target.
function cameraTweens(html: string, cls: string) {
  const lines = html.split("\n").filter((l) => (l.includes(`tl.set("${cls}"`) || l.includes(`tl.to("${cls}"`)) && /\bscale: /.test(l));
  const ops = lines.map((l, k) => ({
    k, to: l.includes("tl.to("), scale: Number(/scale: ([\d.]+)/.exec(l)![1]),
    dur: Number(/duration: ([\d.]+)/.exec(l)?.[1] ?? 0), at: Number(/, ([\d.]+)\);\s*$/.exec(l)![1]),
  })).sort((a, b) => a.at - b.at || a.k - b.k);
  let held = 1;
  const out: { from: number; to: number; start: number; end: number }[] = [];
  for (const o of ops) {
    if (o.to) out.push({ from: held, to: o.scale, start: o.at, end: o.at + o.dur });
    held = o.scale;
  }
  return out;
}

test("the camera never pushes in while a behind-word shrinks: rush and word share one Z sign", () => {
  for (const animation of ["slam", "flip", "rise", "track"] as const) {
    const style = loadStyle("reel-dynamique", { behind: { animation } });
    assert.ok(style.motion.punchIn > 1 && style.motion.drift > 1, "the style moves the camera");
    const html = buildHtml({ beats, style, format: FORMATS["9x16"], src: vertical, matte, hasCutout: true });
    const shrinking = cameraTweens(html, "#bh0 .bwf").filter((w) => w.to < w.from);
    assert.ok(shrinking.length >= 1, `${animation}: the word shrinks somewhere`);
    for (const cls of [".push", ".cam", ".drift"]) {
      for (const c of cameraTweens(html, cls).filter((c) => c.to > c.from)) {
        for (const w of shrinking) {
          const overlap = Math.min(c.end, w.end) - Math.max(c.start, w.start);
          assert.ok(overlap <= 1e-6, `${animation}: ${cls} grows ${c.from} → ${c.to} (${c.start}–${c.end}) while the word shrinks (${w.start}–${w.end})`);
        }
      }
    }
    assert.ok(cameraTweens(html, ".push").some((c) => c.to > c.from), `${animation}: the punch-in is kept`);
  }
});

test("a strong-word zoom punch and a jump-cut reframe never grow the camera while a behind-word shrinks", () => {
  // The heuristic's own fx: a punch on the word's first frame (effects.strongWord), and a cut inside the word.
  const fx: Beats["fx"] = [{ id: "fx0", kind: "zoomPunch", at: 2, duration: 0.45, reason: "mot derrière « monter »" }];
  for (const animation of ["slam", "flip", "rise", "track"] as const) {
    const style = loadStyle("reel-dynamique", { behind: { animation } });
    assert.ok(style.motion.jumpZoom > 1, "the style reframes on jump cuts");
    const html = buildHtml({ beats: { ...beats, fx }, style, format: FORMATS["9x16"], src: vertical, matte, hasCutout: true });
    const b = beats.behind[0];
    const shrinking = cameraTweens(html, "#bh0 .bwf").filter((w) => w.to < w.from);
    for (const cls of [".push", ".cam", ".drift", ".shake"]) {
      for (const c of cameraTweens(html, cls).filter((c) => c.to > c.from)) {
        for (const w of shrinking) {
          const overlap = Math.min(c.end, w.end) - Math.max(c.start, w.start);
          assert.ok(overlap <= 1e-6, `${animation}: ${cls} grows ${c.from} → ${c.to} (${c.start}–${c.end}) while the word shrinks (${w.start}–${w.end})`);
        }
      }
    }
    // The take keeps its framing for the whole word: the placement was measured at its start (decision 7).
    const jumps = [...html.matchAll(/tl\.set\("\.cam", \{ scale: [\d.]+ \}, ([\d.]+)\)/g)].map((m) => Number(m[1]));
    assert.ok(jumps.length >= 1, `${animation}: the jump zoom still reframes outside the word`);
    assert.ok(!jumps.some((at) => at > b.start && at < b.end), `${animation}: .cam jumps at ${jumps} inside ${b.start}–${b.end}`);
    // The punch is kept, not dropped.
    assert.ok(html.split("\n").some((l) => /tl\.(set|to)\("\.shake", \{ scale: 1\.1[0-9]*/.test(l)), `${animation}: the punch is kept`);
  }
});

test("a whip or a ladder edited into a behind-word never slides nor grows .shake under the word, and says so", () => {
  // proposeEffects never puts these under a behind-word; beats.json is hand-editable (decision 2), so the composition
  // guards them too: the rush would slip under a fixed word and step out of the measured placement.
  const fx: Beats["fx"] = [
    { id: "fx0", kind: "ladder", at: 1.9, duration: 1 },
    { id: "fx1", kind: "whip", at: 3.1, duration: 0.24 },
    { id: "fx2", kind: "whip", at: 5.9, duration: 0.24 },
  ];
  const b = beats.behind[0];
  const { html, notes } = buildComposition({ beats: { ...beats, fx }, style: loadStyle("reel-dynamique"), format: FORMATS["9x16"], src: vertical, matte, hasCutout: true });
  const shake = html.split("\n").filter((l) => /tl\.(set|to)\("\.shake"/.test(l)).map((l) => ({
    l, at: Number(/, ([\d.]+)\);\s*$/.exec(l)![1]), dur: Number(/duration: ([\d.]+)/.exec(l)?.[1] ?? 0),
  }));
  for (const s of shake.filter((s) => s.at < b.end && s.at + s.dur > b.start)) {
    assert.doesNotMatch(s.l, /xPercent: -?[1-9]/, `.shake slides under the word: ${s.l}`);
    assert.doesNotMatch(s.l, /scale: 1\.[0-9]*[1-9]/, `.shake grows under the word: ${s.l}`);
  }
  // The whip outside the word plays whole; the one inside keeps its flash over the cut.
  assert.ok(shake.some((s) => s.at === 5.9 && /xPercent: -?[1-9]/.test(s.l)), "the whip outside the word is kept");
  assert.match(html, /tl\.to\("#flash", \{ opacity: [\d.]+, duration: 0\.12, ease: "power1\.in" \}, 3\.1\)/);
  assert.equal(notes.length, 2, notes.join(" | "));
  assert.match(notes.join("\n"), /fx0.*ladder.*monter/);
  assert.match(notes.join("\n"), /fx1.*whip.*monter/);
});

// Every scale set and tween of a camera level, each with the value it starts from (the last one written before it).
function cameraOps(html: string, cls: string) {
  const lines = html.split("\n").filter((l) => (l.includes(`tl.set("${cls}"`) || l.includes(`tl.to("${cls}"`)) && /\bscale: /.test(l));
  const ops = lines.map((l, k) => ({
    k, set: l.includes("tl.set("), scale: Number(/scale: ([\d.]+)/.exec(l)![1]),
    dur: Number(/duration: ([\d.]+)/.exec(l)?.[1] ?? 0), at: Number(/, ([\d.]+)\);\s*$/.exec(l)![1]),
  })).sort((a, b) => a.at - b.at || a.k - b.k);
  let held = 1;
  return ops.map((o) => {
    const op = { set: o.set, from: held, to: o.scale, start: o.at, end: o.at + o.dur };
    held = o.scale;
    return op;
  });
}

test("the rush carries the scene's Z vector across both seams: a camera level pulls into the scene and out of it", () => {
  // The seam gate samples the rush 0.1 s and one frame before the scene's first frame, and one frame and 0.1 s after
  // its last. A take boundary on either side (3.95 and 6 here, as 9.817 after the scene of synth-motion) must not
  // reframe there: a .cam set to the tight framing read as a push against the scene's pull (ticket 0026).
  const scenes: Beats["scenes"] = [{ id: "sc0", start: 4, end: 5.95, words: [{ id: "w0", text: "Bonjour", start: 4.1, end: 4.6 }] }];
  const f = 1 / 30;
  const seams = [
    { name: "into the scene", window: [3.9, 4], sampled: [3.9, 4 - f] },
    { name: "out of the scene", window: [5.95, 6.05], sampled: [5.95 + f, 6.05] },
  ];
  for (const motion of [{}, { drift: 1 }]) {
    const style = loadStyle("reel-dynamique", { motion });
    const html = buildHtml({ beats: { ...beats, behind: [], cuts: [2.5, 3.95, 6], scenes }, style, format: FORMATS["9x16"], src: vertical, matte, hasCutout: true });
    const levels = [".cam", ".push", ".shake", ".drift"].map((cls) => ({ cls, ops: cameraOps(html, cls) }));
    for (const { name, window: [w0, w1], sampled: [s0, s1] } of seams) {
      const tag = `drift ${style.motion.drift}, ${name}`;
      const pulls = levels.filter(({ ops }) => ops.some((o) => !o.set && o.to < o.from && o.start <= s0 + 1e-6 && o.end >= s1 - 1e-6));
      assert.ok(pulls.length >= 1, `${tag}: no camera level shrinks through ${s0}–${s1}`);
      for (const { cls, ops } of levels) {
        for (const o of ops) {
          const inside = o.set ? o.start > w0 + 1e-6 && o.start < w1 - 1e-6 : Math.min(o.end, w1) - Math.max(o.start, w0) > 1e-6;
          assert.ok(!(inside && o.to > o.from), `${tag}: ${cls} ${o.set ? "set" : "tween"} grows ${o.from} → ${o.to} at ${o.start}`);
          assert.ok(!(o.set && inside && o.to !== o.from), `${tag}: ${cls} jumps ${o.from} → ${o.to} at ${o.start}, inside the seam`);
        }
      }
    }
  }
});

test("a frame reduction edited over a behind-word drops the word, not the frame, and says so", () => {
  // .frame shrinks the stacks into a card and grows them back: under a word placed on the full frame, the subject
  // leaves the placement and the release pushes against the word's pull. Reduced windows get no behind-words (decision 9).
  const frames: Beats["frames"] = [{ id: "fr0", mode: "card", start: 3, end: 5 }];
  const fx: Beats["fx"] = [{ id: "fx0", kind: "colorPop", at: 2, duration: 1.6 }];
  const { html, notes, dropped } = buildComposition({ beats: { ...beats, frames, fx }, style: loadStyle("reel-dynamique"), format: FORMATS["9x16"], src: vertical, matte, hasCutout: true });
  assert.doesNotMatch(html, /id="bh0"/);
  assert.doesNotMatch(html, /#bw-wrap", \{ opacity: 1/, "its colour pop goes with it");
  assert.match(html, /tl\.to\("\.frame", \{ x: \d+, y: \d+, scale: 0\.\d+/, "the frame is kept");
  assert.deepEqual(dropped, ["bh0"]);
  assert.match(notes.join("\n"), /monter.*fr0/);
});

// Every branch that writes a tween: all graphics, a scene, a phone, the effects, a behind-word, captions with a key
// word and an emoji. Each shipped style, then every caption and behind-word animation and caption look on top of it.
function everyTween(style: ReturnType<typeof loadStyle>, fmt: "9x16" | "16x9") {
  const kinds = ["counter", "callout", "underline", "badge", "list", "question", "url", "compare", "definition", "cta", "hook"] as const;
  const mographs: Beats["mographs"] = kinds.map((kind, i) => ({
    id: `mg${i}`, kind, start: 0.2 + i * 0.85, end: 0.95 + i * 0.85, text: "un deux trois", value: kind === "counter" ? 5 : undefined,
    items: kind === "compare" ? ["A", "B"] : kind === "hook" ? ["un", "deux"] : kind === "definition" ? ["mot", "sens"] : undefined,
  }));
  const fx: Beats["fx"] = (["shake", "zoomPunch", "whip", "flash", "strobe", "ladder", "lightLeak", "colorPop"] as const)
    .map((kind, i) => ({ id: `fx${i}`, kind, at: 0.5 + i * 1.1, duration: 0.6 }));
  const words = [{ id: "w0", text: "Bonjour", start: 0.1, end: 0.5 }, { id: "w1", text: "tout", start: 0.5, end: 0.8 }, { id: "w2", text: "le monde", start: 0.8, end: 1.2 }];
  return buildHtml({
    beats: {
      ...beats, duration: 12, mographs, fx,
      captions: [{ id: "cap0", start: 0.1, end: 1.2, words, emphasis: 2, emoji: "🔥" }],
      scenes: [{ id: "sc0", start: 9, end: 10.5, words: words.map((w) => ({ ...w, start: w.start + 9, end: w.end + 9 })), emphasis: 0 }],
      frames: [{ id: "fr0", mode: "card", start: 10.6, end: 11.8 }],
    },
    style, format: FORMATS[fmt], src: vertical, matte, hasCutout: true,
    devices: [{ src: "assets/part-1.mp4", start: 3, end: 8, from: 0, role: "screen" }],
  });
}

test("no style ever writes a bouncing or elastic ease, nor an overshoot past back.out(1.7)", () => {
  const variants: Record<string, unknown>[] = [{}, { motion: { depth: 0 } },
    ...["pop", "rise", "karaoke", "slam"].map((animation) => ({ captions: { animation } })),
    ...["bold", "pill", "editorial", "minimal"].map((look) => ({ captions: { look } })),
    ...["slam", "rise", "track", "flip"].map((animation) => ({ behind: { animation } }))];
  for (const { name } of listStyles()) {
    for (const v of variants) {
      for (const fmt of ["9x16", "16x9"] as const) {
        const where = `${name} ${JSON.stringify(v)} ${fmt}`;
        const eases = [...everyTween(loadStyle(name, v), fmt).matchAll(/ease: "([^"]+)"/g)].map((m) => m[1]);
        assert.ok(eases.length > 50, `${where}: the fixture reaches the tweens`);
        for (const e of eases) {
          assert.doesNotMatch(e, /bounce|elastic/, `${where}: ${e}`);
          const back = e.match(/^back\.\w+(?:\((.*)\))?$/);
          if (back) assert.ok(Number(back[1] ?? 1.7) <= 1.7, `${where}: ${e} overshoots past 1.7`);
        }
      }
    }
  }
});

test("a word flipped up on its X axis shares one ease and duration, behind-word or hook line", () => {
  const mographs: Beats["mographs"] = [{ id: "mg0", kind: "hook", start: 5, end: 8, text: "a", items: ["un", "deux"] }];
  const style = loadStyle("reel-dynamique", { behind: { animation: "flip" } });
  const html = buildHtml({ beats: { ...beats, mographs }, style, format: FORMATS["9x16"], src: vertical, matte, hasCutout: true });
  const flips = [...html.matchAll(/tl\.fromTo\("(#bh0 \.w|#mg0 \.hl\d)", \{ rotationX: -9\d.*duration: ([\d.]+), ease: "([^"]+)" \}/g)]
    .map((m) => `${m[2]} ${m[3]}`);
  assert.equal(flips.length, 3, "the behind-word and both hook lines flip");
  assert.deepEqual([...new Set(flips)], ["0.5 back.out(1.6)"]);
});

test("a cascade spreads its starts over 0.5 s at most, however many items it has", () => {
  const mographs: Beats["mographs"] = [
    { id: "mg0", kind: "question", start: 1, end: 4, text: "pourquoi est-ce que tout le monde dit que ce budget ne suffit jamais vraiment ?" },
    { id: "mg1", kind: "hook", start: 5, end: 8, text: "a", items: ["un", "deux", "trois", "quatre"] },
  ];
  for (const { name } of listStyles()) {
    const html = buildHtml({ beats: { ...beats, behind: [], mographs }, style: loadStyle(name), format: FORMATS["9x16"], src: vertical, matte, hasCutout: false });
    for (const [sel, n] of [["#mg0 .q", 15], ["#mg1 .hl", 4]] as const) {
      const starts = [...html.matchAll(new RegExp(`tl\\.fromTo\\("${sel.replace(/\./g, "\\.")}\\d+", .*, ([\\d.]+)\\);`, "g"))].map((m) => Number(m[1]));
      assert.equal(starts.length, n, `${name} ${sel}: every item enters`);
      assert.ok(Math.max(...starts) - Math.min(...starts) <= 0.5 + 1e-9, `${name} ${sel}: total stagger ${Math.max(...starts) - Math.min(...starts)}`);
      assert.ok(starts.every((s, k) => k === 0 || s > starts[k - 1]), `${name} ${sel}: still in reading order`);
    }
  }
});

test("a single entrance lasts 0.8 s at most, in every style", () => {
  for (const { name } of listStyles()) {
    for (const fmt of ["9x16", "16x9"] as const) {
      // fromTo is how studio writes an entrance; linear ones are whole-window moves (a stage glow), not entrances.
      const entries = everyTween(loadStyle(name), fmt).split("\n").filter((l) => l.includes("tl.fromTo(") && !l.includes('ease: "none"'));
      assert.ok(entries.length > 20, `${name} ${fmt}: the fixture reaches the entrances`);
      for (const l of entries) {
        const d = Number(l.match(/duration: ([\d.]+)/)?.[1]);
        assert.ok(d <= 0.8, `${name} ${fmt}: ${d} s in ${l.trim().slice(0, 60)}`);
      }
    }
  }
});
