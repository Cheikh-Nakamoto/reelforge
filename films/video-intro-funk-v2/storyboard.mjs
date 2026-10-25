// XewXew funk intro, second cut (9:16, ~50 s): the README's script on "WA WA WA FUNK (Remix SLOWED)" (107 BPM), rebuilt
// on motion-doctrine. One current (LEFT) for ordinary seams; reserved vectors spent on meaning: Z push into the party
// and into the last voice note, UP for the reveal, inverse zoom for the end card. Seams cut mid-motion on both sides,
// no idle loops, an oversized cursor whose click causes the next beat, and an ending that rhymes with the opening.
// `node storyboard.mjs` rewrites work/video-intro-funk-v2/05-compose/<FMT>/index.html and beats.json (generated, not
// versioned) and the seam ledger next to this file. Run ./setup.sh once first (README.md).
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const HERE = new URL(".", import.meta.url).pathname;
const ROOT = join(HERE, "../..");
const WORK = process.env.WORK ?? join(ROOT, "work/video-intro-funk-v2");
// FMT=16x9 builds the landscape version: same timeline and sound, its own layout (phone left, words right).
const FMT = process.env.FMT ?? "9x16";
const LAND = FMT === "16x9";
const [W, H] = LAND ? [1920, 1080] : [1080, 1920];
const DIR = join(WORK, "05-compose", FMT);
// `hyperframes beats` on the track, kept here: the grid below is fitted on it.
const BEATS = join(HERE, "wawawa.beats.json");
const SFX_LIB = join(ROOT, "assets/sfx");
const r3 = (x) => Math.round(x * 1000) / 1000;

// ---------------------------------------------------------------- beat grid
// Least squares over the detected beats of the drum sections: the slowed track keeps its tempo, the detector jitters.
const det = JSON.parse(readFileSync(BEATS, "utf8")).beats.map((b) => b.time);
const pts = det.map((t, j) => [j, t]).filter(([j]) => (j >= 24 && j <= 56) || (j >= 104 && j <= 124));
const mx = pts.reduce((s, [j]) => s + j, 0) / pts.length, my = pts.reduce((s, [, t]) => s + t, 0) / pts.length;
const P = pts.reduce((s, [j, t]) => s + (j - mx) * (t - my), 0) / pts.reduce((s, [j]) => s + (j - mx) ** 2, 0);
const trackBeat = (j) => my + P * (j - mx);
const LEAD = 0.06;
const MEDIA0 = r3(trackBeat(24) - LEAD);
/**
 * Film time of track beat j. Measured on the low band (`lo`): bass and kick from beat 26, drop on 34, breakdown from
 * 58, a two-beat dip at 83, the lift on 90, one bass hit on 106. Bars start on beats 26, 30, 34… (j ≡ 2 mod 4).
 */
const V = (j) => r3(LEAD + P * (j - 24));
const END = r3(V(108) + 3.3);

// ---------------------------------------------------------------- brand and layout
const C = { bg: "#F0EEE9", ink: "#1F1B18", em: "#0F5C4A", gold: "#C9A34E", white: "#FFFFFF" };
const IMG = "assets/media/images";
// The screen recordings hold the page in their top-left 540×1168 px only (the rest is grey): cropped copies.
const VID = "assets/media/videos-fixed";
// Phone: a 390-pt screen shown at 652 px (1.67×) in 9:16, 512 px in 16:9 (left half), its bottom bezel cropped by
// the frame; the screen keeps the captures' aspect.
const PW = LAND ? 540 : 680, PAD = 14, SW = PW - 2 * PAD, SH = Math.round((SW * 2532) / 1170), PHH = SH + 2 * PAD;
const PL = LAND ? 350 : (W - PW) / 2, PT = LAND ? 70 : 560;
/** Frame coordinates of a point given as fractions of the phone screen. */
const onScreen = (fx, fy, dx = 0) => [r3(PL + PAD + fx * SW + dx), r3(PT + PAD + fy * SH)];

// ---------------------------------------------------------------- timeline helpers
const html = [];
const tl = [];
const lit = (o) => JSON.stringify(o);
const set = (s, v, at) => tl.push(`      tl.set(${lit(s)}, ${lit(v)}, ${r3(at)});`);
const to = (s, v, at) => tl.push(`      tl.to(${lit(s)}, ${lit({ ...v, duration: r3(v.duration) })}, ${r3(at)});`);
const show = (s, a, b) => {
  set(s, { autoAlpha: 1 }, a);
  if (b !== undefined) set(s, { autoAlpha: 0 }, b);
};
/** A directional blur on a wrapper: an SVG filter switched on only for its window, its deviation tweened. */
const filters = [];
function blurFilter(id) {
  filters.push(`<filter id="${id}" x="-25%" y="-25%" width="150%" height="150%" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="0 0" /></filter>`);
  return id;
}
function blurPulse(wrapper, f, a, peakAt, b, dev) {
  set(wrapper, { filter: `url(#${f})` }, a);
  to(`#${f} feGaussianBlur`, { attr: { stdDeviation: dev }, duration: peakAt - a, ease: "power2.in" }, a);
  to(`#${f} feGaussianBlur`, { attr: { stdDeviation: "0 0" }, duration: b - peakAt, ease: "power2.out" }, peakAt);
  set(wrapper, { filter: "none" }, b);
}
/** Words as spans; a word starting with * is the accent (Fraunces italic). */
const words = (text, prefix) =>
  text.split(" ").map((w, i) => `<span id="${prefix}${i}" class="w${w.startsWith("*") ? " acc" : ""}">${w.replace(/^\*/, "")}</span>`).join(" ");
const ids = (prefix, text) => text.split(" ").map((_, i) => `#${prefix}${i}`);

// Waterfall cut (cut-the-curve §4): outgoing words ramp out on power4.in, incoming words ignite mid-path. The last
// word's fade ends 0.02 s before the cut, so something is still streaking when the next words ignite; a 0.2 s ramp
// (the short end of the template's range) keeps that last word as fast at the cut as the incoming words (seam-gate).
function wordsOut(sels, cut, axis = "x") {
  let s = cut - 0.2 - 0.022 * (sels.length - 1);
  for (const el of sels) {
    to(el, { [axis]: -230, duration: 0.2, ease: "power4.in" }, s);
    to(el, { opacity: 0, duration: 0.18, ease: "power1.in" }, s);
    s += 0.022;
  }
}
function wordsIn(sels, cut, axis = "x") {
  let off = 0, gap = 0.05;
  for (const el of sels) {
    set(el, { [axis]: 230, opacity: 0 }, 0);
    set(el, { opacity: 0.35 }, cut + off);
    to(el, { [axis]: 0, opacity: 1, duration: 0.3, ease: "power4.out" }, cut + off);
    off += gap;
    gap *= 0.84;
  }
}
// Waterfall entry (§6): binary reveal, whip up from below, each word starting as the previous one settles.
function wordsArrive(sels, t0, heavy = []) {
  let at = t0;
  sels.forEach((el, i) => {
    const big = heavy.includes(i);
    const [dy, dur] = big ? [76, 0.19] : [46, 0.15];
    set(el, { opacity: 0, y: dy }, 0);
    set(el, { opacity: 1 }, at);
    to(el, { y: 0, duration: dur, ease: "power4.out" }, at);
    at += dur - 1 / 30;
  });
}
/** "The whole line blurring in": binary reveal, then 8 px → 0. */
function lineIn(sel, at) {
  set(sel, { opacity: 0, filter: "blur(8px)" }, 0);
  set(sel, { opacity: 1 }, at);
  to(sel, { filter: "blur(0px)", duration: 0.18, ease: "power2.out" }, at);
}
/** A landing shake: four frames, decaying (a hit, not a wobble). */
function shake(sel, at, amp = 12) {
  [[amp, -amp * 0.6], [-amp * 0.7, amp * 0.45], [amp * 0.35, -amp * 0.2], [0, 0]].forEach(([x, y], k) =>
    to(sel, { x, y, duration: 1 / 30, ease: "none" }, at + k / 30));
}
/** A number counting by discrete sets: a callback is skipped when the timeline is seeked past it, sets are not. */
function countUp(sel, from, toV, a, dur, inv) {
  for (let v = from + 1; v <= toV; v++) set(sel, { textContent: String(v) }, a + dur * inv((v - from) / (toV - from)));
}
const IN2 = (x) => Math.sqrt(x); // inverse of power2.in

// ---------------------------------------------------------------- sound
const catalog = JSON.parse(readFileSync(join(SFX_LIB, "catalog.json"), "utf8"));
const rot = {};
let track = 30;
const audio = [];
const cues = [];
/** A sound that lands at `at`: a whoosh's peak, any other sound's attack. Repeated kinds rotate their takes. */
function sfx(kind, at, volume = 0.6, file, takes) {
  const pool = takes ?? Object.keys(catalog).filter((k) => k.startsWith(kind + "/")).sort();
  const f = file ?? pool[(rot[kind + pool.length] = ((rot[kind + pool.length] ?? -1) + 1)) % pool.length];
  const info = catalog[f];
  const start = at - (kind === "whoosh" ? info.peak : info.onset);
  cues.push({ id: `sfx${cues.length}`, kind, at: r3(at), file: f });
  mkdirSync(join(DIR, "assets/sfx", dirname(f)), { recursive: true });
  copyFileSync(join(SFX_LIB, f), join(DIR, "assets/sfx", f));
  audio.push(`      <audio id="sfx${track}" src="assets/sfx/${f}" data-start="${r3(Math.max(0, start))}" data-duration="${info.duration}" ` +
    `data-media-start="${r3(Math.max(0, -start))}" data-track-index="${track++}" data-volume="${volume}"></audio>`);
}
const WHOOSH = ["whoosh/swish-3.wav", "whoosh/swish-7.wav", "whoosh/swish-9.wav"];
const POPS = ["pop/drop_001.wav", "pop/drop_002.wav", "pop/drop_003.wav"];
const TICKS = ["click/tick_001.wav", "click/tick_002.wav"];
const whoosh = (at, v = 0.5) => sfx("whoosh", at, v, undefined, WHOOSH);

