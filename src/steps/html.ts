import type { Style } from "../lib/style.js";
import type { Beats } from "./beats.js";
import type { MatteReport } from "./matte.js";
import { placeBehind, type Mask, type Placement } from "./placement.js";
import { CHAR_EM, esc, extrude, r1, r3 } from "../lib/markup.js";
import { buildCaptions, captionZone } from "./captions.js";
import { buildDevices, buildScenes, RUSH, sceneSeams, type DeviceSlot } from "./stage.js";
import { behindFxClashes } from "./effects.js";

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



export interface HtmlInput {
  beats: Beats;
  style: Style;
  format: Format;
  src: { width: number; height: number };
  matte: MatteReport | null;
  hasCutout: boolean;
  /** Alpha samples of the cutout during each behind-word (by beat id): the word is placed on the real matte. */
  masks?: Record<string, Mask[]>;
  /** Screen recordings to show in a 3D phone (style frame.device): screen parts and B-roll under a bubble. */
  devices?: DeviceSlot[];
}

// A behind-word's phases, shared by the word and by the camera that must not fight its Z sign: the retraction of its
// arrival (shortened on a short word so it still holds), and its exit before the hard cut.
const BEHIND_EXIT = 0.2;
/**
 * Delay between the items of a cascade: its usual gap, tightened so the whole cascade starts within 0.5 s
 * (motion-doctrine: a longer stagger reads as a queue). Rounded down to the millisecond so r3 never pushes it over.
 */
const cascadeGap = (gap: number, n: number) => (n > 1 ? Math.min(gap, Math.floor((0.5 / (n - 1)) * 1000) / 1000) : gap);
const behindEntry = (b: { start: number; end: number }) => r3(Math.min(0.5, Math.max(0.1, b.end - b.start - 0.45)));

export function buildHtml(input: HtmlInput): string {
  return buildComposition(input).html;
}

// The seam gate reads each side of a cut over 0.1 s; the rush's own pull on a scene's side lasts SEAM_T and spends SEAM_Z
// of scale (power3: ~0.4 es/s on the cut, ~0.24 measured over the gate's window, against its 0.04 floor).
const SEAM_WINDOW = 0.1;
const SEAM_T = 0.3;
const SEAM_Z = 0.04;

