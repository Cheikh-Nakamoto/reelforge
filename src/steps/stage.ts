import { CHAR_EM, esc, extrude, r3 } from "../lib/markup.js";
import type { Style } from "../lib/style.js";
import type { Beats } from "./beats.js";

type T = (line: string) => void;

/**
 * Full-screen kinetic typography (the punchline device of top short-form edits): an animated background lands over
 * the picture in an inverse zoom-through and each word slams in when it is spoken, overshooting from far, with a
 * three-frame landing shake on the block. The key word takes the accent colour and an extruded face. Captions step aside while a scene is on.
 */
export function buildScenes(scenes: Beats["scenes"], style: Style, W: number, H: number, blur: string, t: T): { html: string; css: string } {
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
    t(`tl.set("#${id} .scbgf", { scale: 1.25, filter: "blur(20px)" }, ${r3(sc.start)});`);
    t(`tl.to("#${id} .scbgf", { scale: 1, filter: "blur(0px)", duration: ${io}, ease: "expo.out" }, ${r3(sc.start)});`);
    t(`tl.set("#${id} .sctf", { scale: 1.25, filter: "blur(10px)" }, ${r3(sc.start)});`);
    t(`tl.to("#${id} .sctf", { scale: 1, filter: "blur(0px)", duration: ${io}, ease: "expo.out" }, ${r3(sc.start)});`);
    t(`tl.set("#${id} .scbg", { opacity: 0.15 }, ${r3(sc.start)});`);
    t(`tl.to("#${id} .scbg", { opacity: 1, duration: ${io}, ease: "expo.out" }, ${r3(sc.start)});`);
    t(`tl.set("#${id} .sctext", { x: 0, y: 0, scale: 1, opacity: 1 }, ${r3(sc.start)});`);
    t(`tl.to("#${id} .scblob", { rotation: 40, xPercent: 12, duration: ${r3(sc.end - sc.start)}, ease: "none" }, ${r3(sc.start)});`);
    sc.words.forEach((w, k) => {
      if (k >= words.length) return;
      const at = Math.max(sc.start + 0.02, w.start - 0.04);
      const tilt = k % 2 ? 7 : -7;
      t(`tl.fromTo("#${id}w${k}", { scale: 2.6, opacity: 0, rotation: ${tilt}, y: -70 }, { scale: 1, opacity: 1, rotation: 0, y: 0, duration: 0.24, ease: "power4.out" }, ${r3(at)});`);
      // Landing shake: three frames on the block, then rest.
      const land = at + 0.2;
      [[9, -6], [-6, 4], [0, 0]].forEach(([x, y], f) =>
        t(`tl.to("#${id} .sctext", { x: ${Math.round(x * unit)}, y: ${Math.round(y * unit)}, duration: 0.033, ease: "none" }, ${r3(land + f * 0.033)});`));
    });
    // Exit: accelerating away while the opacity falls linearly to 0.15, then the clip's end is the hard cut.
    const out = r3(sc.end - 0.2);
    t(`tl.to("#${id} .scbgf", { scale: 0.8, filter: "blur(20px)", duration: 0.2, ease: "power3.in" }, ${out});`);
    t(`tl.to("#${id} .sctf", { scale: 0.8, filter: "blur(10px)", duration: 0.2, ease: "power3.in" }, ${out});`);
    t(`tl.to("#${id} .scbg", { opacity: 0.15, duration: 0.2, ease: "none" }, ${out});`);
    t(`tl.to("#${id} .sctext", { opacity: 0.15, duration: 0.2, ease: "none" }, ${out});`);

    const lineHtml = lines.map((l) => `<div class="scl">${l.map((k) =>
      `<span class="scw${k === sc.emphasis ? " scem" : ""}" id="${id}w${k}"${blur}>${esc(words[k])}</span>`).join(" ")}</div>`).join("");
    return `    <div id="${id}" class="clip scene" data-start="${r3(sc.start)}" data-duration="${r3(sc.end - sc.start)}" data-track-index="10" style="z-index:6">
      <div class="scbgf"><div class="scbg" style="opacity:0"><div class="scblob"></div></div></div>
      <div class="sctf"><div class="sctext" style="font-size:${fs}px">${lineHtml}</div></div>
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

export interface DeviceSlot {
  /** Video asset shown on the phone, its timeline window and its offset into the file. */
  src: string;
  start: number;
  end: number;
  from: number;
  /** "screen": a screen-recording part, covers the footage. "broll": under a reduced speaker (bubble). */
  role: "screen" | "broll";
}

/**
 * Screen recordings shown in a floating 3D phone over an animated stage: it rises in rotated, drifts slowly while it
 * plays and pushes out at the end. CSS 3D on a bezel around the video: no WebGL. Under a bubble the phone sits left
 * so the speaker does not cover it.
 */
export function buildDevices(slots: DeviceSlot[], style: Style, W: number, H: number, t: T): { html: string; css: string } {
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
    t(`tl.fromTo("#${id} .phone", { rotationY: 38, rotationX: 14, z: -520, y: ${Math.round(220 * unit)}, opacity: 0 }, { rotationY: -10, rotationX: 5, z: 0, y: 0, opacity: 1, duration: 0.9, ease: "expo.out" }, ${r3(s.start)});`);
    t(`tl.to("#${id} .phone", { rotationY: 9, rotationX: -2, y: ${Math.round(-28 * unit)}, duration: ${r3(Math.max(0.5, dur - 1.4))}, ease: "sine.inOut" }, ${r3(s.start + 0.9)});`);
    t(`tl.to("#${id} .phone", { scale: 1.35, z: 260, opacity: 0, duration: 0.45, ease: "power3.in" }, ${r3(s.end - 0.45)});`);
    t(`tl.fromTo("#${id} .devglow", { rotation: 0, scale: 1 }, { rotation: 30, scale: 1.2, duration: ${r3(dur)}, ease: "none" }, ${r3(s.start)});`);
    // The stage is not a timed clip: its video is (a video inside a timed wrapper gets the wrong frames). The stage
    // shows by opacity around the video's own window, like the cutout.
    t(`tl.set("#${id}", { opacity: 1 }, ${r3(s.start)});`);
    t(`tl.set("#${id}", { opacity: 0 }, ${r3(s.end)});`);
    return `    <div id="${id}" class="devstage" style="opacity:0;z-index:${s.role === "screen" ? 2 : 0}">
      <div class="devglow"></div>
      <div class="phone" style="left:${Math.round(cx - pw / 2)}px;top:${Math.round(cy - ph / 2)}px">
        <video id="${id}v" src="${s.src}" data-start="${r3(s.start)}" data-duration="${r3(dur)}" data-media-start="${r3(s.from)}" data-track-index="11" muted playsinline></video>
        <div class="island"></div>
      </div>
    </div>`;
  }).join("\n");
  const css = `
      .devstage { position: absolute; inset: 0; overflow: hidden; perspective: ${Math.round(1800 * unit)}px; background: #06070b; }
      .devglow { position: absolute; inset: -25%;
        background: radial-gradient(circle at 35% 30%, ${c.accent} 0%, rgba(0,0,0,0) 40%),
                    radial-gradient(circle at 70% 75%, ${c.panel} 0%, rgba(0,0,0,0) 50%); opacity: 0.5; }
      .phone { position: absolute; width: ${pw}px; height: ${ph}px; border-radius: ${Math.round(pw * 0.14)}px; background: #000;
        border: ${Math.round(pw * 0.03)}px solid #15171c; overflow: hidden; transform-style: preserve-3d;
        box-shadow: 0 ${Math.round(60 * unit)}px ${Math.round(140 * unit)}px rgba(0,0,0,0.7), 0 0 0 ${Math.max(2, Math.round(3 * unit))}px #3a3d45; }
      .phone video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
      .island { position: absolute; top: ${Math.round(pw * 0.03)}px; left: 50%; width: ${Math.round(pw * 0.3)}px; height: ${Math.round(pw * 0.085)}px;
        margin-left: -${Math.round(pw * 0.15)}px; border-radius: 999px; background: #000; }`;
  return { html, css };
}