// ---------------------------------------------------------------- grounds
// Dark for the old way (hook, problem), emerald for the brand, cream for the product. Floods change the ground while
// the hero (the phone) stays; scene cuts swap it on the cut frame.
html.push(`    <div id="gDark" class="ground" style="opacity:0;visibility:hidden"></div>
    <div id="gEm" class="ground" style="opacity:0;visibility:hidden"><div class="glow"></div></div>
    <div id="gCream" class="ground" style="opacity:0;visibility:hidden"><div class="blob b1"></div><div class="blob b2"></div></div>`);
show("#gDark", 0);

// ---------------------------------------------------------------- the camera's photo row (hook and ending)
// Cards stand in a row in 3D; the camera trucks LEFT one card per beat, its fastest frame on the beat, the frame
// smeared horizontally; the card leaving turns away, the one arriving turns to face us, its photo slides in parallax.
const D = LAND ? 960 : 1000;
function photoRow(id, photos, captions) {
  const f = blurFilter(`f${id}`);
  const cards = photos.map((p, k) => `          <div id="${id}c${k}" class="pcard" style="left:${k * D}px">
            <div class="pframe"><div class="par"><img src="${IMG}/photos-modeles/${p}.jpg"></div><div class="shade"></div>${captions ? `<p class="pcap">${captions[k]}</p>` : ""}</div>
          </div>`).join("\n");
  html.push(`    <div id="${id}" class="scene" style="opacity:0;visibility:hidden">
      <div id="${id}Zoom" class="fill"><div id="${id}Fade" class="fill"><div id="${id}Blur" class="fill">
        <div id="${id}In" class="fill persp"><div id="${id}World" class="world">
${cards}
        </div></div>
      </div></div></div>
    </div>`);
  photos.forEach((_, k) => {
    if (k) set(`#${id}c${k}`, { rotationY: 34, z: -320 }, 0);
    set(`#${id}c${k} .par`, { x: k ? -70 : 0 }, 0);
  });
  return f;
}
function truck(id, f, k, beat) {
  // 0.54 s: consecutive beats (the ending) must not overlap; the fastest frame stays on the beat.
  const a = V(beat) - 0.27, m = { duration: 0.54, ease: "power4.inOut" };
  to(`#${id}World`, { x: -k * D, ...m }, a);
  to(`#${id}c${k - 1}`, { rotationY: -34, z: -320, ...m }, a);
  to(`#${id}c${k}`, { rotationY: 0, z: 0, ...m }, a);
  to(`#${id}c${k - 1} .par`, { x: 70, ...m }, a);
  to(`#${id}c${k} .par`, { x: 0, ...m }, a);
  blurPulse(`#${id}Blur`, f, a + 0.08, V(beat), V(beat) + 0.2, "26 0");
  whoosh(V(beat), 0.45);
}

// ---------------------------------------------------------------- 1 · hook (beats 24–32: the bass enters and builds)
const fHook = photoRow("hk", ["elegance", "douceur", "nuit-du-gamou", "fete-vibrante"],
  ["Un mariage.", "Un baptême.", "Un Gamou.", `Une grande <em id="fete" class="gold">fête.</em>`]);
show("#hk", 0, V(32));
// Frame 0 is the thumbnail: the first card and its line are already there. The camera pushes in while it trucks.
to("#hkWorld", { z: 120, duration: V(31) - V(24), ease: "none" }, 0);
truck("hk", fHook, 1, 26);
truck("hk", fHook, 2, 28);
truck("hk", fHook, 3, 30);
// "fête." lands on the next beat (a hit: a 0 ms set, then the recoil).
set("#fete", { opacity: 0 }, 0);
set("#fete", { opacity: 1, scale: 1.25 }, V(31));
to("#fete", { scale: 1, duration: 0.3, ease: "power3.out" }, V(31));
sfx("hit", V(31), 0.4, "hit/impactSoft_heavy_000.wav");
// Zoom avant rapide into the party, then the zoom-through (push): exit grows 1 → 1.2 with an 18 px full-frame blur.
const ZT = V(32);
to("#hkWorld", { z: 520, duration: ZT - 0.2 - V(31), ease: "power2.in" }, V(31));
to("#hkZoom", { scale: 1.2, duration: 0.2, ease: "power3.in" }, ZT - 0.2);
to("#hkFade", { opacity: 0.15, duration: 0.2, ease: "none" }, ZT - 0.2);
set("#hkBlur", { filter: `url(#${fHook})` }, ZT - 0.2);
to(`#${fHook} feGaussianBlur`, { attr: { stdDeviation: "18 18" }, duration: 0.2, ease: "power3.in" }, ZT - 0.2);
whoosh(ZT, 0.55);

// ---------------------------------------------------------------- 2 · "Tout le monde doit savoir." (the drop lands on "savoir.")
// Enters growing (same Z sign), then the camera keeps dollying forward through template cards set in depth.
const fTy = blurFilter("fTy");
const SYL = ["Tout ", "le ", "mon", "de ", "doit"];
const TILES = LAND
  ? [["mocha-chic", 40, 40, -900], ["tabaski-korite", 1580, 30, -1300], ["maouloud", 1600, 660, -700], ["recueillement", 60, 700, -1100], ["faire-part-lumineux", 900, -200, -1700], ["douceur", 760, 920, -1500]]
  : [["mocha-chic", 40, 150, -900], ["tabaski-korite", 700, 120, -1300], ["maouloud", 720, 1300, -700], ["recueillement", 30, 1250, -1100], ["faire-part-lumineux", 380, -60, -1700], ["douceur", 400, 1620, -1500]];
html.push(`    <div id="ty" class="scene" style="opacity:0;visibility:hidden">
      <div id="tyZoom" class="fill"><div id="tyFade" class="fill"><div id="tyBlur" class="fill">
        <div id="tyTiles" class="fill persp"><div id="tyWorld" class="world">
${TILES.map(([f, x, y, z], i) => `          <div id="tile${i}" class="tile" style="left:${x}px;top:${y}px"><img src="${IMG}/photos-modeles/${f}.jpg"></div>`).join("\n")}
        </div></div>
        <div id="tyLine" class="type"><span class="l1">${SYL.map((s, i) => `<span id="sy${i}" class="sy">${s}</span>`).join("")}<span id="caret1" class="caret"></span></span><br><span id="sy5" class="sy l2 gold">savoir.</span></div>
      </div></div></div>
    </div>`);
show("#ty", ZT, V(36));
TILES.forEach(([, , , z], i) => set(`#tile${i}`, { z, rotationY: i % 2 ? -18 : 18 }, 0));
set("#tyZoom", { scale: 0.75 }, 0);
set("#tyFade", { opacity: 0.15 }, 0);
to("#tyZoom", { scale: 1, duration: 0.5, ease: "expo.out" }, ZT);
to("#tyFade", { opacity: 1, duration: 0.5, ease: "expo.out" }, ZT);
set("#tyBlur", { filter: `url(#${fTy})` }, 0);
set(`#${fTy} feGaussianBlur`, { attr: { stdDeviation: "18 18" } }, 0);
to(`#${fTy} feGaussianBlur`, { attr: { stdDeviation: "0 0" }, duration: 0.5, ease: "expo.out" }, ZT);
set("#tyBlur", { filter: "none" }, ZT + 0.5);
to("#tyWorld", { z: 900, duration: V(36) - 0.33 - ZT, ease: "none" }, ZT);
// A syllable per sixteenth note, the caret waits (0.4 s of stillness), and "savoir." lands on the drop.
SYL.forEach((_, i) => {
  set(`#sy${i}`, { display: "inline" }, V(32.25 + i * 0.25));
  sfx("click", V(32.25 + i * 0.25), 0.4, undefined, TICKS);
});
[33.5, 33.75].forEach((b, k) => set("#caret1", { opacity: k ? 1 : 0 }, V(b)));
set("#caret1", { opacity: 0 }, V(34));
set("#sy5", { display: "inline-block", scale: 1.14 }, V(34));
to("#sy5", { scale: 1, duration: 0.32, ease: "power3.out" }, V(34));
shake("#tyLine", V(34), 14);
sfx("hit", V(34), 0.5, "hit/impactSoft_heavy_001.wav");
// Out: the line peels LEFT word by word (waterfall cut), the cards stream past the same way.
const CUT_PB = V(36);
wordsOut(["#tyLine .l1", "#sy5"], CUT_PB);
to("#tyTiles", { x: -230, duration: 0.34, ease: "power4.in" }, CUT_PB - 0.34);
to("#tyTiles", { opacity: 0, duration: 0.3, ease: "power2.in" }, CUT_PB - 0.32);

// ---------------------------------------------------------------- 3 · the problem (beats 36–46, the groove)
// A wall of voice notes tilted in depth: each note arrives at the bottom and pushes the pile up, faster and faster
// until it overflows; the camera cranes round once while it fills. Two questions flip up; stillness; then the camera
// dives into the last bubble, whose emerald becomes the brand's world.
const SENDERS = ["Tante Awa", "Modou", "Groupe Famille", "Fatou", "Cousin Ibou", "Mame Diarra", "Oncle Pape", "Khady",
  "Voisine Coumba", "Groupe Famille", "Tante Awa", "Ousmane", "Aïssatou", "Groupe Famille", "Cheikh", "Ndeye", "Modou",
  "Groupe Famille", "Tante Awa"];
const NOTE = LAND ? 150 : 170;
let seed = 5;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const NB = (LAND ? 820 : 1230) + NOTE;
const notes = SENDERS.map((who, i) => {
  const bars = Array.from({ length: 30 }, () => `<i style="height:${Math.round(18 + rnd() * 52)}px"></i>`).join("");
  const dur = `${Math.floor(rnd() * 2)}:${String(Math.round(5 + rnd() * 54)).padStart(2, "0")}`;
  return `<div id="vb${i}" class="vb ${i % 3 === 2 ? "right" : "left"}" style="top:${NB + i * NOTE}px"><span class="who">${who}</span>` +
    `<div class="vbody"><span class="play"></span><span class="wave">${bars}</span><span class="dur">${dur}</span></div></div>`;
}).join("");
const fWall = blurFilter("fWall");
html.push(`    <div id="pb" class="scene" style="opacity:0;visibility:hidden">
      <div id="pBack" class="fill">
        <div id="wallBlur" class="fill" data-layout-ignore><div id="wall" class="fill persp"><div id="tilt"><div id="stack">${notes}</div></div></div></div>
        <div id="dim" class="fill"></div>
        <div class="pbhead"><p class="mid white">${words("47 messages vocaux…", "ph").replace('id="ph0" class="w"', 'id="ph0" class="w gold"')}</p></div>
        <div id="q1" class="qb"><span class="qt">« C'est où, déjà ? »</span></div>
      </div>
      <div id="q2" class="qb em"><span class="qt">« On mange à quelle heure ? »</span></div>
    </div>`);