export function buildComposition(input: HtmlInput): {
  html: string;
  placements: Record<string, Placement>;
  /** What the composition changed in the beats it was given (for QA and the reviewing agent). */
  notes: string[];
  /** Behind-words left out of the composition (by id). */
  dropped: string[];
} {
  // A frame reduction (hand-edited: proposeBeats never puts one there) moves both stacks off the full frame the word was
  // placed on, and its release grows them while the word shrinks. Reduced windows get no behind-words (decision 9):
  // the word goes, with its colour pop (the speaker would turn grey alone).
  const framed = input.beats.behind.flatMap((b) => {
    const fr = input.beats.frames.find((x) => b.start < x.end && b.end > x.start);
    return fr ? [{ b, fr }] : [];
  });
  if (framed.length) {
    const gone = framed.map((x) => x.b);
    const rest = buildComposition({
      ...input,
      beats: {
        ...input.beats,
        behind: input.beats.behind.filter((b) => !gone.includes(b)),
        fx: input.beats.fx.filter((x) => x.kind !== "colorPop" || !gone.some((b) => Math.abs(b.start - x.at) < 0.05)),
      },
    });
    const notes = framed.map(({ b, fr }) =>
      `Mot derrière « ${b.text} » (${b.start.toFixed(2)} s) retiré : il tombe dans la réduction de cadre ${fr.id} ` +
        `(${fr.start.toFixed(2)}–${fr.end.toFixed(2)} s), qui bougerait le sujet sous le mot. Déplace l'un des deux dans beats.json.`);
    return { ...rest, notes: [...notes, ...rest.notes], dropped: [...gone.map((b) => b.id), ...rest.dropped] };
  }
  const { beats, style, format: f, src, matte, hasCutout, masks, devices = [] } = input;
  const placements: Record<string, Placement> = {};
  const clashes = behindFxClashes(beats);
  const notes = clashes.map((c) => c.note);
  // After Effects-style motion blur (templates/vendor/motion-blur.js) on the elements that move fast.
  const blur = style.motion.blur ? ` data-hf-motion-blur='{"samplesPerFrame":8}'` : "";
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
  const capTop = captionZone(style, W, H).top;

  // The typography scenes' seams, the ledger's own rows: the rush leaves into a scene and comes back out of it on
  // the scene's Z sign (a pull: ENTRY_SCALE and EXIT_SCALE both shrink). Inside the seam gate's 0.1 s on either
  // side, a take boundary would reframe the rush against that sign (a .cam set to the tight framing reads as a
  // push): it moves to the scene's edge, the frame where the picture cuts anyway.
  const seamRows = sceneSeams(beats.scenes, D);
  const intoScene = seamRows.filter((r) => r.exit.selector === RUSH && r.exit.dir < 0).map((r) => r.cut);
  const outOfScene = seamRows.filter((r) => r.entry.selector === RUSH && r.entry.dir < 0).map((r) => r.cut);
  const camCuts = beats.cuts.map((c) =>
    intoScene.find((s) => c > s - SEAM_WINDOW && c < s) ?? outOfScene.find((e) => c > e && c <= e + SEAM_WINDOW) ?? c);

  // Framing scale of the jump-cut zoom at time t (same rule as the timeline below).
  const jumpSteps: { at: number; scale: number }[] = [];
  if (style.motion.jumpZoom > 1) {
    let tight = false;
    camCuts.forEach((at, k) => {
      if ((camCuts[k + 1] ?? D) - at < 0.8) return;
      // A take keeps its framing through a behind-word: the word was placed on the subject at the word's start.
      if (beats.behind.some((b) => at > b.start && at < b.end)) return;
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
    let fs: number, cy: number, cx = W / 2;
    const samples = masks?.[b.id];
    if (samples?.length) {
      // Measured: the share of the word the subject hides, on the cutout's own alpha at this moment.
      const p = placeBehind({
        masks: samples, layout, W, H, scale: scaleAt(b.start), origin: { x: (originX / 100) * W, y: originYpx },
        em, chars: text.length, fsMax, maxBottom, target: style.behind.coverage,
      });
      placements[b.id] = p;
      ({ fs, cy, cx } = p);
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
    // The embed is an arrival (cut-the-curve §2): every animation leaves on the inverse zoom-through's exit, so the
    // word only ever shrinks from its first frame to its last (one Z sign, a pull). Blur rides the .bwf wrapper and
    // opacity the .w inside it: both in one tween composite wrong in headless Chrome. 10 px: text-scale blur.
    // The wrapper scales about the word's own centre, so the measured placement (decision 7) is where it lands.
    const io = behindEntry(b);
    if (anim !== "slam") t(`tl.set("#${id} .bwf", { scale: 1, filter: "blur(0px)" }, ${r3(b.start)});`);
    if (anim === "slam") {
      // Slam keeps its heavier oversize (1.45, against the catalog's 1.25): it lands from just behind the camera.
      t(`tl.set("#${id} .bwf", { scale: 1.45, filter: "blur(10px)" }, ${r3(b.start)});`);
      t(`tl.to("#${id} .bwf", { scale: 1, filter: "blur(0px)", duration: ${io}, ease: "expo.out" }, ${r3(b.start)});`);
      t(`tl.set("#${id} .w", { opacity: 0.15 }, ${r3(b.start)});`);
      t(`tl.to("#${id} .w", { opacity: 1, duration: ${io}, ease: "expo.out" }, ${r3(b.start)});`);
    } else if (anim === "flip") {
      // The same flip-up as a hook line (0.5 s, back.out(1.6)): one intent for a word tipped up on its X axis.
      t(`tl.fromTo("#${id} .w", { rotationX: -95, opacity: 0, transformPerspective: 1100 }, { rotationX: 0, opacity: 1, duration: 0.5, ease: "back.out(1.6)" }, ${r3(b.start)});`);
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
    // Exit: accelerating away while the opacity falls linearly to 0.15, then the clip's end is the hard cut. 0.2 s
    // against an entry up to 0.5 s: the inverse zoom-through's 30/70 split, the 75 % rule's cut-the-curve exception.
    const out = r3(b.end - BEHIND_EXIT);
    t(`tl.to("#${id} .bwf", { scale: 0.8, filter: "blur(10px)", duration: ${BEHIND_EXIT}, ease: "power3.in" }, ${out});`);
    t(`tl.to("#${id} .w", { opacity: 0.15, duration: ${BEHIND_EXIT}, ease: "none" }, ${out});`);
    return `    <div id="${id}" class="clip behind" data-start="${r3(b.start)}" data-duration="${dur}" data-track-index="2" data-layout-allow-overflow style="z-index:2">
      <div class="bwf" style="transform-origin:${Math.round(cx)}px ${Math.round(cy)}px">
      <div class="w"${blur} style="top:${Math.round(cy - fs / 2)}px;left:${Math.round(cx - W / 2)}px;font-size:${Math.round(fs)}px;line-height:${Math.round(fs)}px${anim === "track" ? ";opacity:0" : ""}">${
        anim === "track" ? [...text].map((ch, k) => `<span class="l${k}" style="display:inline-block">${esc(ch)}</span>`).join("") : esc(text)
      }</div>
      </div>
    </div>`;
  }).join("\n");

  // Show the cutout only around behind-words (identical pixels to the footage, so the switch is invisible).
  if (hasCutout) {
    t(`tl.set("#cutout-wrap", { opacity: 0 }, 0);`);
    const shown = [...beats.behind, ...beats.fx.filter((f) => f.kind === "colorPop").map((f) => ({ start: f.at, end: f.at + f.duration }))];
    for (const b of shown) {
      t(`tl.set("#cutout-wrap", { opacity: 1 }, ${r3(Math.max(0, b.start - 0.1))});`);
      t(`tl.set("#cutout-wrap", { opacity: 0 }, ${r3(b.end + 0.05)});`);
    }
  }
  // Camera moves apply to both stacks (.cam = footage under the words, cutout above them) with the same values, so
  // the cutout stays registered on the footage. Two nested levels: .cam alternates framing on jump cuts, .push
  // punches in during behind-words. One baseline each, then plain tweens (repeated fromTo would leak into seeks).
  // Slow push on every shot (a take, or the part of it a scene leaves visible), alternating in and out, so a talking
  // head never sits still. A shot that holds a behind-word always pulls: the word only shrinks (one Z sign), so the
  // rush recedes with it. A shot next to a scene pulls too, whatever the style's drift: it starts SEAM_Z larger and
  // spends it in SEAM_T on the seam's side, power3.in into the scene (its exit ease) and power3.out out of it (the
  // mirror), so the rush is still moving on the cut, pulling like the scene, and never shows its edges.
  const driftA = style.motion.drift - 1;
  const near = (xs: number[], v: number) => xs.some((x) => Math.abs(x - v) < 1e-3);
  const covered = (a: number, b: number) => beats.scenes.some((sc) => (a + b) / 2 > sc.start && (a + b) / 2 < sc.end);
  const edges = [...new Set([0, ...camCuts, ...beats.scenes.flatMap((sc) => [sc.start, sc.end]), D].map(r3))]
    .filter((x) => x >= 0 && x <= D).sort((x, y) => x - y);
  const shots = edges.slice(0, -1).map((a, k) => [a, edges[k + 1]]).filter(([a, b]) => !covered(a, b));
  const drift: string[] = [];
  shots.forEach(([a, b], k) => {
    const into = near(intoScene, b), out = near(outOfScene, a);
    if (!into && !out && (driftA <= 0 || b - a < 0.6)) return;
    if (!into && !out && k % 2 === 0 && !beats.behind.some((w) => w.start < b && w.end > a)) {
      drift.push(`tl.set(".drift", { scale: 1 }, ${r3(a)});`);
      drift.push(`tl.to(".drift", { scale: ${style.motion.drift}, duration: ${r3(b - a)}, ease: "none" }, ${r3(a)});`);
      return;
    }
    const share = into && out ? 2 : 1;
    const tIn = out ? Math.min(SEAM_T, (b - a) / share) : 0;
    const tOut = into ? Math.min(SEAM_T, (b - a) / share) : 0;
    const floor = 1 + (into ? SEAM_Z : 0);
    const top = r3(floor + Math.max(0, driftA) + (out ? SEAM_Z : 0));
    drift.push(`tl.set(".drift", { scale: ${top} }, ${r3(a)});`);
    if (out) drift.push(`tl.to(".drift", { scale: ${r3(top - SEAM_Z)}, duration: ${r3(tIn)}, ease: "power3.out" }, ${r3(a)});`);
    const linear = b - tOut - (a + tIn);
    if (driftA > 0 && linear > 0.001) {
      drift.push(`tl.to(".drift", { scale: ${r3(floor)}, duration: ${r3(linear)}, ease: "none" }, ${r3(a + tIn)});`);
    }
    if (into) drift.push(`tl.to(".drift", { scale: 1, duration: ${r3(tOut)}, ease: "power3.in" }, ${r3(b - tOut)});`);
  });
  if (drift.length) {
    if (!drift[0].endsWith(", 0);")) t(`tl.set(".drift", { scale: 1 }, 0);`);
    drift.forEach(t);
  }
  // A sliver of a take keeps the current framing: alternating on it would read as a flicker.
  if (jumpSteps.length) {
    t(`tl.set(".cam", { scale: 1 }, 0);`);
    for (const j of jumpSteps) t(`tl.set(".cam", { scale: ${j.scale} }, ${r3(j.at)});`);
  }
  if (style.motion.punchIn > 1 && beats.behind.length) {
    t(`tl.set(".push", { scale: 1 }, 0);`);
    // The punch-in waits for the word to settle and stops when it starts to leave: a push while the word retracts or
    // recedes would put two Z signs in one frame. Its return pulls back with the word's exit, not on the hard cut.
    for (const b of beats.behind) {
      const [from, until] = [r3(b.start + behindEntry(b)), r3(b.end - BEHIND_EXIT)];
      if (until - from >= 0.15) {
        t(`tl.to(".push", { scale: ${style.motion.punchIn}, duration: ${r3(until - from)}, ease: "power1.out" }, ${from});`);
      }
      t(`tl.to(".push", { scale: 1, duration: 0.35, ease: "power2.inOut" }, ${until});`);
    }
  }

  // ---------- frame reductions: both stacks shrink into a card (room for graphics) or a corner bubble (over B-roll)
  const { stageHtml, brollHtml } = buildFrames(beats.frames, style, W, H, D, unit, t, devices.some((d) => d.role === "broll"));
  const dev = buildDevices(devices, style, W, H, t);
  const scenes = buildScenes(beats.scenes, style, W, H, blur, t);

  // ---------- effects (CapCut-style: transforms on both stacks and overlays, so the cutout stays registered)
  const colorPop = hasCutout && beats.fx.some((f) => f.kind === "colorPop");
  const shrinks = beats.behind.flatMap((b) => [
    ...(style.behind.animation === "slam" ? [{ start: b.start, end: b.start + behindEntry(b) }] : []),
    { start: b.end - BEHIND_EXIT, end: b.end },
  ]);
  const fxHtml = buildEffects(beats.fx, style, W, t, colorPop, shrinks, new Set(clashes.map((c) => c.fx.id)));

  // ---------- motion graphics
  let listN = 0;
  const mgX = vertical ? 0 : Math.round(W * 0.06);
  const mgY = Math.round(H * (vertical ? 0.075 : 0.09));
  const depth = style.motion.depth;
  // Entrance of a graphic: flat slide, or a 3D tip-in from below the horizon when the style has depth.
  // A side entry (side 1) comes from the right, travelling left like every exit: the film's one current.
  // The tip-in overshoots less (back.out(1.3)) than a line or a chip (1.6): a whole card is the heavy element, and
  // implied mass rebounds less (motion-doctrine, causal motion).
  const enter = (sel: string, at: number, side = 0) => depth > 0
    ? t(`tl.fromTo("${sel}", { ${side ? `x: ${side * 80}, ` : ""}rotationX: ${Math.round(-70 * depth)}, rotationY: ${Math.round(side * 55 * depth)}, z: ${Math.round(-260 * depth)}, y: 30, opacity: 0, transformPerspective: 1000 }, { ${side ? "x: 0, " : ""}rotationX: 0, rotationY: 0, z: 0, y: 0, opacity: 1, duration: 0.55, ease: "back.out(1.3)" }, ${r3(at)});`)
    : t(`tl.fromTo("${sel}", { x: ${side * 80}, y: ${side ? 0 : 30}, opacity: 0 }, { x: 0, y: 0, opacity: 1, duration: 0.35, ease: "${style.motion.ease}" }, ${r3(at)});`);
  // Exit in the current (cut-the-curve): a partial slide (12 % of W) accelerating out, so it leaves at full speed.
  // The fade is its own linear tween (0.18 s, the catalog's shortest) that dies 0.02 s before the clip ends: a lone
  // graphic has no incoming side to carry the eye, and a fade starting with the slide was over at ~29 % of the
  // power4.in path, hiding the move (~15 px seen in 9:16). The exit stays 0.34 s whatever the entry (0.35 flat,
  // 0.55 tipped in 3D): cut-the-curve sets the exit, not the 75 % rule, and every graphic leaves alike.
  const exitX = Math.round(W * 0.12);
  const mgHtml = beats.mographs.map((m, i) => {
    const id = `mg${i}`;
    const dur = r3(m.end - m.start);
    const s = r3(m.start);
    const align = vertical || ["question", "compare", "hook", "url", "cta", "definition"].includes(m.kind) ? "center" : "left";
    let inner = "";
    if (m.kind === "hook") {
      inner = `<div class="hook">${(m.items ?? [m.text]).map((l, k) => `<div class="h3d hl${k}"${blur}>${esc(l.toUpperCase())}</div>`).join("")}</div>`;
      const lines = m.items ?? [m.text];
      const gap = cascadeGap(0.18, lines.length);
      lines.forEach((_, k) =>
        t(`tl.fromTo("#${id} .hl${k}", { rotationX: -90, opacity: 0, transformPerspective: 900 }, { rotationX: 0, opacity: 1, duration: 0.5, ease: "back.out(1.6)" }, ${r3(m.start + k * gap)});`));
    } else if (m.kind === "question") {
      const words = m.text.split(/\s+/);
      inner = `<div class="qcard"><span class="qmark">?</span><div class="qtext">${words.map((w, k) => `<span class="qw q${k}">${esc(w)}</span>`).join(" ")}</div></div>`;
      enter(`#${id} .qcard`, m.start);
      const gap = cascadeGap(0.07, words.length);
      words.forEach((_, k) => t(`tl.fromTo("#${id} .q${k}", { y: 24, opacity: 0 }, { y: 0, opacity: 1, duration: 0.25, ease: "power3.out" }, ${r3(m.start + 0.2 + k * gap)});`));
    } else if (m.kind === "url") {
      const chars = [...m.text];
      inner = `<div class="urlbar"><svg class="lock" viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke-width="2.4"/></svg>` +
        `<span class="urltext">${chars.map((c, k) => `<span class="uc u${k}" style="opacity:0">${esc(c)}</span>`).join("")}</span><span class="caret">|</span></div>`;
      enter(`#${id} .urlbar`, m.start);
      // Typed one character at a time, then a blinking caret (deterministic sets, no timers). Typing is the bar's
      // sequenced UI life, not a cascade: the 0.5 s stagger cap does not apply to it.
      chars.forEach((_, k) => t(`tl.set("#${id} .u${k}", { opacity: 1 }, ${r3(m.start + 0.35 + k * 0.045)});`));
      for (let b = m.start + 0.35; b < m.end - 0.3; b += 0.26) t(`tl.set("#${id} .caret", { opacity: ${Math.round((b - m.start) / 0.26) % 2} }, ${r3(b)});`);
    } else if (m.kind === "compare") {
      const [a, b] = m.items ?? m.text.split(" vs ");
      inner = `<div class="vs"><div class="side sa">${esc((a ?? "").toUpperCase())}</div><div class="vschip">VS</div><div class="side sb">${esc((b ?? "").toUpperCase())}</div></div>`;
      enter(`#${id} .sa`, m.start, 1);
      // back.out(1.6) like the hook lines and the CTA release: the graphics' one overshoot (2.5 read as rubber).
      t(`tl.fromTo("#${id} .vschip", { scale: 0, rotation: -30 }, { scale: 1, rotation: 0, duration: 0.35, ease: "back.out(1.6)" }, ${r3(m.start + 0.2)});`);
      enter(`#${id} .sb`, m.start + 0.3, 1);
    } else if (m.kind === "definition") {
      const [term, meaning] = m.items ?? [m.text, ""];
      inner = `<div class="panel def"><div class="term">${esc(term.toUpperCase())}</div><div class="bar"></div><div class="mean">${esc(meaning)}</div></div>`;
      enter(`#${id} .def`, m.start);
      // A stroke being drawn, not an arrival: in-out like a hand drawing it (the no-inOut rule is for entrances).
      t(`tl.fromTo("#${id} .bar", { scaleX: 0 }, { scaleX: 1, duration: 0.45, ease: "power3.inOut" }, ${r3(m.start + 0.3)});`);
      t(`tl.fromTo("#${id} .mean", { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.3, ease: "power3.out" }, ${r3(m.start + 0.55)});`);
    } else if (m.kind === "cta") {
      inner = `<div class="cta"><span>${esc(m.text.toUpperCase())}</span><svg viewBox="0 0 24 24"><path d="M5 12h12M12 6l6 6-6 6" fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg></div>`;
      enter(`#${id} .cta`, m.start);
      // A staged reveal, then one press: a pulse looping in place reads as the video waiting.
      t(`tl.set("#${id} .cta svg", { x: ${Math.round(-40 * unit)}, opacity: 0 }, ${s});`);
      t(`tl.to("#${id} .cta svg", { x: 0, opacity: 1, duration: 0.3, ease: "power4.out" }, ${r3(m.start + 0.35)});`);
      t(`tl.to("#${id} .cta", { scale: 0.93, duration: 0.08, ease: "power2.in" }, ${r3(m.start + 0.8)});`);
      t(`tl.to("#${id} .cta", { scale: 1, duration: 0.35, ease: "back.out(1.6)" }, ${r3(m.start + 0.88)});`);
    } else if (m.kind === "counter") {
      const big = Math.round((vertical ? 150 : 140) * unit);
      inner = `<div class="panel counter"><div class="num" style="font-size:${big}px">0${esc(m.suffix ?? "")}</div>` +
        (m.label ? `<div class="lbl">${esc(m.label)}</div>` : "") + `</div>`;
      enter(`#${id} .panel`, m.start);
      // The count is the panel's sustained motion (sequenced UI life), not an entrance: 0.9 s is over the entry cap.
      t(`(() => { const o = { v: 0 }; const el = document.querySelector("#${id} .num"); ` +
        `tl.to(o, { v: ${m.value ?? 0}, duration: 0.9, ease: "power2.out", onUpdate: () => { el.textContent = fmt(o.v, ${m.value ?? 0}) + ${JSON.stringify(m.suffix ?? "")}; } }, ${r3(m.start + 0.1)}); })();`);
    } else if (m.kind === "underline") {
      inner = `<div class="panel plain"><div class="kw">${esc(m.text.toUpperCase())}</div><div class="bar"></div></div>`;
      // The word rises like a flat graphic entrance (same distance, ease and duration), so the two read as one family.
      t(`tl.fromTo("#${id} .kw", { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.35, ease: "${style.motion.ease}" }, ${s});`);
      t(`tl.fromTo("#${id} .bar", { scaleX: 0 }, { scaleX: 1, duration: 0.45, ease: "power3.inOut" }, ${r3(m.start + 0.2)});`);
    } else {
      const chip = m.kind === "callout" ? `<span class="chip">!</span>` : m.kind === "list" ? `<span class="chip">${++listN}</span>` : "";
      const cls = m.kind === "badge" ? "pill outline" : "pill";
      inner = `<div class="${cls}">${chip}<span>${esc(m.text.toUpperCase())}</span></div>`;
      enter(`#${id} .pill`, m.start, vertical ? 0 : 1);
    }
    t(`tl.to("#${id} > div", { x: -${exitX}, duration: 0.34, ease: "power4.in" }, ${r3(m.end - 0.34)});`);
    t(`tl.to("#${id} > div", { opacity: 0, duration: 0.18, ease: "none" }, ${r3(m.end - 0.2)});`);
    return `    <div id="${id}" class="clip mg" data-start="${s}" data-duration="${dur}" data-track-index="3" style="z-index:5">
      <div class="mg-pos"${blur} style="left:${align === "center" ? 0 : mgX}px;top:${mgY}px;${align === "center" ? `width:${W}px;` : ""}text-align:${align}">${inner}</div>
    </div>`;
  }).join("\n");

  // ---------- captions
  // With hideCaptions, a group sharing the screen with a behind-word steps aside: the word is the caption.
  // A scene is the caption while it is on screen.
  const covers = (g: { start: number; end: number }, x: { start: number; end: number }) => Math.min(g.end, x.end) - Math.max(g.start, x.start) > 0.15;
  const shown = beats.captions.filter((g) =>
    !(style.behind.hideCaptions && beats.behind.some((b) => covers(g, b))) && !beats.scenes.some((sc) => covers(g, sc)));
  const caps = buildCaptions(shown, style, W, H, t);

  if (style.look.grain > 0) for (const g of grainSets(D)) t(g);

  const behindFont = style.fonts.behind;
  const html = `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${W}, height=${H}" />
    <script src="assets/gsap.min.js"></script>
    <style>
${beats.captions.some((g) => g.emoji) ? `      @font-face { font-family: "Noto Color Emoji"; src: local("Noto Color Emoji"); }\n` : ""}      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: ${W}px; height: ${H}px; overflow: hidden; background: #000; }
      #root { position: relative; width: ${W}px; height: ${H}px; overflow: hidden; background: #000; }
      .clip { position: absolute; inset: 0; }
      /* Two camera stacks, kept in lockstep: footage (z 1) under the behind-words (z 2), cutout (z 3) above them.
         Each stack is its own stacking context, so the cutout cannot sit inside the footage's. */
      .cam, .push, .shake, .drift { position: absolute; inset: 0; transform-origin: ${originX}% 40%; }
      #bw-wrap { position: absolute; inset: 0; }
      /* .frame carries the stacking order and the frame reductions (card / bubble) of both stacks. */
      .frame { position: absolute; inset: 0; transform-origin: 0 0; overflow: hidden; }
      #frame-cam { z-index: 1; box-shadow: 0 ${Math.round(24 * unit)}px ${Math.round(80 * unit)}px rgba(0,0,0,0.55); }
      #frame-cut { z-index: 3; }
      #stage { position: absolute; inset: 0; z-index: 0; background: radial-gradient(ellipse at 50% 30%, ${style.frame.stage}, #000 85%); }
      .broll { position: absolute; left: 0; top: 0; width: ${W}px; height: ${H}px; object-fit: contain; z-index: 0; }
      .cam video { position: absolute; ${videoCss} }
      #cutout-wrap { position: absolute; inset: 0; }
      /* Film grain over footage, words and cutout alike, under the graphics. */
      #grain { position: absolute; left: -256px; top: -256px; width: ${W + 512}px; height: ${H + 512}px; z-index: 4;
        background: url("assets/grain.png") repeat; mix-blend-mode: overlay; pointer-events: none; }
      .bar-lb { position: absolute; left: 0; width: ${W}px; background: #000; z-index: 6; }
      /* Effect overlays: above footage, words and cutout, under graphics and captions. */
      #flash { position: absolute; inset: 0; background: #fff; opacity: 0; z-index: 4; pointer-events: none; }
      .leak { z-index: 4; mix-blend-mode: screen; pointer-events: none; }
      /* A film light leak: a hot burnt edge plus two warm blooms over the picture, swept across in screen blend. */
      .leak .lk { position: absolute; inset: 0; opacity: 0;
        background: radial-gradient(ellipse 30% 70% at 4% 50%, rgba(255,120,40,1), rgba(255,80,30,0) 75%),
                    radial-gradient(ellipse 42% 55% at 38% 35%, rgba(255,170,70,0.95), rgba(255,120,50,0) 72%),
                    radial-gradient(ellipse 34% 42% at 66% 68%, rgba(255,215,140,0.85), rgba(255,170,90,0) 72%); }
      .behind .bwf { position: absolute; inset: 0; }
      .behind .w { position: absolute; left: 0; width: ${W}px; text-align: center; white-space: nowrap;
        font-family: "${behindFont}"; font-weight: ${style.fonts.behindWeight}; color: ${c.behind}; letter-spacing: 0.02em;
        ${depth >= 0.5 ? `text-shadow: ${extrude("rgba(0,0,0,0.55)", Math.round(10 * unit * depth))};` : ""} }
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
      .hook { display: inline-flex; flex-direction: column; align-items: center; gap: ${Math.round(4 * unit)}px; }
      .h3d { font-family: "${style.fonts.behind}"; font-weight: ${Math.max(800, style.fonts.behindWeight)}; font-size: ${Math.round(150 * unit)}px; line-height: 0.95;
        color: ${c.text}; text-shadow: ${extrude(c.accent, Math.round(12 * unit * Math.max(0.4, depth)))}; }
      .hl1 { color: ${c.accent}; text-shadow: ${extrude("#000", Math.round(12 * unit * Math.max(0.4, depth)))}; }
      .qcard { display: inline-flex; align-items: center; gap: ${Math.round(22 * unit)}px; max-width: ${Math.round(W * 0.86)}px;
        padding: ${Math.round(22 * unit)}px ${Math.round(34 * unit)}px; border-radius: ${Math.round(28 * unit)}px; background: ${c.panel};
        color: ${c.text}; font-family: "${style.fonts.graphic}"; font-weight: 800; font-size: ${Math.round(50 * unit)}px; text-align: left;
        box-shadow: 0 ${Math.round(18 * unit)}px ${Math.round(50 * unit)}px rgba(0,0,0,0.4); }
      .qmark { display: inline-grid; place-items: center; flex: none; width: 1.6em; height: 1.6em; border-radius: 50%;
        background: ${c.accent}; color: #111; font-size: 1.2em; font-weight: 900; }
      .qw { display: inline-block; }
      .urlbar { display: inline-flex; align-items: center; gap: ${Math.round(16 * unit)}px; padding: ${Math.round(18 * unit)}px ${Math.round(34 * unit)}px;
        border-radius: 999px; background: #fff; color: #111; font-family: "JetBrains Mono"; font-weight: 700; font-size: ${Math.round(46 * unit)}px;
        box-shadow: 0 ${Math.round(18 * unit)}px ${Math.round(50 * unit)}px rgba(0,0,0,0.45); }
      .urlbar .lock { width: 0.9em; height: 0.9em; fill: #16a34a; stroke: #16a34a; }
      .caret { color: ${c.accent}; font-weight: 400; }
      .vs { display: inline-flex; align-items: center; gap: ${Math.round(18 * unit)}px; }
      .side { padding: ${Math.round(18 * unit)}px ${Math.round(30 * unit)}px; border-radius: ${Math.round(22 * unit)}px; font-family: "${style.fonts.graphic}";
        font-weight: 900; font-size: ${Math.round(46 * unit)}px; background: ${c.panel}; color: ${c.text}; }
      .sb { background: ${c.accent}; color: #111; }
      .vschip { font-family: "${style.fonts.behind}"; font-weight: 900; font-size: ${Math.round(60 * unit)}px; color: ${c.accent};
        text-shadow: 0 4px 18px rgba(0,0,0,0.6); }
      .def { text-align: left; max-width: ${Math.round(W * 0.84)}px; }
      .def .term { font-size: ${Math.round(64 * unit)}px; font-weight: 900; color: ${c.accent}; line-height: 1; }
      .def .mean { font-size: ${Math.round(38 * unit)}px; font-weight: 600; margin-top: ${Math.round(8 * unit)}px; }
      .cta { display: inline-flex; align-items: center; gap: ${Math.round(14 * unit)}px; padding: ${Math.round(20 * unit)}px ${Math.round(40 * unit)}px;
        border-radius: 999px; background: ${c.accent}; color: #111; font-family: "${style.fonts.graphic}"; font-weight: 900;
        font-size: ${Math.round(46 * unit)}px; box-shadow: 0 ${Math.round(16 * unit)}px ${Math.round(46 * unit)}px rgba(0,0,0,0.4); }
      .cta svg { width: 1em; height: 1em; stroke: #111; }
      .chip { display: inline-grid; place-items: center; width: 1.4em; height: 1.4em; border-radius: 50%; background: #111; color: ${c.accent}; font-size: 0.8em; }
      ${caps.css.slice(1)}${dev.css}${scenes.css}
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${D}" data-width="${W}" data-height="${H}">
${stageHtml}${bgVideo}${brollHtml}    <div id="frame-cam" class="frame"><div id="cam" class="cam"><div class="push"><div class="shake"><div class="drift">
      <video id="base" src="assets/cut.mp4" data-start="0" data-duration="${D}" data-media-start="0" data-track-index="1" muted playsinline></video>
${colorPop ? `      <div id="bw-wrap" style="opacity:0">
        <video id="bw" src="assets/bw.mp4" data-start="0" data-duration="${D}" data-media-start="0" data-track-index="6" muted playsinline></video>
      </div>\n` : ""}    </div></div></div></div></div>
${behindHtml}
${grainLayer(style)}${hasCutout ? `    <div id="frame-cut" class="frame"><div id="cutcam" class="cam"><div class="push"><div class="shake"><div class="drift">
      <div id="cutout-wrap" data-layout-allow-occlusion>
        <video id="cutout" src="assets/subject.webm" data-start="0" data-duration="${D}" data-media-start="0" data-track-index="4" muted playsinline></video>
      </div>
    </div></div></div></div></div>\n` : ""}${dev.html}${fxHtml}${letterbox(style, W, H)}
${mgHtml}
${scenes.html}
    <div id="captions" class="clip" data-start="0" data-duration="${D}" data-track-index="5" data-track-kind="captions">
${caps.html}
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
    </script>${style.motion.blur ? `\n    <script src="assets/motion-blur.js"></script>` : ""}
  </body>
</html>
`;
  return { html, placements, notes, dropped: [] };
}

// cut-the-curve §7: a single ease (power3.inOut) smacks the group to a stop; a ramp-in, a linear burst and a tail
// at least three times the ramp-in read as a purposeful slide. Fractions are of the distance and of the time.
const NUDGE = [
  { to: 0.1, time: 0.2, ease: "power3.in" },
  { to: 0.75, time: 0.18, ease: "none" },
  { to: 1, time: 0.62, ease: "power4.out" },
] as const;

type FramePose = { x: number; y: number; scale: number };

function nudge(t: (s: string) => void, from: FramePose, to: FramePose, at: number, duration: number) {
  let time = at;
  for (const p of NUDGE) {
    const mix = (a: number, b: number) => a + (b - a) * p.to;
    const d = r3(duration * p.time);
    t(`tl.to(".frame", { x: ${Math.round(mix(from.x, to.x))}, y: ${Math.round(mix(from.y, to.y))}, scale: ${r3(mix(from.scale, to.scale))}, duration: ${d}, ease: "${p.ease}" }, ${r3(time)});`);
    time += d;
  }
}

/**
 * Frame reductions. The `.frame` wrappers of both camera stacks move together (origin top-left: x, y, scale), so the
 * cutout stays registered. Corners round only while reduced (a set, not a tween: radius is paint-only but would
 * snap). B-roll plays muted under the reduced frame, letterboxed on the stage.
 */
function buildFrames(frames: Beats["frames"], style: Style, W: number, H: number, D: number, unit: number, t: (s: string) => void, brollInDevice = false) {
  if (!frames.length) return { stageHtml: "", brollHtml: "" };
  const vertical = H > W;
  t(`tl.set(".frame", { x: 0, y: 0, scale: 1, borderRadius: 0 }, 0);`);
  let brollHtml = "";
  frames.forEach((f, i) => {
    const s = f.mode === "card" ? style.frame.cardScale : style.frame.bubbleScale;
    const w = W * s, h = H * s;
    const x = f.mode === "card" ? (W - w) / 2 : W - w - W * 0.05;
    const y = f.mode === "card" ? Math.min(H * (vertical ? 0.2 : 0.16), H * 0.97 - h) : H * (vertical ? 0.06 : 0.07);
    const radius = r3((style.frame.radius * unit) / s);
    const io = Math.min(0.45, (f.end - f.start) / 3);
    t(`tl.set(".frame", { borderRadius: ${radius} }, ${r3(f.start)});`);
    nudge(t, { x: 0, y: 0, scale: 1 }, { x, y, scale: s }, f.start, io);
    nudge(t, { x, y, scale: s }, { x: 0, y: 0, scale: 1 }, f.end - io, io);
    t(`tl.set(".frame", { borderRadius: 0 }, ${r3(f.end)});`);
    if (f.broll && !brollInDevice) {
      brollHtml += `    <video id="broll${i}" class="broll" src="assets/broll-${i}.mp4" data-start="${r3(f.start)}" data-duration="${r3(Math.min(D, f.end) - f.start)}" data-media-start="${r3(f.broll.from)}" data-track-index="8" muted playsinline></video>\n`;
    }
  });
  return { stageHtml: `    <div id="stage"></div>\n`, brollHtml };
}

/**
 * Effect overlays and their timeline. Camera effects move the `.shake` level of both stacks, so the cutout stays on
 * the footage; flash and light leaks are overlays; the colour pop shows a black-and-white copy of the footage under
 * the cutout.
 */
function buildEffects(
  fx: Beats["fx"], style: Style, W: number, t: (s: string) => void, colorPop: boolean,
  shrinks: { start: number; end: number }[] = [],
  underWord = new Set<string>(),
): string {
  const k = style.effects.intensity;
  const cam = fx.filter((f) => f.kind === "shake" || f.kind === "zoomPunch" || f.kind === "whip" || f.kind === "ladder");
  if (cam.length) t(`tl.set(".shake", { x: 0, y: 0, xPercent: 0, scale: 1 }, 0);`);
  let html = "";
  if (fx.some((f) => f.kind === "flash" || f.kind === "whip" || f.kind === "strobe")) {
    html += `    <div id="flash"></div>\n`;
    t(`tl.set("#flash", { opacity: 0 }, 0);`);
  }
  if (colorPop) t(`tl.set("#bw-wrap", { opacity: 0 }, 0);`);
  let whipDir = 1;
  fx.forEach((f, i) => {
    const at = r3(f.at), d = f.duration;
    if (f.kind === "shake") {
      // Decaying, deterministic jolts (no random at render time).
      const amp = Math.round(W * 0.014 * k);
      const steps = 8;
      for (let s = 0; s < steps; s++) {
        const fall = 1 - s / steps;
        const x = Math.round(amp * fall * (s % 2 ? -1 : 1));
        const y = Math.round(amp * 0.6 * fall * (s % 3 === 0 ? 1 : -1));
        t(`tl.to(".shake", { x: ${x}, y: ${y}, duration: ${r3(d / (steps + 1))}, ease: "none" }, ${r3(f.at + (s * d) / (steps + 1))});`);
      }
      t(`tl.to(".shake", { x: 0, y: 0, duration: ${r3(d / (steps + 1))}, ease: "power1.out" }, ${r3(f.at + (steps * d) / (steps + 1))});`);
    } else if (f.kind === "zoomPunch") {
      const peak = r3(1 + 0.13 * k);
      if (shrinks.some((w) => f.at < w.end && f.at + 0.08 > w.start)) {
        // On a behind-word that is retracting or leaving, the punch lands as an impact frame and recoils with the
        // word (inverse zoom-through): growing over 0.08 s would put a push against the word's pull.
        t(`tl.set(".shake", { scale: ${peak} }, ${at});`);
        t(`tl.to(".shake", { scale: 1, duration: ${r3(d)}, ease: "expo.out" }, ${at});`);
      } else {
        t(`tl.to(".shake", { scale: ${peak}, duration: 0.08, ease: "power3.out" }, ${at});`);
        t(`tl.to(".shake", { scale: 1, duration: ${r3(d - 0.08)}, ease: "power2.inOut" }, ${r3(f.at + 0.08)});`);
      }
    } else if (f.kind === "whip") {
      // Out of the old take, cut, into the new one from the other side; a soft flash hides the edges. Under a
      // behind-word only the flash plays (behindFxClashes): the rush must not slide under a fixed word.
      const off = Math.round(16 * k) * whipDir;
      if (!underWord.has(f.id)) {
        t(`tl.to(".shake", { xPercent: ${-off}, scale: 1.15, duration: ${r3(d / 2)}, ease: "power2.in" }, ${at});`);
        t(`tl.set(".shake", { xPercent: ${off} }, ${r3(f.at + d / 2)});`);
        t(`tl.to(".shake", { xPercent: 0, scale: 1, duration: ${r3(d / 2)}, ease: "power2.out" }, ${r3(f.at + d / 2)});`);
        whipDir = -whipDir;
      }
      t(`tl.to("#flash", { opacity: ${r3(0.35 * k)}, duration: ${r3(d / 2)}, ease: "power1.in" }, ${at});`);
      t(`tl.to("#flash", { opacity: 0, duration: ${r3(d / 2)}, ease: "power1.out" }, ${r3(f.at + d / 2)});`);
    } else if (f.kind === "flash") {
      t(`tl.to("#flash", { opacity: ${r3(Math.min(1, 0.85 * k))}, duration: 0.06, ease: "power2.out" }, ${at});`);
      t(`tl.to("#flash", { opacity: 0, duration: ${r3(d - 0.06)}, ease: "power2.in" }, ${r3(f.at + 0.06)});`);
    } else if (f.kind === "strobe") {
      // Alternate frames at 30 fps: lit, dark, lit… then off.
      const n = Math.max(2, Math.round(d * 30));
      for (let s = 0; s < n; s++) t(`tl.set("#flash", { opacity: ${s % 2 ? 0 : r3(Math.min(0.9, 0.7 * k))} }, ${r3(f.at + s / 30)});`);
      t(`tl.set("#flash", { opacity: 0 }, ${r3(f.at + n / 30)});`);
    } else if (f.kind === "ladder" && !underWord.has(f.id)) {
      // Four hard zoom steps (jump zooms, no easing), then a quick release to the take's framing.
      const hold = d - 0.18;
      for (let s = 0; s < 4; s++) t(`tl.set(".shake", { scale: ${r3(1 + 0.055 * (s + 1) * k)} }, ${r3(f.at + (s * hold) / 4)});`);
      t(`tl.to(".shake", { scale: 1, duration: 0.18, ease: "power2.out" }, ${r3(f.at + hold)});`);
    } else if (f.kind === "lightLeak") {
      const id = `leak${i}`;
      // One sweep across the frame, brightest mid-way: not an entrance and an exit, so the 75 % rule does not apply.
      html += `    <div id="${id}" class="clip leak" data-start="${at}" data-duration="${r3(d)}" data-track-index="7"><div class="lk"></div></div>\n`;
      t(`tl.fromTo("#${id} .lk", { opacity: 0, xPercent: -35 }, { opacity: ${r3(Math.min(1, 0.95 * k + 0.1))}, xPercent: 0, duration: ${r3(d * 0.4)}, ease: "sine.out" }, ${at});`);
      t(`tl.to("#${id} .lk", { opacity: 0, xPercent: 35, duration: ${r3(d * 0.6)}, ease: "sine.in" }, ${r3(f.at + d * 0.4)});`);
    } else if (f.kind === "colorPop" && colorPop) {
      t(`tl.set("#bw-wrap", { opacity: 1 }, ${r3(Math.max(0, f.at - 0.1))});`);
      t(`tl.set("#bw-wrap", { opacity: 0 }, ${r3(f.at + d + 0.05)});`);
    }
  });
  return html;
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
