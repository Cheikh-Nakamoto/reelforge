import type { Style } from "../lib/style.js";
import type { Beats } from "./beats.js";
import type { MatteReport } from "./matte.js";
import { placeBehind, type Mask, type Placement } from "./placement.js";

export interface Format {
  id: "16x9" | "9x16";
  width: number;
  height: number;
}

export const FORMATS: Record<Format["id"], Format> = {
  "16x9": { id: "16x9", width: 1920, height: 1080 },
  "9x16": { id: "9x16", width: 1080, height: 1920 },
};

export type LayoutMode = "cover" | "pillar";

export interface Layout {
  mode: LayoutMode;
  /** Displayed footage box in composition pixels. */
  box: { x: number; y: number; w: number; h: number };
  /** CSS object-position for cover mode (x %). */
  posX: number;
}

/**
 * Fit the footage into the frame. Same shape (±12 %) or a narrower target: crop (cover), keeping the subject's
 * horizontal centre in frame. A wider target than the footage (vertical rush → 16:9): full-height footage centred
 * over a blurred copy of itself (pillar).
 */
export function computeLayout(src: { width: number; height: number }, f: Format, centerX: number): Layout {
  const sa = src.width / src.height;
  const ta = f.width / f.height;
  if (ta > sa * 1.12) {
    const h = f.height, w = Math.round(h * sa);
    return { mode: "pillar", box: { x: Math.round((f.width - w) / 2), y: 0, w, h }, posX: 50 };
  }
  const s = Math.max(f.width / src.width, f.height / src.height);
  const dw = src.width * s, dh = src.height * s;
  // Visible window centred on the subject, clamped inside the footage.
  const left = Math.min(Math.max(centerX * dw - f.width / 2, 0), Math.max(0, dw - f.width));
  const posX = dw > f.width ? (left / (dw - f.width)) * 100 : 50;
  return { mode: "cover", box: { x: -Math.round(left), y: Math.round((f.height - dh) / 2), w: Math.round(dw), h: Math.round(dh) }, posX: r1(posX) };
}

/** Normalized source point → composition pixels. */
function toComp(l: Layout, u: number, v: number) {
  return { x: l.box.x + u * l.box.w, y: l.box.y + v * l.box.h };
}