show("#pb", CUT_PB, V(46));
wordsIn(ids("ph", "47 messages vocaux…"), CUT_PB);
set("#ph0", { textContent: "1" }, 0);
set("#tilt", { rotationX: 28, rotationY: -18, rotation: -4 }, 0);
to("#tilt", { rotationX: 10, rotationY: 16, rotation: 2, duration: V(44.5) - CUT_PB, ease: "none" }, CUT_PB);
const noteAt = (i) => (i < 4 ? V(36 + i * 0.5) : i < 12 ? V(38 + (i - 4) * 0.25) : V(41 + (i - 12) * 0.5));
SENDERS.forEach((_, i) => {
  const at = noteAt(i);
  set(`#vb${i}`, { opacity: 0, scale: 0.6, z: -600, rotationX: -35 }, 0);
  set(`#vb${i}`, { opacity: 1 }, at);
  to(`#vb${i}`, { scale: 1, z: 0, rotationX: 0, duration: 0.32, ease: "back.out(1.6)" }, at);
  const fast = i >= 4 && i < 12;
  to("#stack", { y: -(i + 1) * NOTE, duration: fast ? 0.12 : 0.2, ease: "power2.out" }, at);
  sfx("pop", at, fast ? 0.24 : i >= 12 ? 0.18 : 0.32, undefined, POPS);
});
countUp("#ph0", 1, 47, CUT_PB, V(40) - CUT_PB, IN2);
set("#ph0", { scale: 1.3 }, V(40));
to("#ph0", { scale: 1, duration: 0.3, ease: "power3.out" }, V(40));
sfx("pop", V(40), 0.5, "pop/maximize_002.wav");
// Rack focus to the questions: the pile defocuses (blur on its wrapper, the dimming on a layer of its own).
set("#dim", { opacity: 0 }, 0);
blurPulse("#wallBlur", fWall, V(41), V(41) + 0.3, V(46), "7 7");
to("#dim", { opacity: 0.5, duration: 0.3, ease: "power2.out" }, V(41));
for (const [q, beat, tilt] of [["#q1", 41, -2], ["#q2", 42, 2]]) {
  set(q, { autoAlpha: 0, rotationX: 80, y: 120, rotation: tilt * 2, transformPerspective: 1200, transformOrigin: "50% 100%" }, 0);
  set(q, { autoAlpha: 1 }, V(beat));
  to(q, { rotationX: 0, y: 0, rotation: tilt, duration: 0.5, ease: "back.out(1.5)" }, V(beat));
  sfx("pop", V(beat), 0.55, beat === 41 ? "pop/maximize_001.wav" : "pop/maximize_004.wav");
}
// Stillness (the last note settles at 11.6 s, 0.4 s before), then the dive: the emerald bubble grows past the frame on a strong ease-in.
const CUT_RV = V(46);
const DIVE = CUT_RV - 0.42;
to("#q2 .qt", { opacity: 0, duration: 0.12, ease: "power1.in" }, DIVE);
to("#q2", { scale: 10, rotation: 0, borderRadius: 0, duration: 0.42, ease: "power3.in" }, DIVE);
to("#pBack", { opacity: 0, duration: 0.3, ease: "power2.in" }, DIVE);
whoosh(CUT_RV, 0.6);

// ---------------------------------------------------------------- 4 · the reveal (beats 46–58)
// The logo's strokes draw, a beat of stillness, the gold dot lands on beat 48; then the camera cranes UP: the logo
// leaves the top as the line and the phone rise in.
const MARK = (stroke, hole, id) => `<svg class="mark" id="${id}" viewBox="0 0 52 52">
          <path class="s1" d="M14 10 38 42" stroke="${stroke}" /><path class="s2" d="M38 10 14 42" stroke="${stroke}" />
          <circle class="ring" cx="26" cy="26" r="6" fill="none" stroke="${C.gold}" stroke-width="1.2" />
          <circle class="hole" cx="26" cy="26" r="6" fill="${hole}" /><circle class="dot" cx="26" cy="26" r="3.6" fill="${C.gold}" />
        </svg>`;
html.push(`    <div id="rv" class="scene" style="opacity:0;visibility:hidden">
      <div id="rvIn" class="fill">
        <div id="logo1" class="logo">${MARK(C.white, C.em, "m1")}<div class="wmask"><p class="word white">XewXew</p></div></div>
      </div>
      <div id="rvText" class="head white"><p class="mid2">${words("Le site de votre *événement.", "rh")}</p><p id="rvSub" class="sub">Prêt en 10 minutes.</p></div>
    </div>`);
show("#rv", CUT_RV, V(58));
show("#gEm", CUT_RV, V(58) + 0.05);
set("#gDark", { autoAlpha: 0 }, CUT_RV);
set("#gEm .glow", { opacity: 0 }, 0);
to("#gEm .glow", { opacity: 1, duration: 0.8, ease: "power2.out" }, CUT_RV);
set("#rvIn", { scale: 0.88 }, 0);
to("#rvIn", { scale: 1, duration: 0.6, ease: "expo.out" }, CUT_RV);
set("#m1 .s1, #m1 .s2", { strokeDasharray: 40, strokeDashoffset: 40, opacity: 0 }, 0);
set("#m1 .s1", { opacity: 1 }, CUT_RV);
to("#m1 .s1", { strokeDashoffset: 0, duration: V(47) - CUT_RV, ease: "power2.inOut" }, CUT_RV);
set("#m1 .s2", { opacity: 1 }, V(47));
to("#m1 .s2", { strokeDashoffset: 0, duration: 0.28, ease: "power2.inOut" }, V(47));
set("#m1 .hole, #m1 .dot", { scale: 0, transformOrigin: "50% 50%" }, 0);
set("#m1 .hole, #m1 .dot", { scale: 1.3 }, V(48));
to("#m1 .hole, #m1 .dot", { scale: 1, duration: 0.3, ease: "power3.out" }, V(48));
set("#m1 .ring", { opacity: 0, scale: 1, transformOrigin: "50% 50%" }, 0);
set("#m1 .ring", { opacity: 1 }, V(48));
to("#m1 .ring", { scale: 7, opacity: 0, duration: 0.7, ease: "expo.out" }, V(48));
shake("#logo1", V(48), 10);
sfx("hit", V(48), 0.85, "hit/impactPunch_heavy_000.wav");
set("#logo1 .word", { yPercent: 110 }, 0);
to("#logo1 .word", { yPercent: 0, duration: 0.5, ease: "expo.out" }, V(49));
// The crane UP (cut-the-curve, upward: the reveal rises). The phone is already climbing when the cut lands.
const CUT_UP = V(51);
to("#logo1", { y: -230, duration: 0.33, ease: "power4.in" }, CUT_UP - 0.33);
to("#logo1", { opacity: 0, duration: 0.3, ease: "power2.in" }, CUT_UP - 0.32);
wordsIn(ids("rh", "Le site de votre *événement."), CUT_UP, "y");
lineIn("#rvSub", V(52.5));
whoosh(CUT_UP, 0.5);

// ---------------------------------------------------------------- the phone (beats 51–102): the product's stage
const screens = [];
const screen = (id, inner, cls = "") => screens.push(`          <div id="${id}" class="sc ${cls}" style="opacity:0;visibility:hidden"><div class="zm">${inner}</div></div>`);
const vid = (id, file, a, b, from, rate) =>
  `<video id="${id}" src="${VID}/${file}.mp4" data-start="${r3(a)}" data-duration="${r3(b - a)}" data-media-start="${from}" data-playback-rate="${rate}" data-track-index="${track++}" muted playsinline></video>`;
const still = (file) => `<img src="${IMG}/ecrans/${file}.png">`;
/** Screen change inside the phone: cut-the-curve LEFT over 12 % of the screen, the next screen mid-flight. */
function swap(outSel, inSel, cut) {
  const d = Math.round(SW * 0.12);
  if (outSel) {
    to(outSel, { x: -d, duration: 0.3, ease: "power4.in" }, cut - 0.3);
    to(outSel, { opacity: 0, duration: 0.24, ease: "power2.in" }, cut - 0.26);
    set(outSel, { autoAlpha: 0 }, cut);
  }
  set(inSel, { x: d }, 0);
  set(inSel, { autoAlpha: 0.35 }, cut);
  to(inSel, { x: 0, opacity: 1, duration: 0.3, ease: "power4.out" }, cut);
}

const PH_IN = CUT_UP - 0.25;
const [GUEST_SCREENS, PILLS] = [["06b-site-compte-a-rebours", "06c-site-programme", "06d-site-lieux-itineraire", "06f-site-tenue", "06e-site-galerie", "06g-site-livre-or"],
  ["Compte à rebours", "Programme", "Itinéraire", "Tenue du jour", "Galerie photo", "Livre d'or"]];
screen("scV01", vid("v01", "v01-site-ouverture-et-defilement", PH_IN, V(58) + 0.05, 0.9, 1.25));
screen("scV03", vid("v03", "v03-galerie-modeles", V(58) - 0.3, V(64) + 0.05, 4.6, 1.6));
screen("scV04", vid("v04", "v04-assistant-creation", V(64) - 0.3, V(68.5) + 0.05, 6.6, 1.25));
screen("sc04", still("04-editeur-photos"));
screen("sc05", still("05-publier-partager") + `<span class="press"></span>`, "z05");
screen("sc06a", still("06a-site-accueil"));
GUEST_SCREENS.forEach((f, k) => screen(`scG${k}`, still(f)));
screen("scV05", vid("v05", "v05-invite-repond", V(86) - 0.3, V(90) + 0.05, 3.2, 2.6));
screen("sc08", still("08a-reponses-totaux"));
screen("scV06", vid("v06", "v06-reponses-organisateur", V(91.5) - 0.2, V(94) + 0.05, 0.6, 1.4));
screen("scV02", vid("v02", "v02-accueil-defilement", V(94) - 0.3, V(98) + 0.05, 1, 2));
screen("sc01", still("01-accueil"));

