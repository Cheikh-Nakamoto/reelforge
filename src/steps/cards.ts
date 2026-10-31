import { NUDGE } from "../lib/nudge.js";
import { esc, r3 } from "../lib/markup.js";
import type { Style } from "../lib/style.js";
import type { Beats } from "./beats.js";

/**
 * The card space (ticket 0015): UI cards "exploded" in depth, one behind the other, with a depth-of-field blur, and ONE
 * camera that travels from card to card (motion-doctrine: a camera with intent, one monotonic path that arrives on each
 * subject). Nothing here reads pixels or calls a model (decision 2): the cards are the graphics `contextual.ts` already
 * detected, staged together by `proposeSpaces`, or cards the editor writes into `beats.spaces`.
 *
 * Structure (every level has one job, so a tween never fights another):
 *   .sp (clip) > .sp-out (exit in the current) > .sp-view (perspective) > .spcam (the camera path)
 *     > .cd<k> (a card at its depth, set in CSS, never tweened) > .cd-in (entry / exit: opacity, scale)
 *     > .cd-blur (depth of field: the filter, alone) > .ucard (the face).
 */
export type Space = Beats["spaces"][number];
export type SpaceCard = Space["cards"][number];
type Mograph = Beats["mographs"][number];

export const MIN_CARDS = 2;
export const MAX_CARDS = 6;
/** The sequence the default stages: three to five graphics, never more than one per video (a strong beat, decision 23). */
const DEFAULT_CARDS = { min: 3, max: 5 };
/** Seconds: the camera's arrival on the first card, its travel between two cards, the exit of the whole space. */
const ARRIVE = 0.6;
const TRAVEL = 0.7;
const EXIT = 0.34;
const MIN_DWELL = 0.4;
/** Blur (px at 1080) per step of distance between a card and the focus plane. */
const BLUR_STEP = 7;

const DZ = 380;
/** A card's pose along the path: each one deeper, further right (the film's current is left, so the camera goes there). */
export function cardPose(k: number, W: number, H: number, unit: number): { x: number; y: number; z: number } {
  const vertical = H > W;
  return {
    x: Math.round(k * (vertical ? 0.26 : 0.16) * W),
    y: Math.round(k * (vertical ? 0.07 : 0.07) * H),
    z: -Math.round(k * DZ * unit),
  };
}

/** Depth-of-field blur: proportional to the distance (in steps of depth) between a card and the focus plane. */
export const blurPx = (dist: number, unit: number) => Math.round(dist * BLUR_STEP * unit);

export interface Schedule {
  /** Instant at which the camera stops on each card (the card is sharp from then on). */
  focus: number[];
  arrive: number;
  travel: number;
  /** When the camera path ends (the space leaves from there). */
  pathEnd: number;
  /** True when the focus instants are the cards' own `at` (their words), false when they were spread evenly. */
  aligned: boolean;
}

/**
 * When the camera stops on each card. The cards' `at` (the word that names them) win when the camera has room to
 * arrive on the first and to travel between the others; otherwise the stops are spread evenly. A window too short for
 * its cards has no schedule.
 */
export function schedule(s: Pick<Space, "start" | "end" | "cards">): Schedule | null {
  const n = s.cards.length;
  const pathEnd = r3(s.end - EXIT);
  const hints = s.cards.map((c) => c.at);
  if (n >= 1 && hints.every((h): h is number => h !== undefined)) {
    const f = hints.map(r3);
    const arrive = f[0] - s.start;
    const ok = arrive >= 0.45 && arrive <= 1.2 &&
      f.every((x, k) => k === 0 || x - f[k - 1] >= TRAVEL + 0.3 - 1e-9) && pathEnd - f[n - 1] >= MIN_DWELL - 1e-9;
    if (ok) return { focus: f, arrive: r3(arrive), travel: TRAVEL, pathEnd, aligned: true };
  }
  const dwell = (pathEnd - s.start - ARRIVE - (n - 1) * TRAVEL) / n;
  if (n < 1 || dwell < MIN_DWELL) return null;
  return {
    focus: s.cards.map((_, k) => r3(s.start + ARRIVE + k * (dwell + TRAVEL))),
    arrive: ARRIVE, travel: TRAVEL, pathEnd, aligned: false,
  };
}

