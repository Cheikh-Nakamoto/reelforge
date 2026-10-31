import assert from "node:assert/strict";
import { test } from "node:test";
import { loadStyle } from "../src/lib/style.js";
import { BeatsSchema, type Beats } from "../src/steps/beats.js";
import { browserGeometry, planDevices, planHovers, scrollPlan } from "../src/steps/browser.js";
import { buildHtml, FORMATS } from "../src/steps/html.js";
import { planRig } from "../src/steps/rig.js";

const base: Beats = {
  duration: 20, captions: [], behind: [], mographs: [], sfx: [], cuts: [], fx: [], frames: [], scenes: [], parts: [], notes: [],
  camera: [], spaces: [], devices: [], hovers: [],
};
const vertical = { width: 1080, height: 1920 };
const style = loadStyle("reel-dynamique");
const slot = { src: "assets/part-1.mp4", start: 3, end: 11, from: 0, role: "screen" as const };
const html = (beats: Beats, devices: Parameters<typeof buildHtml>[0]["devices"], fmt: keyof typeof FORMATS = "9x16") =>
  buildHtml({ beats, style, format: FORMATS[fmt], src: vertical, matte: null, hasCutout: false, devices });

const facts = (aspect: number, text = "", start = 3) => ({ role: "screen" as const, start, end: start + 6, aspect, text });

test("a landscape recording, or one about a site, takes the browser; a portrait recording keeps the phone", () => {
  assert.deepEqual(planDevices([facts(16 / 9), facts(0.46, "", 12)], [], 3).kinds, ["browser", "phone"]);
  assert.deepEqual(planDevices([facts(0.46, "regarde ce site web")], [], 3).kinds, ["phone"], "portrait stays a phone even about a site");
  assert.deepEqual(planDevices([facts(1, "on ouvre la page d'accueil")], [], 3).kinds, ["browser"]);
  assert.deepEqual(planDevices([facts(1, "bonjour")], [], 3).kinds, ["browser"], "landscape or square alone is enough");
});

test("a hand edit overrides the default, and the browser spends the 3D budget", () => {
  const o = (target: string, kind: "phone" | "browser") => ({ id: "d", target, kind });
  assert.deepEqual(planDevices([facts(16 / 9)], [o("dv0", "phone")], 3).kinds, ["phone"]);
  assert.deepEqual(planDevices([facts(0.46)], [o("dv0", "browser")], 3).kinds, ["browser"]);
  const two = planDevices([facts(16 / 9, "", 3), facts(16 / 9, "", 12)], [], 1);
  assert.deepEqual(two.kinds, ["browser", "phone"], "one 3D effect left: the second falls back to the phone");
  assert.equal(two.notes.length, 1);
  assert.match(two.notes[0], /budget/);
  assert.deepEqual(planDevices([facts(16 / 9)], [], 0).kinds, ["phone"]);
});

test("the window's geometry leaves the page taller than its viewport, so there is room to scroll", () => {
  for (const [W, H, aspect] of [[1080, 1920, 16 / 9], [1920, 1080, 16 / 9], [1080, 1920, 0.46], [1080, 1920, 1]] as const) {
    const g = browserGeometry(W, H, aspect, "screen");
    assert.ok(g.range > 0, `${W}x${H} aspect ${aspect}: scrollable`);
    assert.ok(Math.abs(g.pageH - g.pageW / aspect) < 1, "the page keeps the recording's aspect");
    assert.ok(g.left >= 0 && g.left + g.w <= W && g.top >= 0 && g.top + g.chromeH + g.vpH <= H, "inside the frame");
  }
  // a window under a bubble leaves the corner to the speaker
  const under = browserGeometry(1080, 1920, 16 / 9, "broll");
  assert.ok(under.top + under.chromeH + under.vpH < 1920 * 0.97);
});