// Apple-style arrival: the phone rises turning, lands flat facing us; a sheen crosses the glass as it turns.
show("#phwrap", PH_IN, V(103));
set("#ph", { y: LAND ? 1300 : 1500, rotationX: 24, rotationY: -20, z: -300 }, 0);
to("#ph", { y: 0, rotationX: 0, rotationY: 0, z: 0, duration: 1.1, ease: "expo.out" }, PH_IN);
set("#ph .sheen i", { xPercent: -260 }, 0);
to("#ph .sheen i", { xPercent: 260, duration: 1.0, ease: "power2.inOut" }, PH_IN + 0.05);
show("#scV01", PH_IN, V(58));

// ---------------------------------------------------------------- 5 · how it works (beats 58–79, the breakdown)
// The ground floods to cream while the phone stays. The step number rolls like a slot machine; headings swap by
// waterfall cut, screens by cut-the-curve, both LEFT.
const STEPS = [[58, "Choisissez un *modèle"], [64, "Ajoutez vos infos *et *vos *photos"], [71, "Partagez le lien *sur *WhatsApp"]];
html.push(`    <div id="st" class="scene" style="opacity:0;visibility:hidden">
      <div id="badge" class="badge"><div class="roll" data-layout-ignore><span>1</span><span>2</span><span>3</span></div></div>
${STEPS.map(([, s], k) => `      <div id="h${k + 1}" class="head steph"><p class="mid2">${words(s, `s${k + 1}w`)}</p></div>`).join("\n")}
    </div>`);
const FLOOD = 0.4;
/** Colour flood: the whole ground changes in 0.4 s (power2.inOut) and lands on the cut. */
function flood(toCream, cut) {
  if (toCream) {
    set("#gCream", { autoAlpha: 0 }, cut - FLOOD - 0.01);
    set("#gCream", { visibility: "visible" }, cut - FLOOD);
    to("#gCream", { opacity: 1, duration: FLOOD, ease: "power2.inOut" }, cut - FLOOD);
  } else {
    show("#gEm", cut - FLOOD);
    to("#gCream", { opacity: 0, duration: FLOOD, ease: "power2.inOut" }, cut - FLOOD);
    set("#gCream", { autoAlpha: 0 }, cut);
  }
}
const CUT_ST = V(58);
flood(true, CUT_ST);
wordsOut([...ids("rh", "Le site de votre *événement."), "#rvSub"], CUT_ST);
show("#st", CUT_ST, V(79.5));
wordsIn(["#badge", ...ids("s1w", STEPS[0][1])], CUT_ST);
swap("#scV01", "#scV03", CUT_ST);
whoosh(CUT_ST, 0.5);
for (let k = 1; k < 3; k++) {
  const cut = V(STEPS[k][0]);
  wordsOut(ids(`s${k}w`, STEPS[k - 1][1]), cut);
  wordsIn(ids(`s${k + 1}w`, STEPS[k][1]), cut);
  to("#badge .roll", { yPercent: (-100 * k) / 3, duration: 0.3, ease: "power4.out" }, cut);
  whoosh(cut, 0.42);
}

// --- the oversized cursor (one look for the film: black body, white stroke) ----------------------------------------
const CUR = LAND ? 96 : 104;
html.push(`    <div id="cur"><svg viewBox="0 0 24 24"><path d="M5.2 3.4V20l4.2-4 2.8 6.2 2.8-1.2-2.8-6.1h6z" fill="#1c1c1c" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg></div>`);
/** Cursor transform that puts its tip (21.7 %, 14.2 % of the box) on a frame point. */
const tip = ([x, y]) => ({ x: r3(x - 0.217 * CUR), y: r3(y - 0.142 * CUR) });
set("#cur", { ...tip([W * 0.55, H * 1.18]), transformOrigin: "21.7% 14.2%" }, 0);
function cursorEnter(target, arrive, dur = 0.8) {
  const [x] = target;
  set("#cur", tip([x + (LAND ? 60 : 40), H * 1.16]), arrive - dur - 0.001);
  to("#cur", { ...tip(target), duration: dur, ease: "power3.out" }, arrive - dur);
}
function cursorTap(at) {
  to("#cur", { scale: 0.84, duration: 0.1, ease: "power2.in" }, at - 0.1);
  to("#cur", { scale: 1, duration: 0.22, ease: "power2.out" }, at);
  sfx("click", at, 0.7, "click/click_005.wav");
}
const cursorMove = (target, at, dur, ease = "power2.out") => to("#cur", { ...tip(target), duration: dur, ease }, at);

// Step 2: the cursor taps the title field and the typing starts on that frame (v04 types from 7.4 s of its source).
const TAP_TITLE = r3(V(64) - 0.3 + (7.35 - 6.6) / 1.25);
const FIELD = onScreen(0.5, 0.354);
swap("#scV03", "#scV04", V(64));
cursorEnter(FIELD, TAP_TITLE - 0.1, 0.75);
cursorTap(TAP_TITLE);
cursorMove(onScreen(0.93, 0.62, 60), TAP_TITLE + 0.35, 0.7);
for (let k = 0; k < 14; k++) sfx("click", TAP_TITLE + 0.05 + k * 0.12, 0.22, undefined, TICKS);
cursorMove([W + 160, onScreen(0, 0.7)[1]], V(68.1), 0.55, "power2.in");
// Then the editor: its page scrolls up to the photos (nudge curve: ramp, burst, long tail).
swap("#scV04", "#sc04", V(68.5));
const sc = (y, at, dur, ease) => to("#sc04 .zm", { yPercent: y, duration: dur, ease }, at);
sc(-1.2, V(69.5), 0.12, "power3.in");
sc(-8.6, V(69.5) + 0.12, 0.1, "none");
sc(-12, V(69.5) + 0.22, 0.38, "power4.out");

// Step 3: the camera punches in on "Partager sur WhatsApp" inside the screen; the click turns the button into the
// link preview a guest receives, whose address types itself.
const SHARE = [0.376, 0.483];
swap("#sc04", "#sc05", V(71));
to("#sc05 .zm", { scale: 1.6, duration: 0.55, ease: "power2.inOut" }, V(71.5));
const SHARE_PT = onScreen(...SHARE);
const TAP_SHARE = V(72.5);
cursorEnter(SHARE_PT, TAP_SHARE - 0.12, 0.8);
cursorTap(TAP_SHARE);
set("#sc05 .press", { opacity: 0 }, 0);
to("#sc05 .press", { opacity: 0.32, duration: 0.08, ease: "power2.out" }, TAP_SHARE);
to("#sc05 .press", { opacity: 0, duration: 0.3, ease: "power2.out" }, TAP_SHARE + 0.12);

const LINK = "awa-et-moussa.xewxew.click";
const BUB = LAND ? { x: 1000, y: 470, w: 820 } : { x: 90, y: 560, w: 900 };
const BIMG = Math.round((BUB.w * 630) / 1200);
html.push(`    <div id="bub" class="bubble" style="left:${BUB.x}px;top:${BUB.y}px;width:${BUB.w}px"><div class="bshell">
      <div class="bin"><img src="${IMG}/ecrans/09-apercu-du-lien-whatsapp.png" style="height:${BIMG}px">
        <div class="bmeta"><b>Awa &amp; Moussa</b><span class="burl">${[...LINK].map((c, i) => `<span id="u${i}" class="uc${i >= 13 ? " dom" : ""}">${c}</span>`).join("")}<span id="caret2" class="caret"></span></span></div></div>
    </div></div>`);
// Morph: the bubble starts as the pressed button (its rect after the punch-in) and widens into the card.
const bubH = BIMG + 150;
const bubCx = BUB.x + BUB.w / 2, bubCy = BUB.y + bubH / 2;
set("#bub", { autoAlpha: 0, x: SHARE_PT[0] - bubCx, y: SHARE_PT[1] - bubCy, scaleX: (0.27 * SW * 1.6) / BUB.w, scaleY: 0.1, transformOrigin: "50% 50%" }, 0);
set("#bub .bin", { opacity: 0 }, 0);
set("#bub", { autoAlpha: 1 }, TAP_SHARE);
to("#bub", { x: 0, y: 0, scaleX: 1, scaleY: 1, duration: 0.42, ease: "power3.out" }, TAP_SHARE);
to("#bub .bin", { opacity: 1, duration: 0.2, ease: "power1.out" }, TAP_SHARE + 0.16);
sfx("pop", TAP_SHARE + 0.05, 0.5, "pop/maximize_003.wav");
cursorMove(LAND ? [1830, 1000] : onScreen(0.95, 0.78, 70), TAP_SHARE + 0.3, 0.7);
// Realistic typing: seeded intervals, a longer breath after each separator.
let seedT = 11;
const rndT = () => (seedT = (seedT * 1103515245 + 12345) % 2147483648) / 2147483648;
let tt = TAP_SHARE + 0.45;
[...LINK].forEach((c, i) => {
  set(`#u${i}`, { display: "inline" }, tt);
  if (i % 2 === 0) sfx("click", tt, 0.2, undefined, TICKS);
  tt += 0.045 + rndT() * 0.03 + (c === "-" || c === "." ? 0.04 : 0);
});
for (let k = 0; k < 6; k++) set("#caret2", { opacity: k % 2 ? 1 : 0 }, r3(tt + 0.25 + k * 0.28));
// The guest opens the link: tap on the card, which is carried into the phone and becomes the guest's site.
const LINK_PT = [bubCx, BUB.y + BIMG + 102];
const TAP_LINK = V(77.5);
cursorMove(LINK_PT, TAP_LINK - 0.72, 0.6, "power2.inOut");
cursorTap(TAP_LINK);
cursorMove([LINK_PT[0] + 40, H * 1.16], TAP_LINK + 0.3, 0.55, "power2.in");
const fBub = blurFilter("fBub");
const [scrCx, scrCy] = onScreen(0.5, 0.4);
to("#bub", { x: scrCx - bubCx, y: scrCy - bubCy, scale: 0.42, duration: 0.6, ease: "power2.inOut" }, TAP_LINK + 0.05);
blurPulse("#bub", fBub, TAP_LINK + 0.05, TAP_LINK + 0.35, TAP_LINK + 0.65, "6 6");
to("#bub .bshell", { opacity: 0, duration: 0.18, ease: "power1.in" }, TAP_LINK + 0.5);
set("#bub", { autoAlpha: 0 }, TAP_LINK + 0.7);
whoosh(TAP_LINK + 0.35, 0.45);
set("#sc06a", { autoAlpha: 0 }, 0);
show("#sc06a", TAP_LINK + 0.5);
set("#sc06a", { opacity: 0 }, TAP_LINK + 0.5);
to("#sc06a", { opacity: 1, duration: 0.2, ease: "power1.out" }, TAP_LINK + 0.5);
set("#sc05", { autoAlpha: 0 }, TAP_LINK + 0.7);
// The steps leave (the next content is the pills).
wordsOut(["#badge", ...ids("s3w", STEPS[2][1])], V(79.5));