/** Rough advance width per character (em) for the display faces, used to fit a word to the frame. */
const CHAR_EM: Record<string, number> = {
  "League Gothic": 0.4, Oswald: 0.5, "Archivo Black": 0.72, "Playfair Display": 0.58, Montserrat: 0.68,
  Inter: 0.6, Poppins: 0.64, "EB Garamond": 0.5,
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const r1 = (x: number) => Math.round(x * 10) / 10;
const r3 = (x: number) => Math.round(x * 1000) / 1000;

export interface HtmlInput {
  beats: Beats;
  style: Style;
  format: Format;
  src: { width: number; height: number };
  matte: MatteReport | null;
  hasCutout: boolean;
  /** Alpha samples of the cutout during each behind-word (by beat id): the word is placed on the real matte. */
  masks?: Record<string, Mask[]>;
}

export function buildHtml(input: HtmlInput): string {
  return buildComposition(input).html;
}

export function buildComposition({ beats, style, format: f, src, matte, hasCutout, masks }: HtmlInput): {
  html: string;
  placements: Record<string, Placement>;
} {
  const placements: Record<string, Placement> = {};
  const W = f.width, H = f.height, D = r3(beats.duration);
  const layout = computeLayout(src, f, matte?.centerX ?? 0.5);
  const unit = Math.min(W, H) / 1080;
  const vertical = H > W;
  const c = style.colors;
  const tlLines: string[] = [];
  const t = (s: string) => tlLines.push("      " + s);

  // ---------- footage
  const videoCss = layout.mode === "pillar"
    ? `left:${layout.box.x}px;top:0;width:${layout.box.w}px;height:${H}px;object-fit:cover;`
    : `left:0;top:0;width:${W}px;height:${H}px;object-fit:cover;object-position:${layout.posX}% 50%;`;
  const originX = layout.mode === "pillar" ? 50 : r1(((toComp(layout, matte?.centerX ?? 0.5, 0).x) / W) * 100);
  // The look (grade, vignette, grain) is baked into the assets by FFmpeg before composing: see steps/look.ts.
  const bgVideo = layout.mode === "pillar"
    ? `    <video id="bg" src="assets/bg.mp4" data-start="0" data-duration="${D}" data-media-start="0" data-track-index="0" muted playsinline style="position:absolute;left:0;top:0;width:${W}px;height:${H}px;object-fit:cover;z-index:0"></video>\n`
    : "";

  // Caption zone, computed first: behind-words must stay above it.
  const capSize = Math.round(style.captions.size * unit * (vertical ? 1.15 : 1));
  const capCenterY = Math.round(H * (style.captions.position === "mid" ? (vertical ? 0.58 : 0.62) : vertical ? 0.71 : 0.86));
  const capTop = capCenterY - capSize;

  // Framing scale of the jump-cut zoom at time t (same rule as the timeline below).
  const jumpSteps: { at: number; scale: number }[] = [];
  if (style.motion.jumpZoom > 1) {
    let tight = false;
    beats.cuts.forEach((at, k) => {
      if ((beats.cuts[k + 1] ?? D) - at < 0.8) return;
      tight = !tight;
      jumpSteps.push({ at, scale: tight ? style.motion.jumpZoom : 1 });
    });
  }
  const scaleAt = (time: number) => jumpSteps.filter((x) => x.at <= time).pop()?.scale ?? 1;
  const originYpx = H * 0.4;

  // ---------- behind words
  const behindHtml = beats.behind.map((b, i) => {
    const font = style.fonts.behind;
    const text = b.text.toUpperCase();
    const em = CHAR_EM[font] ?? 0.6;
    const fsMax = Math.min(style.behind.size * H, (W * 0.94) / Math.max(1, text.length * em));
    // Bottom of the word stays clear of the caption zone (check: content_overlap).
    const maxBottom = (style.captions.enabled && !style.behind.hideCaptions ? capTop : H) - H * 0.03;
    let fs: number, cy: number;
    const samples = masks?.[b.id];
    if (samples?.length) {
      // Measured: the share of the word the subject hides, on the cutout's own alpha at this moment.
      const p = placeBehind({
        masks: samples, layout, W, H, scale: scaleAt(b.start), origin: { x: (originX / 100) * W, y: originYpx },
        em, chars: text.length, fsMax, maxBottom, target: style.behind.coverage,
      });
      placements[b.id] = p;
      ({ fs, cy } = p);
    } else {
      // Estimated from the 1 fps survey: just under the top of the head.
      const at = nearestBox(matte, b.start);
      const headY0 = at ? toComp(layout, 0, at.y0).y : H * 0.25;
      const headY = originYpx + (headY0 - originYpx) * scaleAt(b.start);
      fs = Math.max(Math.min(fsMax, (maxBottom - headY) / 1.05), H * 0.1);
      cy = Math.max(Math.min(headY + fs * 0.55, maxBottom - fs / 2), fs / 2 + H * 0.03);
    }
    const id = `bh${i}`;
    const anim = style.behind.animation;
    const dur = r3(b.end - b.start);
    if (anim === "slam") {
      t(`tl.fromTo("#${id} .w", { scale: 1.45, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.28, ease: "power4.out" }, ${r3(b.start)});`);
      t(`tl.to("#${id} .w", { scale: 1.05, duration: ${r3(dur - 0.5)}, ease: "none" }, ${r3(b.start + 0.28)});`);
    } else if (anim === "rise") {
      t(`tl.fromTo("#${id} .w", { yPercent: 60, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 0.45, ease: "${style.motion.ease}" }, ${r3(b.start)});`);
    } else {
      // Tracking-in with transforms only (letterSpacing snaps to device pixels and stutters frame by frame):
      // each letter starts pushed away from the centre and slides home.
      t(`tl.set("#${id} .w", { opacity: 1 }, ${r3(b.start)});`);
      [...text].forEach((_, k) => {
        const push = Math.round((k - (text.length - 1) / 2) * fs * 0.12);
        t(`tl.fromTo("#${id} .l${k}", { x: ${push}, opacity: 0 }, { x: 0, opacity: 1, duration: 0.7, ease: "${style.motion.ease}" }, ${r3(b.start)});`);
      });
    }
    t(`tl.to("#${id} .w", { opacity: 0, duration: 0.22, ease: "power2.in" }, ${r3(b.end - 0.22)});`);
    return `    <div id="${id}" class="clip behind" data-start="${r3(b.start)}" data-duration="${dur}" data-track-index="2" data-layout-allow-overflow style="z-index:2">
      <div class="w" style="top:${Math.round(cy - fs / 2)}px;font-size:${Math.round(fs)}px;line-height:${Math.round(fs)}px${anim === "track" ? ";opacity:0" : ""}">${
        anim === "track" ? [...text].map((ch, k) => `<span class="l${k}" style="display:inline-block">${esc(ch)}</span>`).join("") : esc(text)
      }</div>
    </div>`;
  }).join("\n");

  // Show the cutout only around behind-words (identical pixels to the footage, so the switch is invisible).
  if (hasCutout) {
    t(`tl.set("#cutout-wrap", { opacity: 0 }, 0);`);
    for (const b of beats.behind) {
      t(`tl.set("#cutout-wrap", { opacity: 1 }, ${r3(Math.max(0, b.start - 0.1))});`);
      t(`tl.set("#cutout-wrap", { opacity: 0 }, ${r3(b.end + 0.05)});`);
    }
  }
  // Camera moves apply to both stacks (.cam = footage under the words, cutout above them) with the same values, so
  // the cutout stays registered on the footage. Two nested levels: .cam alternates framing on jump cuts, .push
  // punches in during behind-words. One baseline each, then plain tweens (repeated fromTo would leak into seeks).
  // A sliver of a take keeps the current framing: alternating on it would read as a flicker.
  if (jumpSteps.length) {
    t(`tl.set(".cam", { scale: 1 }, 0);`);
    for (const j of jumpSteps) t(`tl.set(".cam", { scale: ${j.scale} }, ${r3(j.at)});`);
  }
  if (style.motion.punchIn > 1 && beats.behind.length) {
    t(`tl.set(".push", { scale: 1 }, 0);`);
    for (const b of beats.behind) {
      t(`tl.to(".push", { scale: ${style.motion.punchIn}, duration: ${r3(b.end - b.start)}, ease: "power1.out" }, ${r3(b.start)});`);
      t(`tl.to(".push", { scale: 1, duration: 0.35, ease: "power2.inOut" }, ${r3(b.end)});`);
    }
  }

  // ---------- motion graphics
  let listN = 0;
  const mgX = vertical ? 0 : Math.round(W * 0.06);
  const mgY = Math.round(H * (vertical ? 0.075 : 0.09));
  const mgHtml = beats.mographs.map((m, i) => {
    const id = `mg${i}`;
    const dur = r3(m.end - m.start);
    const s = r3(m.start);
    const align = vertical ? "center" : "left";
    let inner = "";
    if (m.kind === "counter") {
      const big = Math.round((vertical ? 150 : 140) * unit);
      inner = `<div class="panel counter"><div class="num" style="font-size:${big}px">0${esc(m.suffix ?? "")}</div>` +
        (m.label ? `<div class="lbl">${esc(m.label)}</div>` : "") + `</div>`;
      t(`tl.fromTo("#${id} .panel", { y: 40, opacity: 0 }, { y: 0, opacity: 1, duration: 0.35, ease: "back.out(1.6)" }, ${s});`);
      t(`(() => { const o = { v: 0 }; const el = document.querySelector("#${id} .num"); ` +
        `tl.to(o, { v: ${m.value ?? 0}, duration: 0.9, ease: "power2.out", onUpdate: () => { el.textContent = fmt(o.v, ${m.value ?? 0}) + ${JSON.stringify(m.suffix ?? "")}; } }, ${r3(m.start + 0.1)}); })();`);
    } else if (m.kind === "underline") {
      inner = `<div class="panel plain"><div class="kw">${esc(m.text.toUpperCase())}</div><div class="bar"></div></div>`;
      t(`tl.fromTo("#${id} .kw", { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.3, ease: "${style.motion.ease}" }, ${s});`);
      t(`tl.fromTo("#${id} .bar", { scaleX: 0 }, { scaleX: 1, duration: 0.45, ease: "power3.inOut" }, ${r3(m.start + 0.2)});`);
    } else {
      const chip = m.kind === "callout" ? `<span class="chip">!</span>` : m.kind === "list" ? `<span class="chip">${++listN}</span>` : "";
      const cls = m.kind === "badge" ? "pill outline" : "pill";
      inner = `<div class="${cls}">${chip}<span>${esc(m.text.toUpperCase())}</span></div>`;
      t(`tl.fromTo("#${id} .pill", { x: ${vertical ? 0 : -80}, y: ${vertical ? -30 : 0}, opacity: 0 }, { x: 0, y: 0, opacity: 1, duration: 0.35, ease: "${style.motion.ease}" }, ${s});`);
    }
    t(`tl.to("#${id} > div", { opacity: 0, duration: 0.25, ease: "power2.in" }, ${r3(m.end - 0.25)});`);
    return `    <div id="${id}" class="clip mg" data-start="${s}" data-duration="${dur}" data-track-index="3" style="z-index:4">
      <div class="mg-pos" style="left:${mgX}px;top:${mgY}px;${vertical ? `width:${W}px;` : ""}text-align:${align}">${inner}</div>
    </div>`;
  }).join("\n");

  // ---------- captions
  // With hideCaptions, a group sharing the screen with a behind-word steps aside: the word is the caption.
  const shown = style.behind.hideCaptions
    ? beats.captions.filter((g) => !beats.behind.some((b) => Math.min(g.end, b.end) - Math.max(g.start, b.start) > 0.15))
    : beats.captions;
  const capHtml = shown.map((g) => {
    const words = g.words.map((w, j) =>
      `<span class="cw" id="${g.id}w${j}">${esc(style.captions.uppercase ? w.text.toUpperCase() : w.text)}</span>`).join(" ");
    const s = r3(g.start), e = r3(g.end);
    const anim = style.captions.animation;
    if (anim === "pop") {
      t(`tl.fromTo("#${g.id} .ci", { scale: 0.82, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.18, ease: "back.out(2.2)" }, ${s});`);
    } else if (anim === "rise") {
      t(`tl.set("#${g.id} .ci", { opacity: 1 }, ${s});`);
      g.words.forEach((w, j) =>
        t(`tl.fromTo("#${g.id}w${j}", { y: ${Math.round(capSize * 0.45)}, opacity: 0 }, { y: 0, opacity: 1, duration: 0.2, ease: "power3.out" }, ${r3(Math.max(g.start, w.start - 0.04))});`));
    } else {
      t(`tl.fromTo("#${g.id} .ci", { opacity: 0 }, { opacity: 1, duration: 0.12 }, ${s});`);
      g.words.forEach((w, j) =>
        t(`tl.fromTo("#${g.id}w${j}", { color: "${c.text}", opacity: 0.45 }, { color: "${c.accent}", opacity: 1, duration: ${r3(Math.max(0.08, w.end - w.start))}, ease: "none" }, ${r3(w.start)});`));
    }
    if (style.captions.highlightActive && anim !== "karaoke") {
      g.words.forEach((w, j) => {
        t(`tl.set("#${g.id}w${j}", { color: "${c.accent}" }, ${r3(w.start)});`);
        t(`tl.set("#${g.id}w${j}", { color: "${c.text}" }, ${r3(Math.min(e, w.end + 0.02))});`);
      });
    }
    t(`tl.to("#${g.id} .ci", { opacity: 0, duration: 0.1, ease: "power2.in" }, ${r3(Math.max(g.start + 0.15, e - 0.1))});`);
    return `      <div id="${g.id}" class="clip cg" data-start="${s}" data-duration="${r3(e - g.start)}"><div class="ci">${words}</div></div>`;
  }).join("\n");

  if (style.look.grain > 0) for (const g of grainSets(D)) t(g);

  const behindFont = style.fonts.behind;
  const html = `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${W}, height=${H}" />
    <script src="assets/gsap.min.js"></script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: ${W}px; height: ${H}px; overflow: hidden; background: #000; }
      #root { position: relative; width: ${W}px; height: ${H}px; overflow: hidden; background: #000; }
      .clip { position: absolute; inset: 0; }
      /* Two camera stacks, kept in lockstep: footage (z 1) under the behind-words (z 2), cutout (z 3) above them.
         Each stack is its own stacking context, so the cutout cannot sit inside the footage's. */
      .cam, .push { position: absolute; inset: 0; transform-origin: ${originX}% 40%; }
      #cam { z-index: 1; }
      #cutcam { z-index: 3; }
      .cam video { position: absolute; ${videoCss} }
      #cutout-wrap { position: absolute; inset: 0; }
      /* Film grain over footage, words and cutout alike, under the graphics. */
      #grain { position: absolute; left: -256px; top: -256px; width: ${W + 512}px; height: ${H + 512}px; z-index: 4;
        background: url("assets/grain.png") repeat; mix-blend-mode: overlay; pointer-events: none; }
      .bar-lb { position: absolute; left: 0; width: ${W}px; background: #000; z-index: 5; }
      .behind .w { position: absolute; left: 0; width: ${W}px; text-align: center; white-space: nowrap;
        font-family: "${behindFont}"; font-weight: ${style.fonts.behindWeight}; color: ${c.behind}; letter-spacing: 0.02em; }
      .mg-pos { position: absolute; }
      .panel { display: inline-block; padding: ${Math.round(18 * unit)}px ${Math.round(34 * unit)}px; border-radius: ${Math.round(22 * unit)}px;
        background: ${c.panel}; color: ${c.text}; font-family: "${style.fonts.graphic}"; }
      .panel.plain { background: transparent; padding: 0; }
      .counter .num { font-weight: 900; line-height: 1; color: ${c.accent}; font-variant-numeric: tabular-nums; }
      .counter .lbl { font-size: ${Math.round(40 * unit)}px; font-weight: 700; margin-top: ${Math.round(8 * unit)}px; text-transform: uppercase; letter-spacing: 0.06em; }
      .kw { font-size: ${Math.round(96 * unit)}px; font-weight: 900; color: ${c.text}; text-shadow: 0 6px 28px rgba(0,0,0,0.5); }
      .bar { height: ${Math.round(12 * unit)}px; background: ${c.accent}; border-radius: 99px; transform-origin: 0 50%; margin-top: ${Math.round(6 * unit)}px; }
      .pill { display: inline-flex; align-items: center; gap: ${Math.round(16 * unit)}px; padding: ${Math.round(16 * unit)}px ${Math.round(34 * unit)}px;
        border-radius: 999px; background: ${c.accent}; color: #111; font-family: "${style.fonts.graphic}"; font-weight: 900;
        font-size: ${Math.round(46 * unit)}px; letter-spacing: 0.04em; box-shadow: 0 12px 40px rgba(0,0,0,0.35); }
      .pill.outline { background: ${c.panel}; color: ${c.text}; border: ${Math.max(2, Math.round(4 * unit))}px solid ${c.accent}; }
      .chip { display: inline-grid; place-items: center; width: 1.4em; height: 1.4em; border-radius: 50%; background: #111; color: ${c.accent}; font-size: 0.8em; }
      #captions { position: absolute; inset: 0; z-index: 6; }
      .cg { position: absolute; inset: auto; left: 0; width: ${W}px; top: ${capTop}px; display: flex; justify-content: center; }
      .ci { max-width: ${Math.round(W * (vertical ? 0.86 : 0.8))}px; text-align: center; opacity: 0;
        font-family: "${style.fonts.caption}"; font-weight: ${style.fonts.captionWeight}; font-size: ${capSize}px; line-height: 1.12;
        color: ${c.text}; ${style.captions.box
          ? `background: ${c.panel}; padding: ${r1(capSize * 0.18)}px ${r1(capSize * 0.42)}px; border-radius: ${r1(capSize * 0.28)}px;`
          : `-webkit-text-stroke: ${r1(capSize * 0.07)}px ${c.stroke}; paint-order: stroke fill;
        text-shadow: 0 ${Math.round(4 * unit)}px ${Math.round(18 * unit)}px rgba(0,0,0,0.55);`} }
      .cw { display: inline-block; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${D}" data-width="${W}" data-height="${H}">
${bgVideo}    <div id="cam" class="cam"><div class="push">
      <video id="base" src="assets/cut.mp4" data-start="0" data-duration="${D}" data-media-start="0" data-track-index="1" muted playsinline></video>
    </div></div>
${behindHtml}
${grainLayer(style)}${hasCutout ? `    <div id="cutcam" class="cam"><div class="push">
      <div id="cutout-wrap" data-layout-allow-occlusion>
        <video id="cutout" src="assets/subject.webm" data-start="0" data-duration="${D}" data-media-start="0" data-track-index="4" muted playsinline></video>
      </div>
    </div></div>\n` : ""}${letterbox(style, W, H)}
${mgHtml}
    <div id="captions" class="clip" data-start="0" data-duration="${D}" data-track-index="5" data-track-kind="captions">
${capHtml}
    </div>
    </div>
    <script>
      window.__timelines = window.__timelines || {};
      const fmt = (v, target) => {
        const n = Number.isInteger(target) ? Math.round(v) : Math.round(v * 10) / 10;
        return String(n).replace(/\\B(?=(\\d{3})+(?!\\d))/g, "\\u202f");
      };
      const tl = gsap.timeline({ paused: true });
${tlLines.join("\n")}
      tl.set({}, {}, ${D});
      window.__timelines["main"] = tl;
    </script>
  </body>
</html>
`;
  return { html, placements };
}

/** Grain overlay markup (its seeded jumps are added to the timeline by `grainSets`). */
function grainLayer(style: Style): string {
  return style.look.grain > 0 ? `    <div id="grain" style="opacity:${r3(0.08 + 0.32 * style.look.grain)}"></div>\n` : "";
}

/**
 * Grain: a noise tile in overlay blend, jumped to a new seeded offset 12 times a second like film. It sits above the
 * cutout so footage and subject share one grain. Seeded LCG: the same frames every render.
 */
function grainSets(D: number): string[] {
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const out: string[] = [];
  for (let k = 0; k * (1 / 12) < D; k++) {
    out.push(`tl.set("#grain", { x: ${Math.round(rnd() * 256)}, y: ${Math.round(rnd() * 256)} }, ${r3(k / 12)});`);
  }
  return out;
}

/** Black bars to `look.letterbox` (landscape only: a vertical frame has no room to spare). */
function letterbox(style: Style, W: number, H: number): string {
  const ratio = style.look.letterbox;
  if (!ratio || H > W || W / H >= ratio) return "";
  const bar = Math.round((H - W / ratio) / 2);
  return `    <div id="lb-top" class="bar-lb" style="top:0;height:${bar}px"></div>
    <div id="lb-bottom" class="bar-lb" style="bottom:0;height:${bar}px"></div>\n`;
}

function nearestBox(m: MatteReport | null, t: number) {
  if (!m?.track.length) return null;
  let best = m.track[0];
  for (const b of m.track) if (Math.abs(b.t - t) < Math.abs(best.t - t)) best = b;
  return best.x1 > best.x0 ? best : null;
}
