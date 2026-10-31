import assert from "node:assert/strict";
import { test } from "node:test";
import { loadStyle } from "../src/lib/style.js";
import { BeatsSchema, type Beats } from "../src/steps/beats.js";
import { blurPx, cardPose, planSpaces, proposeSpaces, schedule, spaceTimeline } from "../src/steps/cards.js";
import { buildComposition, buildHtml, FORMATS } from "../src/steps/html.js";

const base: Beats = {
  duration: 30, captions: [], behind: [], mographs: [], sfx: [], cuts: [], fx: [], frames: [], scenes: [], parts: [], notes: [], camera: [],
  devices: [], hovers: [], spaces: [],
};
type Space = Beats["spaces"][number];
const card = (i: number, kind: Beats["mographs"][number]["kind"] = "counter") => ({ id: `c${i}`, kind, text: `Carte ${i}`, value: 10 * (i + 1), suffix: "%", label: "de marge" });
const space = (n = 3, start = 4, end = 14): Space => ({ id: "sp0", start, end, cards: Array.from({ length: n }, (_, i) => card(i)), reason: "x" });

const style = loadStyle("reel-dynamique");
const vertical = { width: 1080, height: 1920 };
const html = (beats: Beats) => buildHtml({ beats, style, format: FORMATS["9x16"], src: vertical, matte: null, hasCutout: false });

interface Tween { fn: string; sel: string; body: string; dur: number; at: number }
/** Reads the GSAP lines of a timeline (`tl.to("sel", { props, duration: d, ... }, at)`). */
const tweens = (lines: string[]): Tween[] =>
  lines.flatMap((l) => {
    const m = l.match(/tl\.(set|to|fromTo)\("([^"]+)", (\{.*\}), (-?[\d.]+)\);\s*$/);
    if (!m) return [];
    const dur = Number(m[3].match(/duration: ([\d.]+)/)?.[1] ?? 0);
    return [{ fn: m[1], sel: m[2], body: m[3], dur, at: Number(m[4]) }];
  });
const num = (body: string, key: string) => {
  const m = body.match(new RegExp(`(?:^|[ {,])${key}: (-?[\\d.]+)`));
  return m ? Number(m[1]) : undefined;
};

test("cards sit at distinct depths, each deeper than the one before, and the blur grows with the distance to the focus plane", () => {
  const poses = [0, 1, 2, 3].map((k) => cardPose(k, 1080, 1920, 1));
  assert.equal(new Set(poses.map((p) => p.z)).size, 4);
  assert.ok(poses.every((p, k) => k === 0 || p.z < poses[k - 1].z), "deeper and deeper");
  assert.ok(poses.every((p, k) => k === 0 || p.x > poses[k - 1].x), "one current: the next card is further to the right");
  assert.equal(blurPx(0, 1), 0);
  assert.equal(blurPx(2, 1), 2 * blurPx(1, 1));
  assert.equal(blurPx(3, 1), 3 * blurPx(1, 1));
  assert.ok(blurPx(1, 1.5) > blurPx(1, 1), "scales with the format");
});

test("the blur of each card follows its distance to the focus plane as the camera travels", () => {
  const s = space(4);
  const tw = tweens(spaceTimeline(s, 0, 1080, 1920, 1));
  const sch = schedule(s)!;
  for (let k = 0; k < 4; k++) {
    const mine = tw.filter((x) => x.sel === `#sp0 .cd${k} .cd-blur` && x.body.includes("filter"));
    // starts at the blur of its distance from card 0, then relaxes one step per travel until it is the focus
    assert.equal(mine[0].body.includes(`blur(${blurPx(k, 1)}px)`), true, `card ${k} starts at ${blurPx(k, 1)} px`);
    const last = mine.at(-1)!;
    assert.match(last.body, /blur\(0px\)/, `card ${k} ends sharp`);
    // sharp exactly when the camera stops on it
    assert.ok(Math.abs(last.at + last.dur - sch.focus[k]) < 1e-6 || k === 0, `card ${k} is sharp as the camera arrives`);
    // never blurred again once sharp, and never in the same tween as its opacity
    assert.ok(mine.every((x) => !x.body.includes("opacity")));
  }
});