// ---------------------------------------------------------------- 6 · what guests get (beats 79–94)
// The phone slides right to make room (nudge curve); each section's page scrolls into the screen on its beat while its
// label pops out of the phone towards the left (the current), stacking into a list.
const NUDGE = LAND ? 0 : 170;
function nudge(sel, prop, from, toV, at) {
  const d = toV - from;
  to(sel, { [prop]: from + d * 0.11, duration: 0.12, ease: "power3.in" }, at);
  to(sel, { [prop]: from + d * 0.78, duration: 0.1, ease: "none" }, at + 0.12);
  to(sel, { [prop]: toV, duration: 0.35, ease: "power4.out" }, at + 0.22);
}
if (NUDGE) nudge("#phMove", "x", 0, NUDGE, V(78.75));
const pillPos = (k) => (LAND ? { x: 1000 + (k % 2) * 490, y: 520 + Math.floor(k / 2) * 125 } : { x: 46, y: 590 + k * 118 });
html.push(`    <div id="pills" class="layer">${PILLS.map((p, k) => `<span id="pl${k}" class="pill" style="left:${pillPos(k).x}px;top:${pillPos(k).y}px">${p}</span>`).join("")}</div>`);
show("#pills", V(80) - 0.01, V(90) + 0.05);
PILLS.forEach((_, k) => {
  const at = V(80 + k);
  // 9:16: out of the phone, leftwards. 16:9: the column is right of the phone, so the label comes in from the right.
  const [sx] = onScreen(0.5, 0, NUDGE);
  set(`#pl${k}`, { opacity: 0, x: LAND ? 260 : sx - pillPos(k).x - 120, scale: 0.6 }, 0);
  set(`#pl${k}`, { opacity: 1 }, at);
  to(`#pl${k}`, { x: 0, scale: 1, duration: 0.34, ease: "power4.out" }, at);
  // The page arrives the way a scroll brings it.
  const prev = k ? `#scG${k - 1}` : "#sc06a";
  set(`#scG${k}`, { yPercent: 100 }, 0);
  set(`#scG${k}`, { autoAlpha: 1 }, at);
  to(`#scG${k}`, { yPercent: 0, duration: 0.3, ease: "power3.out" }, at);
  set(prev, { autoAlpha: 0 }, at + 0.3);
  sfx("pop", at, 0.45, ["pop/pluck_001.wav", "pop/pluck_002.wav", "pop/drop_004.wav"][k % 3]);
});

// "Ils répondent en un clic." — the pills peel LEFT, the phone slides back LEFT with them, a guest answers.
const GH = [[86, "Ils répondent *en *un *clic.", "Sans créer de compte."], [90, "Vous savez *qui *vient.", ""], [94, "Pensé pour le *téléphone.", ""], [98, "Gratuit pour *commencer.", "Wave ou Orange Money pour aller plus loin."]];
html.push(`    <div id="gh" class="scene" style="opacity:0;visibility:hidden">
${GH.map(([, s, sub], k) => `      <div id="g${k}" class="head${k === 2 ? " white" : ""}"><p class="mid2">${words(s, `g${k}w`)}</p>${sub ? `<p id="g${k}sub" class="sub">${sub}</p>` : ""}</div>`).join("\n")}
      <div id="stats"><div id="stA" class="stat"><b id="nA">8</b><span>présents</span></div><div id="stB" class="stat"><b id="nB">17</b><span>places confirmées</span></div></div>
      <div id="chips"><span id="ch1" class="chip">Même en 3G.</span><span id="ch2" class="chip">Rien à installer.</span></div>
    </div>`);
const CUT_G = V(86);
show("#gh", CUT_G, V(103));
wordsIn(ids("g0w", GH[0][1]), CUT_G);
lineIn("#g0sub", V(87));
set("#scV05", { autoAlpha: 0 }, 0);
swap(`#scG5`, "#scV05", CUT_G);
whoosh(CUT_G, 0.45);

// "Vous savez qui vient." — the organiser's totals; Fatou's answer (2 people) ticks them from 8 / 17 to 9 / 19.
const CUT_T = V(90);
wordsOut([...PILLS.map((_, k) => `#pl${k}`), ...ids("g0w", GH[0][1]), "#g0sub"], CUT_T);
if (NUDGE) nudge("#phMove", "x", NUDGE, 0, CUT_T - 0.22);
wordsIn(ids("g1w", GH[1][1]), CUT_T);
swap("#scV05", "#sc08", CUT_T);
whoosh(CUT_T, 0.45);
wordsArrive(["#stA"], V(90.5), [0]);
wordsArrive(["#stB"], V(91), [0]);
sfx("pop", V(90.5), 0.45, "pop/maximize_001.wav");
sfx("pop", V(91), 0.45, "pop/maximize_004.wav");
// The same surface changes state: a rack-focus blur-cut on the screen (the one cut meant to be seen).
const TICK = V(91.75);
const fScr = blurFilter("fScr");
blurPulse("#screenFocus", fScr, TICK - 0.3, TICK, TICK + 0.35, "10 10");
set("#scV06", { autoAlpha: 0 }, 0);
set("#sc08", { autoAlpha: 0 }, TICK);
set("#scV06", { autoAlpha: 1 }, TICK);
set("#nA", { textContent: "9", scale: 1.25 }, TICK);
to("#nA", { scale: 1, duration: 0.3, ease: "power3.out" }, TICK);
set("#nB", { textContent: "18", scale: 1.25 }, TICK);
set("#nB", { textContent: "19" }, TICK + 0.12);
to("#nB", { scale: 1, duration: 0.3, ease: "power3.out" }, TICK + 0.12);
sfx("pop", TICK, 0.5, "pop/maximize_002.wav");

// "Pensé pour le téléphone." — the ground floods emerald; the phone turns once on its axis (one move, one way).
const CUT_A = V(94);
flood(false, CUT_A);
wordsOut([...ids("g1w", GH[1][1]), "#stA", "#stB"], CUT_A);
wordsIn(ids("g2w", GH[2][1]), CUT_A);
swap("#scV06", "#scV02", CUT_A);
to("#ph", { rotationY: -16, rotationX: 4, duration: 0.5, ease: "power2.inOut" }, CUT_A - 0.2);
to("#ph", { rotationY: 6, rotationX: 2, duration: V(98) - 0.3 - CUT_A - 0.3, ease: "none" }, CUT_A + 0.3);
set("#ph .sheen i", { xPercent: -260 }, CUT_A - 0.21);
to("#ph .sheen i", { xPercent: 260, duration: 1.2, ease: "power2.inOut" }, CUT_A);
whoosh(CUT_A, 0.45);
for (const [chip, b] of [["#ch1", 95], ["#ch2", 96]]) {
  set(chip, { opacity: 0, scale: 0.6 }, 0);
  set(chip, { opacity: 1 }, V(b));
  to(chip, { scale: 1, duration: 0.3, ease: "back.out(1.6)" }, V(b));
  sfx("pop", V(b), 0.45, b === 95 ? "pop/maximize_001.wav" : "pop/maximize_004.wav");
}

// "Gratuit pour commencer." — back to cream, the phone faces us again on the cut, the home page in its screen.
const CUT_F = V(98);
flood(true, CUT_F);
set("#gEm", { autoAlpha: 0 }, CUT_F + 0.01);
wordsOut([...ids("g2w", GH[2][1]), "#ch1", "#ch2"], CUT_F);
wordsIn(ids("g3w", GH[3][1]), CUT_F);
lineIn("#g3sub", V(99));
to("#ph", { rotationY: 0, rotationX: 0, duration: 0.3, ease: "power4.out" }, CUT_F);
swap("#scV02", "#sc01", CUT_F);
whoosh(CUT_F, 0.45);

// ---------------------------------------------------------------- 7 · the ending (beats 103–108): it rhymes with the opening
// The phone and the line ride LEFT out of frame; the photo row (three photos, README) comes in mid-flight and trucks
// one card per beat behind a line that stays dead still; "son site." lands on the bass hit (beat 106).
const CUT_E = V(103);
to("#phMove", { x: -230, duration: 0.34, ease: "power4.in" }, CUT_E - 0.34);
to("#phwrap", { opacity: 0, duration: 0.3, ease: "power2.in" }, CUT_E - 0.32);
wordsOut([...ids("g3w", GH[3][1]), "#g3sub"], CUT_E);
set("#gCream", { autoAlpha: 0 }, CUT_E);
show("#gDark", CUT_E);
const fEnd = photoRow("en", ["mocha-chic", "tabaski-korite", "maouloud"]);
html.push(`    <div id="ecap" class="scene" style="opacity:0;visibility:hidden"><div id="ecapIn" class="fill">
      <div class="eshade"></div>
      <p class="ecap">${words("Votre événement mérite", "ec")} <span id="ecss" class="w acc gold">son site.</span></p>
    </div></div>`);