test("hover frames: kept at the editor's instants, inside the calm part, on a browser, one at a time", () => {
  const targets = [{ target: "dv0", start: 3, end: 11 }];
  const h = (id: string, at: number, extra: object = {}) => ({ id, target: "dv0", at, duration: 1.2, x: 0.2, y: 0.3, w: 0.3, h: 0.1, ...extra });
  const ok = planHovers([h("h0", 5)], targets);
  assert.equal(ok.kept.length, 1);
  assert.equal(ok.notes.length, 0);
  const out = planHovers([
    h("a", 3.2),                       // inside the entry
    h("b", 10.5),                      // runs into the exit
    h("c", 5, { target: "dv9" }),      // no such device
    h("d", 5, { x: 0.9, w: 0.3 }),     // off the page
    h("e", 6), h("f", 6.5),            // overlaps e
    h("g", 8),
  ], targets);
  assert.deepEqual(out.kept.map((x) => x.id), ["e", "g"]);
  assert.equal(out.notes.length, 5);
  // the target must be a browser
  assert.equal(planHovers([h("p", 5)], []).kept.length, 0);
});

test("the scroll is three phases (nudge curve) that end as the hover frame appears", () => {
  const g = browserGeometry(1080, 1920, 16 / 9, "screen");
  const win = { target: "dv0", start: 3, end: 11 };
  const hv = [{ id: "h0", target: "dv0", at: 6, duration: 1.2, x: 0.3, y: 0.9, w: 0.2, h: 0.08 }];
  const s = scrollPlan(win, hv, g);
  assert.equal(s.length, 1);
  assert.ok(Math.abs(s[0].at + s[0].duration - 6) < 1e-6, "arrives on the hover's instant");
  assert.ok(s[0].to > 0 && s[0].to <= g.range, "towards the lower part, clamped to the page");
  // no hover: one reading scroll through the calm part, top to bottom
  const d = scrollPlan(win, [], g);
  assert.equal(d.length, 1);
  assert.equal(d[0].from, 0);
  assert.equal(d[0].to, g.range);
  assert.ok(d[0].at >= 3 + 0.8 && d[0].at + d[0].duration <= 11 - 0.45);
  // a hover at the very top needs no scroll
  assert.equal(scrollPlan(win, [{ ...hv[0], y: 0.02 }], g).length, 0);
});

test("the schema reads old beats (no devices, no hovers) and the new fields", () => {
  const old = BeatsSchema.parse({ duration: 1, captions: [], behind: [], mographs: [], sfx: [] });
  assert.deepEqual(old.devices, []);
  assert.deepEqual(old.hovers, []);
  const nu = BeatsSchema.parse({
    duration: 1, captions: [], behind: [], mographs: [], sfx: [],
    devices: [{ id: "d0", target: "dv0", kind: "browser", url: "exemple.fr" }],
    hovers: [{ id: "h0", target: "dv0", at: 5, duration: 1, x: 0.1, y: 0.2, w: 0.3, h: 0.1, label: "Prix" }],
  });
  assert.equal(nu.devices[0].kind, "browser");
  assert.equal(nu.hovers[0].label, "Prix");
});