test("one camera path per sequence: gapless from the start to the exit, one direction on each axis, on the camera only", () => {
  const s = space(4, 4, 16);
  const tw = tweens(spaceTimeline(s, 0, 1080, 1920, 1));
  const path = tw.filter((x) => x.sel === "#sp0 .spcam" && x.fn === "to");
  assert.ok(path.length >= 4 + 3, "arrival, a dwell per card, a travel per leg");
  const sorted = [...path].sort((a, b) => a.at - b.at);
  assert.ok(Math.abs(sorted[0].at - 4) < 1e-6, "starts with the sequence");
  for (let i = 1; i < sorted.length; i++) {
    assert.ok(Math.abs(sorted[i].at - (sorted[i - 1].at + sorted[i - 1].dur)) < 2e-3, `no hold between tween ${i - 1} and ${i}`);
  }
  const end = sorted.at(-1)!.at + sorted.at(-1)!.dur;
  assert.ok(Math.abs(end - (16 - 0.34)) < 2e-3, "runs until the sequence leaves");
  const mono = (key: string, sign: 1 | -1) => {
    const vals = sorted.map((x) => num(x.body, key)).filter((v): v is number => v !== undefined);
    assert.ok(vals.every((v, i) => i === 0 || (v - vals[i - 1]) * sign >= -1e-6), `${key} never turns back`);
  };
  mono("z", 1); // Z forward: the camera goes deeper into the same thought
  mono("x", -1); // the film's current
  mono("rotationY", -1);
  assert.ok(sorted.every((x) => !/ease: "(bounce|elastic|back)/.test(x.body)));
  // the camera is the only thing that has a path: nothing else moves on the camera level
  assert.equal(tw.filter((x) => /spcam/.test(x.sel)).length, tw.filter((x) => x.sel === "#sp0 .spcam").length);
});

test("no card idles between its entry and its exit: it enters inside the window, leaves when the camera does, and the camera moves throughout", () => {
  const s = space(4, 4, 16);
  const tw = tweens(spaceTimeline(s, 0, 1080, 1920, 1));
  const sch = schedule(s)!;
  for (let k = 0; k < 4; k++) {
    const inn = tw.filter((x) => x.sel === `#sp0 .cd${k} .cd-in`);
    assert.ok(inn.length >= 1, `card ${k} has an entry`);
    const enter = inn[0];
    assert.ok(enter.at >= 4 - 1e-6 && enter.at + enter.dur <= sch.focus[0] + 0.6, `card ${k} enters with the sequence`);
    if (k < 3) {
      const out = inn.find((x) => num(x.body, "opacity") === 0 && x !== enter)!;
      assert.ok(out, `card ${k} leaves when the camera moves on`);
      assert.ok(out.at >= sch.focus[k] && out.at + out.dur <= sch.focus[k + 1] + 1e-6, `card ${k} leaves during the travel to the next`);
    }
  }
  // the last card and the rest leave together, in the current, with the sequence
  const outs = tw.filter((x) => x.sel === "#sp0 .sp-out");
  assert.ok(outs.length >= 2);
  assert.ok(outs.every((x) => x.at >= 16 - 0.34 - 1e-6 && x.at + x.dur <= 16));
  assert.ok(outs.some((x) => num(x.body, "x")! < 0), "the exit travels left");
});

test("the schedule aligns each card on its word when the times allow, and spreads them evenly otherwise", () => {
  const aligned: Space = { ...space(3, 3, 17), cards: [3.8, 8, 12.5].map((at, i) => ({ ...card(i), at })) };
  const a = schedule(aligned)!;
  assert.equal(a.aligned, true);
  assert.deepEqual(a.focus, [3.8, 8, 12.5]);
  // hints too close to travel between: spread evenly, still inside the window
  const tight: Space = { ...space(3, 3, 17), cards: [3.8, 4.2, 4.6].map((at, i) => ({ ...card(i), at })) };
  const t = schedule(tight)!;
  assert.equal(t.aligned, false);
  assert.ok(t.focus.every((f, i) => i === 0 || f - t.focus[i - 1] >= t.travel + 0.3 - 1e-6));
  // a window too short for its cards has no schedule
  assert.equal(schedule(space(5, 4, 7)), null);
});

test("planSpaces keeps what the composition can honour and says why it drops the rest", () => {
  const ctx = {
    scenes: [{ id: "sc0", start: 20, end: 22, words: [] }] as Beats["scenes"],
    mographs: [{ id: "mg0", kind: "badge", start: 26, end: 28, text: "x" }] as Beats["mographs"],
    behind: [{ id: "bh0", text: "budget", start: 30.5, end: 31.8 }] as Beats["behind"],
    windows: [{ target: "dv0", start: 40, end: 44 }],
  };
  const { kept, notes } = planSpaces(
    [
      { ...space(3, 4, 14), id: "ok" },
      { ...space(1, 15, 20), id: "oneCard" },
      { ...space(3, 18, 24), id: "scene" },
      { ...space(3, 25, 35), id: "graphic" },
      { ...space(3, 36, 39), id: "short" },
      { ...space(3, 41, 50), id: "phone" },
    ],
    ctx, 3,
  );
  assert.deepEqual(kept.map((k) => k.id), ["ok"]);
  assert.equal(notes.length, 5);
  assert.ok(notes.every((n) => /^Séquence de cartes /.test(n)));
  // the budget of 3D effects
  assert.equal(planSpaces([space()], { ...ctx, scenes: [], mographs: [], behind: [], windows: [] }, 0).kept.length, 0);
  assert.equal(planSpaces([space(), { ...space(), id: "sp1" }], { ...ctx, scenes: [], mographs: [], behind: [], windows: [] }, 3).kept.length, 1, "two sequences cannot overlap");
  assert.equal(planSpaces([space(8)], { ...ctx, scenes: [], mographs: [], behind: [], windows: [] }, 3).kept.length, 0, "at most 6 cards");
});

test("the default stages three neighbouring graphics together, from the words, and takes them out of the loose graphics", () => {
  const mg = (id: string, kind: Beats["mographs"][number]["kind"], start: number, extra: Partial<Beats["mographs"][number]> = {}) =>
    ({ id, kind, start, end: start + 2.2, text: `t${id}`, ...extra }) as Beats["mographs"][number];
  const mographs = [
    mg("mg0", "counter", 4, { value: 30, suffix: "%", label: "de marge", wordId: "w1" }),
    mg("mg1", "definition", 8, { items: ["ROI", "retour sur investissement"] }),
    mg("mg2", "compare", 12, { items: ["avant", "après"] }),
    mg("mg3", "cta", 25),
  ];
  const out = proposeSpaces(mographs, { scenes: [], behind: [], duration: 30 }, style, {});
  assert.equal(out.spaces.length, 1);
  const s = out.spaces[0];
  assert.equal(s.cards.length, 3);
  assert.deepEqual(s.cards.map((c) => c.kind), ["counter", "definition", "compare"]);
  assert.deepEqual(s.cards[1].items, ["ROI", "retour sur investissement"]);
  assert.ok(s.cards.every((c, i) => c.at !== undefined && Math.abs(c.at - (mographs[i].start + 0.1)) < 1e-6), "each card lands on its graphic's word");
  assert.ok(s.start < s.cards[0].at! && s.end >= mographs[2].end);
  assert.equal(schedule(s)!.aligned, true, "the default schedule is the aligned one");
  assert.ok(s.reason);
  assert.deepEqual(out.mographs.map((m) => m.id), ["mg3"], "the grouped graphics are the sequence's cards now");
  // fewer than three: nothing; a hook or a CTA is not a card; budget 0: nothing
  assert.equal(proposeSpaces(mographs.slice(0, 2), { scenes: [], behind: [], duration: 30 }, style, {}).spaces.length, 0);
  assert.equal(proposeSpaces([mg("a", "hook", 4), mg("b", "cta", 8), mg("c", "underline", 12)], { scenes: [], behind: [], duration: 30 }, style, {}).spaces.length, 0);
  assert.equal(proposeSpaces(mographs, { scenes: [], behind: [], duration: 30 }, { ...style, camera: { max: 0 } }, {}).spaces.length, 0);
  assert.equal(proposeSpaces(mographs, { scenes: [], behind: [], duration: 30 }, style, { used: 3 }).spaces.length, 0);
  // a behind-word inside the window keeps the graphics loose
  assert.equal(proposeSpaces(mographs, { scenes: [], behind: [{ id: "b", text: "x", start: 9, end: 10 }], duration: 30 }, style, {}).spaces.length, 0);
  // too far apart to read as one sequence
  assert.equal(proposeSpaces([mographs[0], { ...mographs[1], start: 20, end: 22 }, { ...mographs[2], start: 40, end: 42 }], { scenes: [], behind: [], duration: 50 }, style, {}).spaces.length, 0);
});

test("the schema reads old beats (no spaces) and the new field", () => {
  const old = BeatsSchema.parse({ duration: 1, captions: [], behind: [], mographs: [], sfx: [] });
  assert.deepEqual(old.spaces, []);
  const nu = BeatsSchema.parse({ duration: 1, captions: [], behind: [], mographs: [], sfx: [], spaces: [space()] });
  assert.equal(nu.spaces[0].cards.length, 3);
});

test("the composition: a perspective space with its cards, one camera path, blur on wrappers only, the rush untouched", () => {
  const out = html({ ...base, spaces: [space(3, 4, 14)] });
  assert.match(out, /<div id="sp0" class="clip sp" data-start="4" data-duration="10"/);
  assert.equal((out.match(/class="cd cd\d"/g) ?? []).length, 3);
  assert.equal((out.match(/class="spcam"/g) ?? []).length, 1);
  // each card at its own depth
  const zs = [...out.matchAll(/class="cd cd(\d)"[^>]*translate3d\([^,]+, [^,]+, (-?\d+)px\)/g)].map((m) => Number(m[2]));
  assert.equal(new Set(zs).size, 3, "three depths");
  // blur on a wrapper, never with opacity, never on the card content
  const lines = out.split("\n").filter((l) => /tl\.\w+\(/.test(l) && l.includes("#sp0"));
  assert.ok(lines.length > 10);
  assert.ok(lines.filter((l) => l.includes("filter")).every((l) => /"#sp0 \.cd\d \.cd-blur"/.test(l) && !l.includes("opacity")));
  // the rush's camera levels are not touched by the space
  assert.ok(!lines.some((l) => /"\.(cam|push|shake|drift|frame)"|#cam|#cutcam/.test(l)));
  // the perspective lives on the space, not on the rush
  assert.match(out, /\.sp-view \{[^}]*perspective: \d+px/);
  // captions and graphics are still there; without spaces, nothing of it
  assert.doesNotMatch(html(base), /spcam|sp-view/);
});

test("the composition drops a sequence that does not fit and keeps the notes", () => {
  const beats: Beats = {
    ...base,
    scenes: [{ id: "sc0", start: 6, end: 8, words: [{ id: "w", text: "Oui", start: 6.1, end: 6.5 }] }],
    spaces: [space(3, 4, 14)],
  };
  const out = buildComposition({ beats, style, format: FORMATS["9x16"], src: vertical, matte: null, hasCutout: false });
  assert.doesNotMatch(out.html, /class="spcam"/);
  assert.ok(out.notes.some((n) => /^Séquence de cartes sp0/.test(n)));
});