show("#en", CUT_E, V(108));
show("#ecap", CUT_E, V(108));
set("#enIn", { x: 230 }, 0);
set("#enFade", { opacity: 0.35 }, 0);
to("#enIn", { x: 0, duration: 0.34, ease: "power4.out" }, CUT_E);
to("#enFade", { opacity: 1, duration: 0.34, ease: "power4.out" }, CUT_E);
whoosh(CUT_E, 0.5);
truck("en", fEnd, 1, 104);
truck("en", fEnd, 2, 105);
to("#enWorld", { z: 110, duration: V(107.6) - V(105) - 0.3, ease: "none" }, V(105) + 0.3);
wordsArrive(ids("ec", "Votre événement mérite"), V(103.5), [1]);
set("#ecss", { opacity: 0 }, 0);
set("#ecss", { opacity: 1, scale: 1.18 }, V(106));
to("#ecss", { scale: 1, duration: 0.28, ease: "power3.out" }, V(106));
shake("#ecapIn", V(106), 12);
sfx("hit", V(106), 0.8, "hit/impactPunch_heavy_002.wav");
// The inverse zoom-through (pull back): the montage recedes, the end card arrives oversized and retracts.
const CUT_FIN = V(108);
for (const z of ["#enZoom", "#ecapIn"]) to(z, { scale: 0.8, duration: 0.2, ease: "power3.in" }, CUT_FIN - 0.2);
to("#enFade", { opacity: 0.15, duration: 0.2, ease: "none" }, CUT_FIN - 0.2);
to("#ecap", { opacity: 0.15, duration: 0.2, ease: "none" }, CUT_FIN - 0.2);
set("#enBlur", { filter: `url(#${fEnd})` }, CUT_FIN - 0.2);
to(`#${fEnd} feGaussianBlur`, { attr: { stdDeviation: "18 18" }, duration: 0.2, ease: "power3.in" }, CUT_FIN - 0.2);

// ---------------------------------------------------------------- 8 · the end card (the music stops dead on it)
const fFin = blurFilter("fFin");
html.push(`    <div id="fin" class="scene cream" style="opacity:0;visibility:hidden"><div class="blob b1"></div><div class="blob b2"></div>
      <div id="finZoom" class="fill"><div id="finFade" class="fill"><div id="finBlur" class="fill">
        <div id="logo2" class="logo">${MARK(C.em, C.bg, "m2")}<div class="wmask"><p class="word em">XewXew</p></div></div>
        <p id="endurl" class="endurl">xewxew.click</p>
        <div id="cta" class="cta"><span>Créer mon site gratuitement</span><i class="shine"></i></div>
        <p class="legal">Offre gratuite : un site en ligne à la fois par compte, avec le badge « Fait avec XewXew ».</p>
      </div></div></div>
    </div>`);
show("#fin", CUT_FIN);
set("#gDark", { autoAlpha: 0 }, CUT_FIN + 0.6);
set("#finZoom", { scale: 1.25 }, 0);
set("#finFade", { opacity: 0.15 }, 0);
to("#finZoom", { scale: 1, duration: 0.5, ease: "expo.out" }, CUT_FIN);
to("#finFade", { opacity: 1, duration: 0.5, ease: "expo.out" }, CUT_FIN);
set("#finBlur", { filter: `url(#${fFin})` }, 0);
set(`#${fFin} feGaussianBlur`, { attr: { stdDeviation: "18 18" } }, 0);
to(`#${fFin} feGaussianBlur`, { attr: { stdDeviation: "0 0" }, duration: 0.5, ease: "expo.out" }, CUT_FIN);
set("#finBlur", { filter: "none" }, CUT_FIN + 0.5);
sfx("hit", CUT_FIN, 0.75, "hit/impactSoft_heavy_002.wav");
// Staged after the retraction settles: the dot lands, the wordmark wipes in, the address, the button.
set("#m2 .hole, #m2 .dot", { scale: 0, transformOrigin: "50% 50%" }, 0);
set("#m2 .hole, #m2 .dot", { scale: 1.3 }, V(108.75));
to("#m2 .hole, #m2 .dot", { scale: 1, duration: 0.3, ease: "power3.out" }, V(108.75));
set("#m2 .ring", { opacity: 0, scale: 1, transformOrigin: "50% 50%" }, 0);
set("#m2 .ring", { opacity: 1 }, V(108.75));
to("#m2 .ring", { scale: 7, opacity: 0, duration: 0.8, ease: "expo.out" }, V(108.75));
sfx("pop", V(108.75), 0.5, "pop/drop_004.wav");
set("#logo2 .word", { yPercent: 110 }, 0);
to("#logo2 .word", { yPercent: 0, duration: 0.5, ease: "expo.out" }, V(109.1));
lineIn("#endurl", V(109.6));
set("#cta", { opacity: 0, scale: 0.6 }, 0);
set("#cta", { opacity: 1 }, V(110.1));
to("#cta", { scale: 1, duration: 0.36, ease: "back.out(1.5)" }, V(110.1));
sfx("pop", V(110.1), 0.5, "pop/maximize_002.wav");
// The cursor comes up and presses the button: the press and the sheen start on the click's frame.
const CTA_PT = LAND ? [960, 832] : [540, 1105];
const TAP_CTA = V(111.2);
cursorEnter(CTA_PT, TAP_CTA - 0.12, 0.8);
cursorTap(TAP_CTA);
to("#cta", { scale: 0.95, duration: 0.1, ease: "power2.in" }, TAP_CTA - 0.1);
to("#cta", { scale: 1, duration: 0.22, ease: "power2.out" }, TAP_CTA);
set("#cta .shine", { xPercent: -160 }, 0);
to("#cta .shine", { xPercent: 260, duration: 0.7, ease: "power2.inOut" }, TAP_CTA);
cursorMove([CTA_PT[0] + 60, H * 1.16], TAP_CTA + 0.4, 0.55, "power2.in");

// ---------------------------------------------------------------- music: one take, cut dead on the end card
const music = `      <audio id="mu1" src="assets/music/wawawa.mp3" data-timeline-role="music" data-start="0" data-duration="${CUT_FIN}" data-media-start="${MEDIA0}" data-track-index="20" data-volume="0.9" data-fade-out="0.03"></audio>`;