test("the composition: a browser window in perspective, scrolling on its page, hover frames at their instants", () => {
  const beats: Beats = {
    ...base,
    hovers: [{ id: "h0", target: "dv0", at: 6, duration: 1.2, x: 0.3, y: 0.9, w: 0.2, h: 0.08, label: "Prix" }],
  };
  const out = html(beats, [{ ...slot, kind: "browser", aspect: 16 / 9 }]);
  assert.match(out, /<div id="dv0" class="devstage" style="opacity:0;z-index:2">/);
  assert.match(out, /class="browser"/);
  assert.equal((out.match(/class="bdot"/g) ?? []).length, 3, "three pastilles");
  assert.match(out, /class="btab"/);
  assert.match(out, /class="burl"/);
  assert.match(out, /<video id="dv0v" src="assets\/part-1\.mp4" data-start="3" data-duration="8"/);
  assert.doesNotMatch(out, /id="dv0" class="devstage"[^]*class="phone"[^]*<video id="dv0v"/, "no phone around a browser");
  // the video sits in the page, the page in the viewport, the viewport in the window, the window in the blur wrapper
  assert.match(out, /<div class="devblur">\s*(<div class="devrig rigcam"[^>]*>)?<div class="browser"[^]*<div class="bvp"[^>]*>\s*<div class="bpage"[^>]*>\s*<video id="dv0v"/);
  assert.match(out, /tl\.fromTo\("#dv0 \.browser", \{ rotationY: /);
  // blur: same rules as the phone, on a wrapper only, never on the video, never with opacity
  assert.match(out, /tl\.set\("#dv0 \.devblur", \{ filter: "blur\(18px\)" \}, 3\)/);
  const lines = out.split("\n").filter((l) => /tl\.\w+\(/.test(l) && l.includes("#dv0"));
  assert.ok(!lines.some((l) => l.includes("filter") && l.includes("opacity")), "blur and opacity share a tween");
  assert.ok(!lines.some((l) => l.includes("filter") && !l.includes('"#dv0 .devblur"')), "blur only on the wrapper");
  assert.ok(!/#dv0v[^{]*\{[^}]*filter/.test(out), "never a filter on the video");
  assert.ok(!lines.some((l) => /#dv0v"/.test(l)), "no tween on the video itself");
  // scroll: three tweens on the page, ease order ramp-in, burst, tail, the last one ending on the hover's instant
  const scroll = lines.filter((l) => l.trim().startsWith("tl.to(") && l.includes('"#dv0 .bpage"'));
  assert.equal(scroll.length, 3);
  assert.deepEqual(scroll.map((l) => /ease: "([^"]+)"/.exec(l)![1]), ["power3.in", "none", "power4.out"]);
  const spans = scroll.map((l) => ({ d: Number(/duration: ([\d.]+)/.exec(l)![1]), at: Number(/\}, ([\d.]+)\);$/.exec(l)![1]) }));
  assert.ok(spans[1].d < spans[2].d && spans[0].d >= spans[1].d, "burst is the shortest, the tail the longest");
  assert.ok(Math.abs(spans[2].at + spans[2].d - 6) < 0.01);
  // hover frame appears at its instant and leaves before the window's exit
  assert.match(out, /<div class="bhover" id="dv0h0"[^>]*>/);
  assert.match(out, /tl\.to\("#dv0h0", \{ opacity: 1, scale: 1, duration: [\d.]+, ease: "power3\.out" \}, 6\)/);
  assert.match(out, /Prix/);
  // the window still pushes out like the phone
  assert.match(out, /tl\.to\("#dv0 \.browser", \{ scale: 1\.35, z: 260, opacity: 0, duration: 0\.45, ease: "power3\.in" \}, 10\.55\)/);
});

test("a phone slot is unchanged, and the 16:9 window fits the wide frame", () => {
  const phone = html(base, [{ ...slot, kind: "phone" }]);
  assert.match(phone, /class="phone"/);
  assert.doesNotMatch(phone, /class="browser"/);
  const wide = html(base, [{ ...slot, kind: "browser", aspect: 16 / 9 }], "16x9");
  assert.match(wide, /class="browser"/);
});

test("a browser is its own 3D effect: the rig leaves it alone and counts it in the budget", () => {
  const cam: Beats["camera"] = [{ id: "cam0", at: 4, duration: 2, move: "dolly", target: "dv0" }];
  const from = { scenes: [], mographs: [], devices: [{ target: "dv0", start: 3, end: 11 }] };
  const p = planRig(cam, from, 3, new Set(["dv0"]));
  assert.equal(p.kept.length, 0);
  assert.equal(p.notes.length, 1);
  const out = html({ ...base, camera: cam }, [{ ...slot, kind: "browser", aspect: 16 / 9 }]);
  assert.doesNotMatch(out, /#dv0 \.rigcam/);
});
