import { CHAR_EM, esc, extrude, r3 } from "../lib/markup.js";
import type { Style } from "../lib/style.js";
import type { Beats } from "./beats.js";
import { browserGeometry, scrollPlan, scrollTweens, type DeviceKind } from "./browser.js";
import { OUT_T, poseProps, seamAxis, seamMotion, seamPerspective } from "./transitions.js";

type T = (line: string) => void;

// The scene's Z path: it arrives at ENTRY_SCALE and retracts to 1, then leaves towards EXIT_SCALE. Both shrink, so
// the seams' ledger rows read their sign from here, not from a second copy of the plan.
const ENTRY_SCALE = 1.25;
const EXIT_SCALE = 0.8;

/** The rush in the seams' ledger: its deepest camera level, so the gate reads every level above it too. */
export const RUSH = "#frame-cam .drift";

/**
 * Full-screen kinetic typography (the punchline device of top short-form edits): an animated background lands over
 * the picture in an inverse zoom-through and each word slams in when it is spoken, overshooting from far, with a
 * three-frame landing shake on the block (a later landing cuts the earlier shake short). The key word takes the accent colour and an extruded face. Captions step aside while a scene is on.
 */
export function buildScenes(scenes: Beats["scenes"], style: Style, W: number, H: number, blur: string, t: T, rigged: ReadonlySet<number> = new Set()): { html: string; css: string } {
  if (!scenes.length) return { html: "", css: "" };
  const c = style.colors;
  const vertical = H > W;
  const font = style.fonts.behind;
  const em = CHAR_EM[font] ?? 0.6;
  const unit = Math.min(W, H) / 1080;
  const html = scenes.map((sc, i) => {
    const id = `sc${i}`;
    const words = sc.words.map((w) => w.text.replace(/[,.;:!?…"«»]/g, "").toUpperCase()).filter(Boolean);
    // Lines of at most ~10 characters (portrait) or ~16 (landscape), sized so the longest fits 88 % of the width.
    const maxChars = vertical ? 10 : 16;
    const lines: number[][] = [];
    let cur: number[] = [], len = 0;
    words.forEach((w, k) => {
      if (cur.length && len + 1 + w.length > maxChars) {
        lines.push(cur);
        cur = [];
        len = 0;
      }
      cur.push(k);
      len += (cur.length > 1 ? 1 : 0) + w.length;
    });
    if (cur.length) lines.push(cur);
    const longest = Math.max(...lines.map((l) => l.map((k) => words[k]).join(" ").length));
    const fs = Math.round(Math.min(H * (vertical ? 0.14 : 0.2), (W * 0.88) / Math.max(1, longest * em), (H * 0.78) / Math.max(1, lines.length * 1.05)));

    // Inverse zoom-through (cut-the-curve): the scene arrives oversized and retracts, then leaves shrinking, one Z
    // sign throughout. Peak blur 20 px on the full-frame background, 10 px on the type (more smears the letters).
    // Blur rides the wrappers and opacity their children: both in one tween composite wrong in headless Chrome.
    const io = r3(Math.min(0.5, Math.max(0.1, sc.end - sc.start - 0.2)));
    // A scene that turns (cube, flip) is a face of a solid: the whole clip rotates, opaque from its first frame (the
    // rush is hidden while it is on), with a lighter blur and no scale. Its rotations are `transitions.ts`'s.
    const turn = sc.transition && sc.transition !== "portal" ? sc.transition : null;
    if (turn) {
      const inn = seamMotion(turn, "in", W, H);
      t(`tl.set("#${id}", { transformPerspective: ${seamPerspective(turn, W, H)}, ${poseProps(inn.from)} }, ${r3(sc.start)});`);
      t(`tl.to("#${id}", { ${poseProps(inn.to)}, duration: ${inn.duration}, ease: "${inn.ease}" }, ${r3(sc.start)});`);
      t(`tl.set("#${id} .scbgf", { filter: "blur(10px)" }, ${r3(sc.start)});`);
      t(`tl.to("#${id} .scbgf", { filter: "blur(0px)", duration: ${inn.duration}, ease: "power3.out" }, ${r3(sc.start)});`);
      t(`tl.set("#${id} .sctf", { filter: "blur(6px)" }, ${r3(sc.start)});`);
      t(`tl.to("#${id} .sctf", { filter: "blur(0px)", duration: ${inn.duration}, ease: "power3.out" }, ${r3(sc.start)});`);
      t(`tl.set("#${id} .scbg", { opacity: 1 }, ${r3(sc.start)});`);
    } else {
      t(`tl.set("#${id} .scbgf", { scale: ${ENTRY_SCALE}, filter: "blur(20px)" }, ${r3(sc.start)});`);
      t(`tl.to("#${id} .scbgf", { scale: 1, filter: "blur(0px)", duration: ${io}, ease: "expo.out" }, ${r3(sc.start)});`);
      t(`tl.set("#${id} .sctf", { scale: ${ENTRY_SCALE}, filter: "blur(10px)" }, ${r3(sc.start)});`);
      t(`tl.to("#${id} .sctf", { scale: 1, filter: "blur(0px)", duration: ${io}, ease: "expo.out" }, ${r3(sc.start)});`);
      t(`tl.set("#${id} .scbg", { opacity: 0.15 }, ${r3(sc.start)});`);
      t(`tl.to("#${id} .scbg", { opacity: 1, duration: ${io}, ease: "expo.out" }, ${r3(sc.start)});`);
    }
    t(`tl.set("#${id} .sctext", { x: 0, y: 0, scale: 1, opacity: 1 }, ${r3(sc.start)});`);
    t(`tl.to("#${id} .scblob", { rotation: 40, xPercent: 12, duration: ${r3(sc.end - sc.start)}, ease: "none" }, ${r3(sc.start)});`);
    const ats = sc.words.slice(0, words.length).map((w) => Math.max(sc.start + 0.02, w.start - 0.04));
    sc.words.forEach((w, k) => {
      if (k >= words.length) return;
      const at = ats[k];
      const tilt = k % 2 ? 7 : -7;
      t(`tl.fromTo("#${id}w${k}", { scale: 2.6, opacity: 0, rotation: ${tilt}, y: -70 }, { scale: 1, opacity: 1, rotation: 0, y: 0, duration: 0.24, ease: "power4.out" }, ${r3(at)});`);
      // Landing shake: three frames on the block, then rest. A word that lands before the shake is over replaces it
      // (its frames that would still be running are dropped): the reaction starts on its own cause, one at a time,
      // and the newest shake is the one that brings the block back to rest.
      const land = at + 0.2;
      const next = k + 1 < ats.length ? r3(ats[k + 1] + 0.2) : Infinity;
      [[9, -6], [-6, 4], [0, 0]].forEach(([x, y], f) => {
        const from = r3(land + f * 0.033);
        if (r3(from + 0.033) > next) return;
        t(`tl.to("#${id} .sctext", { x: ${Math.round(x * unit)}, y: ${Math.round(y * unit)}, duration: 0.033, ease: "none" }, ${from});`);
      });
    });
    // Exit: accelerating away while the opacity falls linearly to 0.15, then the clip's end is the hard cut. 0.2 s
    // against a 0.5 s entry: the inverse zoom-through's 30/70 split, the 75 % rule's cut-the-curve exception.
    if (turn) {
      const away = seamMotion(turn, "out", W, H);
      const turnOut = r3(sc.end - OUT_T);
      t(`tl.set("#${id}", { ${poseProps(away.from)} }, ${turnOut});`);
      t(`tl.to("#${id}", { ${poseProps(away.to)}, duration: ${away.duration}, ease: "${away.ease}" }, ${turnOut});`);
    } else {
      const out = r3(sc.end - 0.2);
      t(`tl.to("#${id} .scbgf", { scale: ${EXIT_SCALE}, filter: "blur(20px)", duration: 0.2, ease: "power3.in" }, ${out});`);
      t(`tl.to("#${id} .sctf", { scale: ${EXIT_SCALE}, filter: "blur(10px)", duration: 0.2, ease: "power3.in" }, ${out});`);
      t(`tl.to("#${id} .scbg", { opacity: 0.15, duration: 0.2, ease: "none" }, ${out});`);
      t(`tl.to("#${id} .sctext", { opacity: 0.15, duration: 0.2, ease: "none" }, ${out});`);
    }

    const lineHtml = lines.map((l) => `<div class="scl">${l.map((k) =>
      `<span class="scw${k === sc.emphasis ? " scem" : ""}" id="${id}w${k}"${blur}>${esc(words[k])}</span>`).join(" ")}</div>`).join("");
    return `    <div id="${id}" class="clip scene" data-start="${r3(sc.start)}" data-duration="${r3(sc.end - sc.start)}" data-track-index="10" style="z-index:6">
      <div class="scbgf"><div class="scbg" style="opacity:0"><div class="scblob"></div></div></div>
      ${rigged.has(i)
        ? `<div class="rig"><div class="rigcam"><div class="sctf"><div class="sctext" style="font-size:${fs}px">${lineHtml}</div></div></div></div>`
        : `<div class="sctf"><div class="sctext" style="font-size:${fs}px">${lineHtml}</div></div>`}
    </div>`;
  }).join("\n");
  const bg = style.scenes.background === "gradient"
    ? `radial-gradient(circle at 30% 35%, ${c.accent} 0%, rgba(0,0,0,0) 45%), radial-gradient(circle at 75% 70%, ${c.panel} 0%, rgba(0,0,0,0) 55%)`
    : "none";
  const css = `
      .scene { overflow: hidden; }
      .scbgf, .sctf { position: absolute; inset: 0; }
      .scbg { position: absolute; inset: 0; background: #07080c; }
      .scblob { position: absolute; inset: -30%; background: ${bg}; opacity: 0.55; }
      .sctext { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: center; align-items: center;
        gap: 0.04em; font-family: "${style.fonts.behind}"; font-weight: ${Math.max(800, style.fonts.behindWeight)}; line-height: 1;
        color: ${c.text}; text-align: center; }
      .scl { white-space: nowrap; }
      .scw { display: inline-block; text-shadow: 0 ${Math.round(8 * unit)}px ${Math.round(30 * unit)}px rgba(0,0,0,0.5); }
      .scem { color: ${c.accent}; text-shadow: ${extrude("rgba(0,0,0,0.6)", Math.round(10 * unit))}; }`;
  return { html, css };
}

/** One row of motion-doctrine's vector ledger (`references/seam-gate.md`): the side that leaves and the one that ignites. */
export interface SeamRow {
  id: string;
  /** The frame the incoming side ignites, on the master clock. */
  cut: number;
  technique: string;
  exit: { selector: string; axis: "x" | "y" | "z"; dir: 1 | -1 };
  entry: { selector: string; axis: "x" | "y" | "z"; dir: 1 | -1; scanRoot?: string };
}

/**
 * The seams of the typography scenes: the rush hands over to the scene at its start and takes the picture back at its
 * end. The rush is read on its deepest camera level (`.drift`, under `#cam > .push > .shake`), so every level counts.
 * Both sides carry the scene's own Z sign: that is the plan; a rush that does not follow it is what the gate reports.
 * No seam within the gate's 0.1 s window of the video's ends, where one side does not exist; two scenes that touch
 * make one seam.
 */
export function sceneSeams(scenes: Beats["scenes"], duration: number): SeamRow[] {
  const rush = RUSH;
  const dirIn = Math.sign(1 - ENTRY_SCALE) as 1 | -1;
  const dirOut = Math.sign(EXIT_SCALE - 1) as 1 | -1;
  const rows: SeamRow[] = [];
  scenes.forEach((sc, i) => {
    // A seam's vector: a portal pulls on Z (the scene's own sign); a cube or a flip moves on its axis, one way on both
    // sides (transitions.ts). The Z-sign scan only means something for a Z seam.
    const kind = sc.transition ?? "portal";
    const z = kind === "portal";
    const ax = kind === "portal" ? null : seamAxis(kind);
    const technique = ax ? kind : dirIn < 0 ? "inverse zoom-through" : "zoom-through";
    const v = (dir: 1 | -1) => ({ axis: ax ? ax.axis : ("z" as const), dir: ax ? ax.dir : dir });
    const scan = (root: string) => (z ? { scanRoot: root } : {});
    const prev = scenes[i - 1];
    const touches = prev && sc.start - prev.end < 1 / 30;
    if (!touches && sc.start >= 0.1) {
      rows.push({
        id: `rush→sc${i}`, cut: r3(sc.start), technique,
        exit: { selector: rush, ...v(dirIn) },
        entry: { selector: `#sc${i} .sctf`, ...v(dirIn), ...scan(`#sc${i}`) },
      });
    }
    const next = scenes[i + 1];
    if (next && next.start - sc.end < 1 / 30) {
      rows.push({
        id: `sc${i}→sc${i + 1}`, cut: r3(next.start), technique,
        exit: { selector: `#sc${i} .sctf`, ...v(dirOut) },
        entry: { selector: `#sc${i + 1} .sctf`, ...v(dirOut), ...scan(`#sc${i + 1}`) },
      });
    } else if (sc.end <= duration - 0.1) {
      rows.push({
        id: `sc${i}→rush`, cut: r3(sc.end), technique,
        exit: { selector: `#sc${i} .sctf`, ...v(dirOut) },
        entry: { selector: rush, ...v(dirOut), ...scan("#frame-cam") },
      });
    }
  });
  return rows;
}

/** The tab's title: the address without its scheme and path. */
const hostOf = (url?: string) => (url ? url.replace(/^\w+:\/\//, "").replace(/\/.*$/, "") : "Nouvel onglet");

export interface DeviceSlot {
  /** Video asset shown on the phone, its timeline window and its offset into the file. */
  src: string;
  start: number;
  end: number;
  from: number;
  /** "screen": a screen-recording part, covers the footage. "broll": under a reduced speaker (bubble). */
  role: "screen" | "broll";
  /** "phone" (default) or "browser": a desktop window in perspective (browser.ts). Compose decides it. */
  kind?: DeviceKind;
  /** The recording's width over its height: the browser's page keeps it. */
  aspect?: number;
  /** Address in the browser's bar. */
  url?: string;
}

/**
 * Screen recordings shown in a floating 3D phone over an animated stage: it rises in rotated, drifts slowly while it
 * plays and pushes out at the end. CSS 3D on a bezel around the video: no WebGL. Under a bubble the phone sits left
 * so the speaker does not cover it.
 */
export function buildDevices(
  slots: DeviceSlot[], style: Style, W: number, H: number, t: T, rigged: ReadonlySet<number> = new Set(),
  /** Hover frames already planned (planHovers), laid on the browsers. */
  hovers: Beats["hovers"] = [],
): { html: string; css: string } {
  if (!slots.length) return { html: "", css: "" };
  const c = style.colors;
  const vertical = H > W;
  const unit = Math.min(W, H) / 1080;
  const ph = Math.round(H * (vertical ? 0.72 : 0.86));
  const pw = Math.round(ph * 0.46);
  const html = slots.map((s, i) => {
    const id = `dv${i}`;
    const cx = s.role === "broll" && vertical ? W * 0.36 : s.role === "broll" ? W * 0.38 : W / 2;
    const cy = s.role === "broll" && vertical ? H * 0.56 : H / 2;
    const dur = s.end - s.start;
    const browser = s.kind === "browser";
    const g = browserGeometry(W, H, s.aspect ?? 16 / 9, s.role);
    const dev = browser ? ".browser" : ".phone";
    // 0.8 s: motion-doctrine's longest single entry (expo.out, so most of the travel lands in the first half).
    // A wide window turns less than a phone: the same Z handoff, a gentler yaw.
    t(browser
      ? `tl.fromTo("#${id} .browser", { rotationY: 24, rotationX: 10, z: -520, y: ${Math.round(220 * unit)}, opacity: 0 }, { rotationY: -8, rotationX: 4, z: 0, y: 0, opacity: 1, duration: 0.8, ease: "expo.out" }, ${r3(s.start)});`
      : `tl.fromTo("#${id} .phone", { rotationY: 38, rotationX: 14, z: -520, y: ${Math.round(220 * unit)}, opacity: 0 }, { rotationY: -10, rotationX: 5, z: 0, y: 0, opacity: 1, duration: 0.8, ease: "expo.out" }, ${r3(s.start)});`);
    // One slow turn while it plays (camera with intent, not a loop), then a zoom-through push out. The exit is
    // shorter than the 75 % rule: it is a Z seam (cut-the-curve), accelerating to the cut with its 18 px blur.
    // A phone with a camera move gives this turn up: the rig is its one camera.
    if (!rigged.has(i)) t(`tl.to("#${id} ${dev}", { rotationY: ${browser ? 6 : 9}, rotationX: ${browser ? -1 : -2}, y: ${Math.round(-28 * unit)}, duration: ${r3(Math.max(0.5, dur - 1.3))}, ease: "sine.inOut" }, ${r3(s.start + 0.8)});`);
    t(`tl.to("#${id} ${dev}", { scale: 1.35, z: 260, opacity: 0, duration: 0.45, ease: "power3.in" }, ${r3(s.end - 0.45)});`);
    // Full-surface blur (cut-the-curve: 18 px) rides the push on both ends. It sits on a wrapper: never on the
    // <video>, never in a tween with opacity (headless compositing bug), and the phone's 3D needs its own perspective
    // inside the filter, which flattens.
    t(`tl.set("#${id} .devblur", { filter: "blur(18px)" }, ${r3(s.start)});`);
    t(`tl.to("#${id} .devblur", { filter: "blur(0px)", duration: 0.5, ease: "expo.out" }, ${r3(s.start)});`);
    t(`tl.to("#${id} .devblur", { filter: "blur(18px)", duration: 0.45, ease: "power3.in" }, ${r3(s.end - 0.45)});`);
    t(`tl.fromTo("#${id} .devglow", { rotation: 0, scale: 1 }, { rotation: 30, scale: 1.2, duration: ${r3(dur)}, ease: "none" }, ${r3(s.start)});`);
    // The stage is not a timed clip: its video is (a video inside a timed wrapper gets the wrong frames). The stage
    // shows by opacity around the video's own window, like the cutout.
    t(`tl.set("#${id}", { opacity: 1 }, ${r3(s.start)});`);
    t(`tl.set("#${id}", { opacity: 0 }, ${r3(s.end)});`);
    const mine = browser ? hovers.filter((h) => h.target === id) : [];
    if (browser) {
      // The page scrolls on the nudge curve towards each hover frame; the frame lands on the page's instant.
      t(`tl.set("#${id} .bpage", { y: 0 }, ${r3(s.start)});`);
      for (const sc of scrollPlan({ target: id, start: s.start, end: s.end }, mine, g)) scrollTweens(`#${id} .bpage`, sc).forEach(t);
      for (const h of mine) {
        const hid = `${id}${h.id}`;
        t(`tl.set("#${hid}", { opacity: 0, scale: 1.12 }, 0);`);
        t(`tl.to("#${hid}", { opacity: 1, scale: 1, duration: 0.3, ease: "power3.out" }, ${r3(h.at)});`);
        t(`tl.to("#${hid}", { opacity: 0, duration: 0.2, ease: "power2.in" }, ${r3(h.at + h.duration - 0.2)});`);
      }
    }
    const pct = (v: number) => r3(v * 100);
    const body = browser
      ? `<div class="browser" style="left:${g.left}px;top:${g.top}px;width:${g.w}px;height:${g.chromeH + g.vpH}px">
          <div class="btabs" style="height:${Math.round(g.chromeH * 0.46)}px"><span class="bdot" style="background:#ff5f57"></span><span class="bdot" style="background:#febc2e"></span><span class="bdot" style="background:#28c840"></span><div class="btab">${esc(hostOf(s.url))}</div></div>
          <div class="brow" style="height:${g.chromeH - Math.round(g.chromeH * 0.46)}px"><div class="burl">${esc(s.url ?? "")}</div></div>
          <div class="bvp" style="height:${g.vpH}px">
            <div class="bpage" style="width:${g.pageW}px;height:${g.pageH}px">
              <video id="${id}v" src="${s.src}" data-start="${r3(s.start)}" data-duration="${r3(dur)}" data-media-start="${r3(s.from)}" data-track-index="11" muted playsinline></video>
              ${mine.map((h) => `<div class="bhover" id="${id}${h.id}" style="left:${pct(h.x)}%;top:${pct(h.y)}%;width:${pct(h.w)}%;height:${pct(h.h)}%;opacity:0">${h.label ? `<span class="bhlabel">${esc(h.label)}</span>` : ""}</div>`).join("")}
            </div>
          </div>
        </div>`
      : `<div class="phone" style="left:${Math.round(cx - pw / 2)}px;top:${Math.round(cy - ph / 2)}px">
        <video id="${id}v" src="${s.src}" data-start="${r3(s.start)}" data-duration="${r3(dur)}" data-media-start="${r3(s.from)}" data-track-index="11" muted playsinline></video>
        <div class="island"></div>
      </div>`;
    return `    <div id="${id}" class="devstage" style="opacity:0;z-index:${s.role === "screen" ? 2 : 0}">
      <div class="devglow"></div>
      <div class="devblur">
      ${rigged.has(i) ? `<div class="devrig rigcam" style="transform-origin:${Math.round(cx)}px ${Math.round(cy)}px">` : ""}${body}${rigged.has(i) ? "</div>" : ""}
      </div>
    </div>`;
  }).join("\n");
  const css = `
      .devstage { position: absolute; inset: 0; overflow: hidden; background: #06070b; }
      .devblur { position: absolute; inset: 0; perspective: ${Math.round(1800 * unit)}px; }
      .devrig { position: absolute; inset: 0; transform-style: preserve-3d; }
      .devglow { position: absolute; inset: -25%;
        background: radial-gradient(circle at 35% 30%, ${c.accent} 0%, rgba(0,0,0,0) 40%),
                    radial-gradient(circle at 70% 75%, ${c.panel} 0%, rgba(0,0,0,0) 50%); opacity: 0.5; }
      .phone { position: absolute; width: ${pw}px; height: ${ph}px; border-radius: ${Math.round(pw * 0.14)}px; background: #000;
        border: ${Math.round(pw * 0.03)}px solid #15171c; overflow: hidden; transform-style: preserve-3d;
        box-shadow: 0 ${Math.round(60 * unit)}px ${Math.round(140 * unit)}px rgba(0,0,0,0.7), 0 0 0 ${Math.max(2, Math.round(3 * unit))}px #3a3d45; }
      .phone video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
      .browser { position: absolute; border-radius: ${Math.round(14 * unit)}px; background: #1b1d23; overflow: hidden;
        font-family: Inter, sans-serif; box-shadow: 0 ${Math.round(60 * unit)}px ${Math.round(140 * unit)}px rgba(0,0,0,0.7), 0 0 0 ${Math.max(2, Math.round(2 * unit))}px #3a3d45; }
      .btabs { display: flex; align-items: center; gap: ${Math.round(8 * unit)}px; padding: ${Math.round(10 * unit)}px ${Math.round(14 * unit)}px 0; box-sizing: border-box; }
      .bdot { width: ${Math.round(12 * unit)}px; height: ${Math.round(12 * unit)}px; border-radius: 50%; display: inline-block; }
      .btab { margin-left: ${Math.round(14 * unit)}px; align-self: flex-end; padding: ${Math.round(6 * unit)}px ${Math.round(22 * unit)}px; border-radius: ${Math.round(8 * unit)}px ${Math.round(8 * unit)}px 0 0;
        background: #2a2d35; color: #c9ccd3; font-size: ${Math.round(15 * unit)}px; white-space: nowrap; }
      .brow { background: #2a2d35; display: flex; align-items: center; padding: 0 ${Math.round(14 * unit)}px; box-sizing: border-box; }
      .burl { flex: 1; height: 70%; border-radius: 999px; background: #1b1d23; color: #aeb2bb; font-size: ${Math.round(16 * unit)}px; display: flex; align-items: center; padding: 0 ${Math.round(18 * unit)}px; }
      .bvp { position: relative; overflow: hidden; background: #fff; }
      .bpage { position: absolute; left: 0; top: 0; }
      .bpage video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: fill; }
      .bhover { position: absolute; box-sizing: border-box; border: ${Math.max(3, Math.round(4 * unit))}px solid ${c.accent}; border-radius: ${Math.round(10 * unit)}px;
        box-shadow: 0 0 0 ${Math.round(2 * unit)}px rgba(0,0,0,0.35), 0 0 ${Math.round(28 * unit)}px ${c.accent}; }
      .bhlabel { position: absolute; left: -2px; bottom: 100%; margin-bottom: ${Math.round(6 * unit)}px; padding: ${Math.round(4 * unit)}px ${Math.round(12 * unit)}px; border-radius: ${Math.round(6 * unit)}px;
        background: ${c.accent}; color: #000; font: 700 ${Math.round(18 * unit)}px Inter, sans-serif; white-space: nowrap; }
      .island { position: absolute; top: ${Math.round(pw * 0.03)}px; left: 50%; width: ${Math.round(pw * 0.3)}px; height: ${Math.round(pw * 0.085)}px;
        margin-left: -${Math.round(pw * 0.15)}px; border-radius: 999px; background: #000; }`;
  return { html, css };
}