// ---------------------------------------------------------------- page
const css = `
      @font-face { font-family: "Fraunces"; src: url("assets/fonts/Fraunces.ttf"); font-weight: 100 900; font-style: normal; }
      @font-face { font-family: "Fraunces"; src: url("assets/fonts/Fraunces-Italic.ttf"); font-weight: 100 900; font-style: italic; }
      @font-face { font-family: "Geist"; src: url("assets/fonts/Geist.ttf"); font-weight: 100 900; }
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: ${W}px; height: ${H}px; overflow: hidden; background: ${C.ink}; }
      #root { position: relative; width: ${W}px; height: ${H}px; overflow: hidden; background: ${C.ink}; font-family: "Geist", sans-serif; color: ${C.ink}; }
      .ground, .scene, .layer, .fill { position: absolute; inset: 0; }
      .scene { overflow: hidden; }
      .persp { perspective: 1800px; }
      .world { position: absolute; inset: 0; transform-style: preserve-3d; }
      #gDark { background: radial-gradient(circle at 50% 42%, #2c2622, #110e0c 74%); }
      #gEm { background: ${C.em}; }
      #gEm .glow { position: absolute; inset: 0; background: radial-gradient(circle at 50% 40%, #16795f 0%, rgba(15,92,74,0) 62%); }
      #gCream, .cream { background: ${C.bg}; }
      .blob { position: absolute; border-radius: 50%; opacity: 0.55; }
      .b1 { width: 900px; height: 900px; left: -320px; top: -260px; background: radial-gradient(circle, rgba(15,92,74,0.16), rgba(15,92,74,0) 70%); }
      .b2 { width: 1000px; height: 1000px; right: -380px; bottom: -300px; background: radial-gradient(circle, rgba(201,163,78,0.22), rgba(201,163,78,0) 70%); }
      em { font-family: "Fraunces", serif; font-style: italic; }
      .gold { color: ${C.gold}; } .white { color: ${C.white}; }
      .w { display: inline-block; }
      .acc { font-family: "Fraunces", serif; font-style: italic; color: ${C.em}; }
      .white .acc, .acc.gold { color: ${C.gold}; }
      /* photo row */
      .pcard { position: absolute; top: ${LAND ? 90 : 170}px; width: ${LAND ? 720 : 860}px; height: ${LAND ? 900 : 1075}px; margin-left: ${LAND ? 600 : 110}px; transform-style: preserve-3d; }
      .pframe { position: absolute; inset: 0; border-radius: 48px; overflow: hidden; box-shadow: 0 70px 150px rgba(0,0,0,0.65), 0 0 0 2px rgba(255,255,255,0.06); }
      .par { position: absolute; inset: 0 -90px; }
      .par img { width: 100%; height: 100%; object-fit: cover; object-position: 50% 30%; }
      .shade { position: absolute; inset: 0; background: linear-gradient(to top, rgba(17,14,12,0.86) 0%, rgba(17,14,12,0.3) 38%, rgba(17,14,12,0) 60%); }
      .pcap { position: absolute; left: 40px; right: 40px; bottom: 70px; text-align: center; font-family: "Fraunces", serif; font-size: ${LAND ? 104 : 124}px; line-height: 1.02;
        letter-spacing: -0.02em; color: ${C.white}; text-shadow: 0 1px 0 #ebe6dc, 0 2px 0 #ddd7cb, 0 3px 0 #cfc8bb, 0 4px 0 #c0b8aa, 0 5px 0 #b0a899, 0 6px 0 #a09888, 0 22px 44px rgba(0,0,0,0.5); }
      .pcap em { display: inline-block; text-shadow: 0 1px 0 #b8913f, 0 2px 0 #a9843a, 0 3px 0 #997734, 0 4px 0 #8a6a2e, 0 5px 0 #7b5e28, 0 6px 0 #6c5221, 0 22px 44px rgba(0,0,0,0.5); }
      /* typed line */
      .tile { position: absolute; width: 300px; height: 375px; border-radius: 22px; overflow: hidden; box-shadow: 0 30px 60px rgba(0,0,0,0.5); }
      .tile img { width: 100%; height: 100%; object-fit: cover; }
      .type { position: absolute; left: ${LAND ? 330 : 100}px; right: 60px; top: ${LAND ? 330 : 720}px; text-align: left; font-family: "Fraunces", serif; font-size: ${LAND ? 124 : 104}px;
        line-height: 1.06; letter-spacing: -0.015em; color: ${C.white}; text-shadow: 0 1px 0 #d9d3c8, 0 2px 0 #b9b2a6, 0 3px 0 #9a9387, 0 16px 34px rgba(0,0,0,0.45); }
      .type .l1 { display: inline-block; }
      .sy { display: none; }
      .type .l2 { font-style: italic; font-size: ${LAND ? 190 : 176}px; line-height: 1.1; transform-origin: 0% 60%;
        text-shadow: 0 1px 0 #b8913f, 0 2px 0 #997734, 0 3px 0 #7b5e28, 0 4px 0 #6c5221, 0 18px 40px rgba(0,0,0,0.5); }
      .caret { display: inline-block; width: 10px; height: 0.8em; margin-left: 10px; background: ${C.gold}; vertical-align: -0.06em; }
      /* problem */
      .mid { font-family: "Fraunces", serif; font-size: ${LAND ? 104 : 96}px; line-height: 1.05; letter-spacing: -0.015em; }
      .pbhead { position: absolute; left: 0; right: 0; top: 0; height: ${LAND ? 300 : 430}px; padding: ${LAND ? 80 : 190}px 70px 0; text-align: center;
        background: linear-gradient(#17130f 68%, rgba(23,19,15,0)); }
      #ph0 { font-variant-numeric: tabular-nums; transform-origin: 50% 70%; }
      #dim { background: #110e0c; }
      #tilt { position: absolute; inset: 0; transform-style: preserve-3d; transform-origin: 50% 60%; }
      #stack { position: absolute; inset: 0; transform-style: preserve-3d; }
      .vb { position: absolute; width: 640px; }
      .vb.left { left: ${LAND ? 560 : 70}px; } .vb.right { right: ${LAND ? 560 : 70}px; }
      .vb .who { display: block; font-size: 28px; font-weight: 600; color: ${C.gold}; margin: 0 0 8px 24px; }
      .vbody { display: flex; align-items: center; gap: 20px; height: 110px; padding: 0 30px; border-radius: 40px 40px 40px 12px; background: #2E2925;
        box-shadow: 0 7px 0 #141110, 0 24px 44px rgba(0,0,0,0.5); }
      .vb.right .vbody { background: ${C.em}; border-radius: 40px 40px 12px 40px; box-shadow: 0 7px 0 #093a2e, 0 24px 44px rgba(0,0,0,0.5); }
      .play { width: 0; height: 0; border-left: 30px solid ${C.white}; border-top: 18px solid transparent; border-bottom: 18px solid transparent; }
      .wave { display: flex; align-items: center; gap: 6px; flex: 1; }
      .wave i { display: block; width: 8px; border-radius: 4px; background: rgba(255,255,255,0.75); }
      .dur { font-size: 28px; color: rgba(255,255,255,0.7); font-variant-numeric: tabular-nums; }
      .qb { position: absolute; left: ${LAND ? 420 : 80}px; right: ${LAND ? 420 : 80}px; padding: 48px 54px; border-radius: 56px 56px 56px 16px; background: ${C.white};
        color: ${C.ink}; font-family: "Fraunces", serif; font-size: ${LAND ? 78 : 82}px; line-height: 1.08; text-align: center;
        box-shadow: 0 1px 0 #e6e0d6, 0 2px 0 #dad3c7, 0 3px 0 #cec6b8, 0 4px 0 #c2b9aa, 0 5px 0 #b6ad9d, 0 6px 0 #aaa190, 0 40px 90px rgba(0,0,0,0.45); }
      .qb.em { background: ${C.em}; color: ${C.white}; font-style: italic; border-radius: 56px 56px 16px 56px;
        box-shadow: 0 1px 0 #0c5040, 0 2px 0 #0b4839, 0 3px 0 #0a4033, 0 4px 0 #08382c, 0 5px 0 #073026, 0 6px 0 #062820, 0 40px 90px rgba(0,0,0,0.45); }
      .qt { display: block; }
      #q1 { top: ${LAND ? 300 : 620}px; } #q2 { top: ${LAND ? 600 : 930}px; }
      /* reveal */
      .logo { position: absolute; left: 0; right: 0; top: ${LAND ? 200 : 600}px; display: flex; flex-direction: column; align-items: center; gap: 6px; }
      .mark { width: ${LAND ? 330 : 380}px; height: ${LAND ? 330 : 380}px; overflow: visible; }
      .mark path { fill: none; stroke-width: 7; stroke-linecap: round; }
      .wmask { overflow: hidden; padding: 0 20px 18px; }
      .word { font-family: "Fraunces", serif; font-size: ${LAND ? 150 : 170}px; line-height: 1.05; }
      .word.em { color: ${C.em}; }
      /* headings */
      .head { position: absolute; left: ${LAND ? 1000 : 60}px; right: ${LAND ? 90 : 60}px; top: ${LAND ? 230 : 210}px; text-align: ${LAND ? "left" : "center"}; }
      .head.steph { top: ${LAND ? 250 : 312}px; }
      .mid2 { font-family: "Fraunces", serif; font-size: ${LAND ? 92 : 82}px; line-height: 1.06; letter-spacing: -0.015em; }
      .sub { font-size: ${LAND ? 44 : 46}px; font-weight: 600; opacity: 0.85; margin-top: 24px; }
      .badge { position: absolute; left: ${LAND ? 1000 : W / 2 - 55}px; top: ${LAND ? 120 : 182}px; width: 110px; height: 110px; border-radius: 50%; overflow: hidden;
        background: ${C.em}; box-shadow: 0 14px 40px rgba(15,92,74,0.35); }
      .roll { display: flex; flex-direction: column; }
      .roll span { display: grid; place-items: center; height: 110px; color: ${C.white}; font-family: "Fraunces", serif; font-size: 70px; }
      /* phone */
      #phwrap { position: absolute; inset: 0; z-index: 5; pointer-events: none; opacity: 0; visibility: hidden; }
      #phMove { position: absolute; inset: 0; perspective: 2400px; perspective-origin: ${PL + PW / 2}px ${PT + PHH / 2}px; }
      #ph { position: absolute; left: ${PL}px; top: ${PT}px; width: ${PW}px; height: ${PHH}px; border-radius: 84px; background: #0E0D0C; padding: ${PAD}px;
        transform-style: preserve-3d; box-shadow: 0 0 0 3px #3A3633, 0 70px 140px rgba(31,27,24,0.45), inset 0 0 0 2px #24211F; }
      #screenFocus { position: relative; width: 100%; height: 100%; border-radius: 70px; overflow: hidden; background: #F8F4EE; }
      .scr { position: absolute; inset: 0; }
      .island { position: absolute; top: 28px; left: 50%; width: 170px; height: 46px; margin-left: -85px; border-radius: 999px; background: #000; z-index: 3; }
      .sheen { position: absolute; inset: 0; border-radius: 84px; overflow: hidden; pointer-events: none; z-index: 4; }
      .sheen i { position: absolute; top: -10%; bottom: -10%; left: 33%; width: 34%;
        background: linear-gradient(100deg, rgba(255,255,255,0), rgba(255,255,255,0.22), rgba(255,255,255,0)); }
      .sc { position: absolute; inset: 0; overflow: hidden; }
      .zm { position: absolute; inset: 0; }
      .sc video, .sc img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: 50% 0%; }
      .z05 .zm { transform-origin: ${r3(SHARE[0] * 100)}% ${r3(SHARE[1] * 100)}%; }
      .press { position: absolute; left: ${r3(SHARE[0] * 100 - 13.5)}%; top: ${r3(SHARE[1] * 100 - 1.3)}%; width: 27%; height: 2.6%; border-radius: 999px; background: ${C.em}; }
      /* the link a guest receives */
      .bubble { position: absolute; z-index: 7; }
      .bshell { border-radius: 34px; background: ${C.white}; box-shadow: 0 40px 100px rgba(31,27,24,0.35); overflow: hidden; }
      .bin img { display: block; width: 100%; object-fit: cover; }
      .bmeta { height: 150px; padding: 22px 34px 0; display: flex; flex-direction: column; gap: 10px; }
      .bmeta b { font-size: 40px; font-weight: 700; color: ${C.ink}; }
      .burl { font-family: "JetBrains Mono", monospace; font-size: ${LAND ? 36 : 38}px; color: #5f5a55; white-space: nowrap; }
      .uc { display: none; } .uc.dom { color: ${C.em}; font-weight: 700; }
      .burl .caret { background: ${C.em}; width: 6px; margin-left: 4px; }
      /* guests */
      #pills { z-index: 7; pointer-events: none; }
      .pill { position: absolute; padding: 22px 36px; border-radius: 999px; background: ${C.em}; color: ${C.white}; font-weight: 700; font-size: ${LAND ? 42 : 44}px;
        white-space: nowrap; box-shadow: 0 20px 50px rgba(15,92,74,0.35); }
      #gh { z-index: 6; overflow: visible; }
      #stats { position: absolute; left: ${LAND ? 1000 : 70}px; right: ${LAND ? 120 : 70}px; top: ${LAND ? 470 : 345}px; display: flex; gap: 40px; justify-content: ${LAND ? "flex-start" : "center"}; }
      .stat { width: ${LAND ? 340 : 420}px; height: ${LAND ? 220 : 196}px; border-radius: 36px; background: ${C.white}; display: flex; flex-direction: column; align-items: center; justify-content: center;
        box-shadow: 0 30px 80px rgba(31,27,24,0.22); }
      .stat b { font-family: "Fraunces", serif; font-size: ${LAND ? 120 : 108}px; line-height: 1; color: ${C.em}; font-variant-numeric: tabular-nums; }
      .stat span { font-size: 32px; font-weight: 700; }
      #chips { position: absolute; left: ${LAND ? 1000 : 0}px; right: ${LAND ? 90 : 0}px; top: ${LAND ? 470 : 420}px; display: flex; justify-content: ${LAND ? "flex-start" : "center"}; gap: 26px; }
      .chip { padding: 20px 40px; border-radius: 999px; border: 4px solid ${C.gold}; color: ${C.white}; font-weight: 700; font-size: 46px; white-space: nowrap; background: rgba(0,0,0,0.14); }
      /* ending */
      .eshade { position: absolute; left: 0; right: 0; bottom: 0; height: 62%; background: linear-gradient(to top, rgba(17,14,12,0.88) 0%, rgba(17,14,12,0.55) 45%, rgba(17,14,12,0) 100%); }
      .ecap { position: absolute; left: ${LAND ? 300 : 60}px; right: ${LAND ? 300 : 60}px; top: ${LAND ? 640 : 960}px; text-align: center; font-family: "Fraunces", serif;
        font-size: ${LAND ? 100 : 112}px; line-height: 1.05; letter-spacing: -0.015em; color: ${C.white}; text-shadow: 0 10px 40px rgba(0,0,0,0.45); }
      #ecss { font-size: ${LAND ? 140 : 150}px; transform-origin: 50% 60%; }
      /* end card */
      #fin .logo { top: ${LAND ? 120 : 360}px; }
      #fin .mark { width: ${LAND ? 220 : 260}px; height: ${LAND ? 220 : 260}px; }
      #fin .word { font-size: ${LAND ? 128 : 150}px; }
      .endurl { position: absolute; left: 0; right: 0; top: ${LAND ? 600 : 900}px; text-align: center; font-weight: 700; font-size: ${LAND ? 64 : 72}px; color: ${C.ink}; }
      .cta { position: absolute; left: 50%; top: ${LAND ? 770 : 1040}px; margin-left: ${LAND ? -380 : -410}px; width: ${LAND ? 760 : 820}px; height: 124px; display: grid; place-items: center;
        border-radius: 999px; background: ${C.em}; color: ${C.white}; font-weight: 700; font-size: ${LAND ? 44 : 48}px; white-space: nowrap; overflow: hidden;
        box-shadow: 0 24px 60px rgba(15,92,74,0.35); }
      .shine { position: absolute; top: -20%; bottom: -20%; left: 0; width: 120px; background: linear-gradient(100deg, rgba(255,255,255,0), rgba(255,255,255,0.55), rgba(255,255,255,0)); }
      .legal { position: absolute; left: ${LAND ? 360 : 90}px; right: ${LAND ? 360 : 90}px; top: ${LAND ? 960 : 1230}px; font-size: ${LAND ? 28 : 32}px; line-height: 1.35; opacity: 0.85; text-align: center; color: ${C.ink}; }
      /* cursor */
      #cur { position: absolute; left: 0; top: 0; width: ${CUR}px; height: ${CUR}px; z-index: 20; filter: drop-shadow(0 4px 6px rgba(0,0,0,0.3)); pointer-events: none; will-change: transform; }
      #cur svg { width: 100%; height: 100%; display: block; }`;