const num = (v: number) => Math.round(v * 100) / 100;

/**
 * The GSAP lines of one space (`idx` is its position among the kept spaces: the element id is `sp<idx>`). Sets come
 * first, then tweens; the camera path is gapless from the start of the space to the start of its exit.
 */
export function spaceTimeline(s: Space, idx: number, W: number, H: number, unit: number): string[] {
  const sch = schedule(s);
  if (!sch) return [];
  const id = `#sp${idx}`;
  const out: string[] = [];
  const n = s.cards.length;
  const pose = (k: number) => {
    const p = cardPose(k, W, H, unit);
    return { x: -p.x, y: -p.y, z: -p.z, ry: -3 * k };
  };
  const props = (p: { x: number; y: number; z: number; ry: number }) => `x: ${num(p.x)}, y: ${num(p.y)}, z: ${num(p.z)}, rotationY: ${num(p.ry)}`;

  // Cards: the depth blur is a baseline at the start, then one relaxation per leg of the path.
  s.cards.forEach((_, k) => out.push(`tl.set("${id} .cd${k} .cd-blur", { filter: "blur(${blurPx(k, unit)}px)" }, ${r3(s.start)});`));

  // Entry: the cards open in a short cascade (the 0.5 s cap on staggers), back to front would hide the near ones.
  const gap = n > 1 ? Math.min(0.12, Math.floor((0.5 / (n - 1)) * 1000) / 1000) : 0;
  s.cards.forEach((_, k) =>
    out.push(`tl.fromTo("${id} .cd${k} .cd-in", { opacity: 0, y: ${Math.round(40 * unit)}, scale: 0.85 }, { opacity: 1, y: 0, scale: 1, duration: 0.45, ease: "power3.out" }, ${r3(s.start + k * gap)});`));

  // The camera: from a wide pose, arrive on card 0; then, per card, a slow creep forward while it is read, and a travel
  // (the nudge curve) to the next. z only grows, x and rotationY only fall: a single direction on every axis.
  const wide = { x: Math.round(cardPose(1, W, H, unit).x * 0.5), y: Math.round(cardPose(1, W, H, unit).y * 0.5), z: -Math.round(0.9 * DZ * unit), ry: 4 };
  out.push(`tl.set("${id} .spcam", { ${props(wide)} }, ${r3(s.start)});`);
  out.push(`tl.to("${id} .spcam", { ${props(pose(0))}, duration: ${r3(sch.focus[0] - s.start)}, ease: "power3.out" }, ${r3(s.start)});`);
  const creep = Math.round(0.06 * DZ * unit);
  for (let k = 0; k < n; k++) {
    const from = pose(k);
    const dwellEnd = k < n - 1 ? r3(sch.focus[k + 1] - sch.travel) : sch.pathEnd;
    out.push(`tl.to("${id} .spcam", { z: ${num(from.z + creep)}, duration: ${r3(dwellEnd - sch.focus[k])}, ease: "none" }, ${r3(sch.focus[k])});`);
    if (k === n - 1) break;
    const a = { ...from, z: from.z + creep };
    const b = pose(k + 1);
    const d1 = r3(sch.travel * NUDGE[0].time), d2 = r3(sch.travel * NUDGE[1].time), d3 = r3(sch.travel - d1 - d2);
    let time = dwellEnd;
    NUDGE.forEach((p, i) => {
      const mix = (u: number, v: number) => u + (v - u) * p.to;
      const d = [d1, d2, d3][i];
      out.push(`tl.to("${id} .spcam", { x: ${num(mix(a.x, b.x))}, y: ${num(mix(a.y, b.y))}, z: ${num(mix(a.z, b.z))}, rotationY: ${num(mix(a.ry, b.ry))}, duration: ${d}, ease: "${p.ease}" }, ${r3(time)});`);
      time = r3(time + d);
    });
    // The focus plane moves with the camera: every card still ahead relaxes one step; the one passed leaves.
    for (let j = k + 1; j < n; j++) {
      out.push(`tl.to("${id} .cd${j} .cd-blur", { filter: "blur(${blurPx(j - k - 1, unit)}px)", duration: ${sch.travel}, ease: "power2.inOut" }, ${r3(dwellEnd)});`);
    }
    out.push(`tl.to("${id} .cd${k} .cd-in", { opacity: 0, scale: 1.12, duration: ${r3(sch.travel * 0.8)}, ease: "power2.in" }, ${r3(dwellEnd)});`);
  }

  // Exit of what is left, in the film's current: a slide that accelerates out, then its own short fade.
  const exitX = Math.round(W * 0.12);
  out.push(`tl.to("${id} .sp-out", { x: -${exitX}, duration: ${EXIT}, ease: "power4.in" }, ${r3(s.end - EXIT)});`);
  out.push(`tl.to("${id} .sp-out", { opacity: 0, duration: 0.18, ease: "none" }, ${r3(s.end - 0.2)});`);
  return out;
}