const page = `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${W}, height=${H}" />
    <script src="assets/gsap.min.js"></script>
    <style>${css}
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${END}" data-width="${W}" data-height="${H}">
      <svg width="0" height="0" style="position:absolute"><defs>${filters.join("")}</defs></svg>
${html.join("\n")}
      <div id="phwrap"><div id="phMove"><div id="ph"><div id="screenFocus"><div class="scr">
${screens.join("\n")}
        </div></div><span class="island"></span><div class="sheen" data-layout-ignore><i></i></div></div></div></div>
${music}
${audio.join("\n")}
    </div>
    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
${tl.join("\n")}
      tl.to({}, { duration: ${END} }, 0);
      window.__timelines["main"] = tl;
    </script>
  </body>
</html>
`;
// The phone layer must paint above the scenes it shares the frame with and below the pills, bubble and cursor.
writeFileSync(join(DIR, "index.html"), page);
console.log(`${(60 / P).toFixed(1)} BPM, beat ${P.toFixed(4)} s, music from ${MEDIA0} s — ${END} s, ${tl.length} timeline lines, ${audio.length} sounds`);

// ---------------------------------------------------------------- seam ledger (motion-doctrine), checked by seam-gate
const ledger = {
  fps: 30,
  seams: [
    { id: "fête → savoir (zoom-through)", cut: ZT, technique: "zoom-through", exit: { selector: "#hkZoom", axis: "z", dir: 1 }, entry: { selector: "#tyZoom", axis: "z", dir: 1 } },
    { id: "savoir → vocaux (waterfall cut)", cut: CUT_PB, technique: "waterfall cut LEFT", exit: { selector: "#sy5", axis: "x", dir: -1 }, entry: { selector: "#ph1", axis: "x", dir: -1 } },
    { id: "bulle → logo (object becomes the world)", cut: CUT_RV, technique: "zoom through the bubble", exit: { selector: "#q2", axis: "z", dir: 1 }, entry: { selector: "#rvIn", axis: "z", dir: 1 } },
    { id: "logo → site (crane up)", cut: CUT_UP, technique: "cut-the-curve UP", exit: { selector: "#logo1", axis: "y", dir: -1 }, entry: { selector: "#rh0", axis: "y", dir: -1 } },
    { id: "site → étape 1", cut: CUT_ST, technique: "waterfall cut LEFT + colour flood", exit: { selector: "#rvSub", axis: "x", dir: -1 }, entry: { selector: "#s1w0", axis: "x", dir: -1 } },
    { id: "étape 1 → 2", cut: V(64), technique: "waterfall cut LEFT", exit: { selector: "#s1w2", axis: "x", dir: -1 }, entry: { selector: "#s2w0", axis: "x", dir: -1 } },
    { id: "étape 2 → 3", cut: V(71), technique: "waterfall cut LEFT", exit: { selector: "#s2w5", axis: "x", dir: -1 }, entry: { selector: "#s3w0", axis: "x", dir: -1 } },
    { id: "invités → réponses", cut: CUT_G, technique: "waterfall entry LEFT", exit: { selector: "#scG5", axis: "x", dir: -1 }, entry: { selector: "#g0w0", axis: "x", dir: -1 } },
    { id: "réponses → totaux", cut: CUT_T, technique: "waterfall cut LEFT", exit: { selector: "#g0sub", axis: "x", dir: -1 }, entry: { selector: "#g1w0", axis: "x", dir: -1 } },
    { id: "totaux → téléphone", cut: CUT_A, technique: "waterfall cut LEFT + colour flood", exit: { selector: "#stB", axis: "x", dir: -1 }, entry: { selector: "#g2w0", axis: "x", dir: -1 } },
    { id: "téléphone → gratuit", cut: CUT_F, technique: "waterfall cut LEFT + colour flood", exit: { selector: "#ch2", axis: "x", dir: -1 }, entry: { selector: "#g3w0", axis: "x", dir: -1 } },
    { id: "gratuit → photos (cut-the-curve)", cut: CUT_E, technique: "cut-the-curve LEFT", exit: { selector: "#phMove", axis: "x", dir: -1 }, entry: { selector: "#enIn", axis: "x", dir: -1 } },
    { id: "photos → carton final (inverse zoom)", cut: CUT_FIN, technique: "inverse zoom-through", exit: { selector: "#enZoom", axis: "z", dir: -1 }, entry: { selector: "#finZoom", axis: "z", dir: -1, scanRoot: "#fin" } },
  ],
};
writeFileSync(join(HERE, LAND ? "ledger-16x9.json" : "ledger.json"), JSON.stringify(ledger, null, 2));

// ---------------------------------------------------------------- the montage, for the studio dashboard timeline
if (!LAND) {
  const seg = (a, b, name, kind) => ({ name, kind, start: a, end: b });
  const text = (a, b, s) => ({ start: a, end: b, words: [{ text: s }] });
  const plan = {
    duration: END,
    parts: [seg(0, ZT, "1 · Accroche", "face"), seg(ZT, CUT_RV, "2 · Le problème", "face"), seg(CUT_RV, CUT_ST, "3 · La révélation", "screen"),
      seg(CUT_ST, V(80), "4 · Comment ça marche", "screen"), seg(V(80), CUT_A, "5 · Les invités", "screen"), seg(CUT_A, CUT_E, "6 · Les arguments", "screen"),
      seg(CUT_E, END, "7 · La fin", "face")],
    cuts: [V(26), V(28), V(30), ZT, CUT_PB, CUT_RV, CUT_UP, CUT_ST, V(64), V(71), TAP_LINK, CUT_G, CUT_T, CUT_A, CUT_F, CUT_E, V(104), V(105), CUT_FIN],
    frames: [], behind: [], captions: [],
    scenes: [text(0, V(26), "Un mariage."), text(V(26), V(28), "Un baptême."), text(V(28), V(30), "Un Gamou."), text(V(30), ZT, "Une grande fête."),
      text(ZT, CUT_PB, "Tout le monde doit savoir."), text(CUT_PB, V(42), "47 messages vocaux…"), text(V(42), CUT_RV, "« C'est où, déjà ? » « On mange à quelle heure ? »"),
      text(CUT_UP, CUT_ST, "Le site de votre événement. Prêt en 10 minutes."), text(CUT_ST, V(64), "1 · Choisissez un modèle"),
      text(V(64), V(71), "2 · Ajoutez vos infos et vos photos"), text(V(71), V(79.5), "3 · Partagez le lien sur WhatsApp"),
      text(CUT_G, CUT_T, "Ils répondent en un clic. Sans créer de compte."), text(CUT_T, CUT_A, "Vous savez qui vient."), text(CUT_A, CUT_F, "Pensé pour le téléphone."),
      text(CUT_F, CUT_E, "Gratuit pour commencer."), text(V(103.5), CUT_FIN, "Votre événement mérite son site.")],
    mographs: [
      { id: "mg1", kind: "bulles", start: CUT_PB, end: CUT_RV, text: "mur de messages vocaux, compteur 0 → 47, deux questions, plongée dans la dernière bulle" },
      { id: "mg2", kind: "logo", start: CUT_RV, end: CUT_UP, text: "traits dessinés, point or sur le temps 48" },
      { id: "mg3", kind: "téléphone", start: PH_IN, end: CUT_E, text: "v01 → v03 → v04 (clic, frappe) → éditeur → publier (clic) → site invité → v05 → totaux → v02 → accueil" },
      { id: "mg4", kind: "lien", start: TAP_SHARE, end: TAP_LINK + 0.7, text: "aperçu du lien, adresse tapée lettre par lettre" },
      { id: "mg5", kind: "pastilles", start: V(80), end: CUT_G, text: "6 rubriques, une par temps" },
      { id: "mg6", kind: "compteurs", start: V(90.5), end: CUT_A, text: "8 → 9 présents · 17 → 19 places (la réponse de Fatou)" },
      { id: "mg7", kind: "fin", start: CUT_FIN, end: END, text: "logo, xewxew.click, bouton cliqué, mention" }],
    fx: ledger.seams.map((s, k) => ({ id: `fx${k}`, kind: s.technique, at: s.cut, duration: 0.6, reason: s.id })),
    sfx: cues.sort((a, b) => a.at - b.at).map(({ id, kind, at }) => ({ id, kind, at })),
    notes: ["Musique : « WA WA WA FUNK (Remix SLOWED) » fournie dans le dossier du projet, à partir de " + MEDIA0 + " s du morceau ; licence à vérifier avant diffusion."],
  };
  writeFileSync(join(WORK, "05-compose/beats.json"), JSON.stringify(plan, null, 2));
}