const KINDS: Record<Mograph["kind"], { tag: string; glyph: string }> = {
  counter: { tag: "CHIFFRE", glyph: "#" }, list: { tag: "LISTE", glyph: "1" }, callout: { tag: "ALERTE", glyph: "!" },
  question: { tag: "QUESTION", glyph: "?" }, definition: { tag: "DÉFINITION", glyph: "i" }, compare: { tag: "COMPARAISON", glyph: "⇄" },
  badge: { tag: "BADGE", glyph: "★" }, url: { tag: "LIEN", glyph: "↗" }, cta: { tag: "ACTION", glyph: "→" },
  hook: { tag: "ACCROCHE", glyph: "!" }, underline: { tag: "MOT CLÉ", glyph: "★" },
};

const fmtValue = (v: number) => String(Number.isInteger(v) ? v : Math.round(v * 10) / 10).replace(/\B(?=(\d{3})+(?!\d))/g, " ");

/** The face of a card, from the graphic it comes from (same kinds, same fields as `beats.mographs`). */
export function cardFace(c: SpaceCard, n: number): string {
  const k = KINDS[c.kind];
  const [a, b] = c.items ?? [];
  let main = esc(c.text.toUpperCase());
  let sub = "";
  if (c.kind === "counter" && c.value !== undefined) { main = `<span class="uc-num">${esc(fmtValue(c.value) + (c.suffix ?? ""))}</span>`; sub = c.label ?? ""; }
  else if (c.kind === "definition") { main = esc((a ?? c.text).toUpperCase()); sub = b ?? ""; }
  else if (c.kind === "compare") { main = `${esc((a ?? c.text).toUpperCase())} <span class="uc-vs">VS</span> ${esc((b ?? "").toUpperCase())}`; }
  else if (c.kind === "hook" && c.items?.length) main = esc(c.items.join(" ").toUpperCase());
  else if (c.kind === "url") main = `<span class="uc-url">${esc(c.text)}</span>`;
  const glyph = c.kind === "list" ? String(n + 1) : k.glyph;
  return `<div class="ucard uc-${c.kind}" data-layout-allow-occlusion data-layout-allow-overlap><div class="uc-top"><span class="uc-chip">${esc(glyph)}</span><span class="uc-tag">${k.tag}</span></div>` +
    `<div class="uc-main" data-layout-allow-occlusion>${main}</div>${sub ? `<div class="uc-sub" data-layout-allow-occlusion>${esc(sub)}</div>` : ""}</div>`;
}

/** The markup of the kept spaces, and their timeline through `t`. Ids are positional (`sp0`, `sp1`…). */
export function buildSpaces(spaces: Space[], W: number, H: number, unit: number, t: (s: string) => void): string {
  const vertical = H > W;
  const cy = Math.round(H * (vertical ? 0.4 : 0.48));
  const cardW = Math.round(W * (vertical ? 0.8 : 0.42));
  return spaces.map((s, idx) => {
    for (const l of spaceTimeline(s, idx, W, H, unit)) t(l);
    const cards = s.cards.map((c, k) => {
      const p = cardPose(k, W, H, unit);
      return `<div class="cd cd${k}" data-layout-allow-overlap data-layout-allow-occlusion style="left:${Math.round(W / 2)}px;top:${cy}px;width:${cardW}px;transform:translate3d(${p.x}px, ${p.y}px, ${p.z}px) translate(-50%, -50%)">` +
        `<div class="cd-in"><div class="cd-blur">${cardFace(c, k)}</div></div></div>`;
    }).join("");
    return `    <div id="sp${idx}" class="clip sp" data-start="${r3(s.start)}" data-duration="${r3(s.end - s.start)}" data-track-index="3" style="z-index:5">
      <div class="sp-out"><div class="sp-view" style="perspective-origin:50% ${cy}px"><div class="spcam" style="transform-origin:50% ${cy}px">${cards}</div></div></div>
    </div>`;
  }).join("\n");
}

export function spaceCss(style: Style, unit: number): string {
  const c = style.colors;
  const px = (v: number) => `${Math.round(v * unit)}px`;
  return `      .sp-out, .sp-view { position: absolute; inset: 0; }
      .sp-view { perspective: ${px(1800)}; }
      .spcam { position: absolute; inset: 0; transform-style: preserve-3d; }
      .cd { position: absolute; transform-style: preserve-3d; }
      .ucard { padding: ${px(34)} ${px(40)} ${px(40)}; border-radius: ${px(30)}; background: #0d0d10; color: ${c.text};
        font-family: "${style.fonts.graphic}"; box-shadow: 0 ${px(26)} ${px(70)} rgba(0,0,0,0.5); border: ${Math.max(2, Math.round(3 * unit))}px solid rgba(255,255,255,0.12); }
      .uc-top { display: flex; align-items: center; gap: ${px(16)}; margin-bottom: ${px(22)}; }
      .uc-chip { display: inline-grid; place-items: center; width: ${px(54)}; height: ${px(54)}; border-radius: 50%;
        background: ${c.accent}; color: #111; font-weight: 900; font-size: ${px(30)}; }
      .uc-tag { font-weight: 800; font-size: ${px(28)}; letter-spacing: 0.14em; opacity: 0.7; }
      .uc-main { font-weight: 900; font-size: ${px(78)}; line-height: 1.05; }
      .uc-num { font-size: ${px(170)}; color: ${c.accent}; font-variant-numeric: tabular-nums; line-height: 1; }
      .uc-vs { color: ${c.accent}; font-size: 0.7em; }
      .uc-url { font-family: "JetBrains Mono"; font-weight: 700; font-size: ${px(58)}; text-transform: none; }
      .uc-sub { margin-top: ${px(16)}; font-weight: 700; font-size: ${px(42)}; line-height: 1.2; opacity: 0.9; }`;
}

interface PlanContext {
  scenes: Beats["scenes"];
  mographs: Beats["mographs"];
  behind: Beats["behind"];
  /** Device windows (phones and browsers), which own the screen while they play. */
  windows: { target: string; start: number; end: number }[];
}
const hit = (a: { start: number; end: number }, b: { start: number; end: number }, margin = 0) => a.start < b.end + margin && a.end > b.start - margin;

/**
 * Keeps the sequences the composition can honour and says why it drops the others (hand edits come through
 * `beats.json`): too few or too many cards, a window too short for its cards, one that runs into a scene, a
 * behind-word, a graphic, a device or another sequence, and one past the budget of 3D effects (decision 23).
 */
export function planSpaces(spaces: Space[], ctx: PlanContext, max: number): { kept: Space[]; notes: string[] } {
  const kept: Space[] = [];
  const notes: string[] = [];
  for (const s of [...spaces].sort((a, b) => a.start - b.start)) {
    const drop = (why: string) => notes.push(`Séquence de cartes ${s.id} (${s.start.toFixed(2)}–${s.end.toFixed(2)} s) retirée : ${why}.`);
    if (s.cards.length < MIN_CARDS || s.cards.length > MAX_CARDS) { drop(`elle a ${s.cards.length} carte(s), il en faut de ${MIN_CARDS} à ${MAX_CARDS}`); continue; }
    if (!schedule(s)) { drop(`la fenêtre est trop courte pour ${s.cards.length} cartes (la caméra met ${ARRIVE} s à arriver, ${TRAVEL} s par trajet et ${MIN_DWELL} s par carte au moins)`); continue; }
    const scene = ctx.scenes.find((x) => hit(s, x, 0.05));
    if (scene) { drop(`elle chevauche la scène ${scene.id}`); continue; }
    const word = ctx.behind.find((x) => hit(s, x, 0.3));
    if (word) { drop(`elle chevauche le mot derrière « ${word.text} »`); continue; }
    const mg = ctx.mographs.find((x) => hit(s, x, 0.1));
    if (mg) { drop(`elle chevauche le graphisme ${mg.id} (« ${mg.text} ») : un seul à la fois`); continue; }
    const dev = ctx.windows.find((x) => hit(s, x));
    if (dev) { drop(`elle chevauche l'appareil ${dev.target}`); continue; }
    const other = kept.find((x) => hit(s, x));
    if (other) { drop(`elle chevauche ${other.id} : une séquence à la fois`); continue; }
    if (kept.length >= max) { drop(`budget de ${max} effets 3D par vidéo atteint (décision 23)`); continue; }
    kept.push(s);
  }
  return { kept, notes };
}

const ELIGIBLE = new Set<Mograph["kind"]>(["counter", "list", "definition", "compare", "callout", "question", "badge", "url"]);
const MAX_GAP = 7;
const MAX_SPAN = 16;

/**
 * Default (decision 2): three to five neighbouring graphics that `contextual.ts` and the keywords already picked are
 * staged together as one sequence, each card landing on its graphic's word. They leave the loose graphics. At most one
 * per video, inside what is left of the budget of 3D effects; a scene, a behind-word, too wide a gap or too long a span
 * keeps the graphics loose.
 */
export function proposeSpaces(
  mographs: Beats["mographs"],
  ctx: { scenes: Beats["scenes"]; behind: Beats["behind"]; duration: number },
  style: Pick<Style, "camera">,
  spent: { used?: number } = {},
): { spaces: Beats["spaces"]; mographs: Beats["mographs"] } {
  const none = { spaces: [], mographs };
  if (style.camera.max - (spent.used ?? 0) < 1) return none;
  const sorted = [...mographs].sort((a, b) => a.start - b.start);
  let best: { run: Mograph[]; space: Space } | null = null;
  for (let i = 0; i < sorted.length; i++) {
    // The longest run of neighbours that are cards, starting here, then shortened until its window holds.
    const run: Mograph[] = [];
    for (let j = i; j < sorted.length && run.length < DEFAULT_CARDS.max; j++) {
      const m = sorted[j];
      if (!ELIGIBLE.has(m.kind) || (run.length && m.start - run[run.length - 1].start > MAX_GAP)) break;
      run.push(m);
    }
    for (let n = run.length; n >= DEFAULT_CARDS.min; n--) {
      const part = run.slice(0, n);
      const f = part.map((m) => r3(m.start + 0.1));
      const start = r3(Math.max(0.05, f[0] - 0.7));
      const end = r3(Math.min(ctx.duration, part[n - 1].end + EXIT));
      if (end - start > MAX_SPAN) continue;
      const space: Space = {
        id: "", start, end,
        cards: part.map((m, k) => ({
          id: m.id, kind: m.kind, text: m.text, at: f[k],
          ...(m.items ? { items: m.items } : {}), ...(m.value !== undefined ? { value: m.value } : {}),
          ...(m.suffix !== undefined ? { suffix: m.suffix } : {}), ...(m.label ? { label: m.label } : {}),
        })),
        reason: `${n} graphismes voisins (${part.map((m) => m.kind).join(", ")}) mis en scène dans un seul espace`,
      };
      if (!schedule(space)) continue;
      if (ctx.scenes.some((x) => hit(space, x, 0.05)) || ctx.behind.some((x) => hit(space, x, 0.3))) continue;
      if (!best || n > best.run.length) best = { run: part, space };
      break;
    }
  }
  if (!best) return none;
  const gone = new Set(best.run);
  return { spaces: [{ ...best.space, id: "sp0" }], mographs: mographs.filter((m) => !gone.has(m)) };
}
