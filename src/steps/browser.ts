import { NUDGE } from "../lib/nudge.js";
import { r3 } from "../lib/markup.js";
import type { Beats } from "./beats.js";

/**
 * The 3D browser (ticket 0014): a desktop window in perspective beside the phone, showing a screen recording that
 * scrolls, with hover frames the editor lays on it. Nothing here reads pixels: no model finds interface elements
 * (decision 2), so the frames are positions in the beats and the scroll follows them.
 */
export type DeviceKind = "phone" | "browser";
export type Hover = Beats["hovers"][number];

/** What the default choice knows about a device slot, as compose measures it. */
export interface SlotFacts { role: "screen" | "broll"; start: number; end: number; aspect: number; text: string }

const SITE = /\b(site|web|page|navigat|url|lien|http|www)|\.(com|fr|io|sn)\b/i;

/** A landscape (or square) recording is a desktop; a portrait one is a phone, whatever it talks about. */
export function wantsBrowser(f: Pick<SlotFacts, "aspect" | "text">): boolean {
  return f.aspect >= 1 || (f.aspect >= 0.8 && SITE.test(f.text));
}

/**
 * The device of each slot: the default from the recording's shape, then the editor's override (`beats.devices`). A
 * browser is a 3D effect of its own (decision 23): once the budget is spent the slot keeps the phone and says so.
 */
export function planDevices(slots: SlotFacts[], overrides: Beats["devices"], max: number): { kinds: DeviceKind[]; notes: string[] } {
  const notes: string[] = [];
  let room = Math.max(0, max);
  const kinds = slots.map((f, i) => {
    const target = `dv${i}`;
    const want = overrides.find((o) => o.target === target)?.kind ?? (wantsBrowser(f) ? "browser" : "phone");
    if (want === "phone") return "phone" as const;
    if (room <= 0) {
      notes.push(`Navigateur de ${target} remplacé par le téléphone : budget de 3 effets 3D par vidéo atteint (décision 23).`);
      return "phone" as const;
    }
    room--;
    return "browser" as const;
  });
  for (const o of overrides) if (!slots[Number(o.target.slice(2))] || !/^dv\d+$/.test(o.target)) notes.push(`Appareil ${o.id} (${o.target}) ignoré : la cible n'existe pas.`);
  return { kinds, notes };
}

export interface BrowserGeometry {
  /** Window box in the frame: the chrome (tabs + address) on top of the viewport. */
  left: number; top: number; w: number; chromeH: number; vpH: number;
  /** The page is the recording at the window's width; the viewport shows `vpH` of its `pageH`. */
  pageW: number; pageH: number;
  /** How far the page can scroll. */
  range: number;
}

const OVERSCAN = 1.25;

/**
 * The window is wider than the recording by `OVERSCAN`, so the viewport crops its height and there is always a little
 * page to scroll through; a tall (portrait) recording gets a 1.25:1 viewport and a long scroll.
 */
export function browserGeometry(W: number, H: number, aspect: number, role: "screen" | "broll"): BrowserGeometry {
  const vertical = H > W;
  const w = Math.round(W * (vertical ? 0.92 : role === "broll" ? 0.56 : 0.7));
  const chromeH = Math.round(w * 0.085);
  const va = Math.min(2.4, Math.max(1.25, aspect * OVERSCAN));
  const vpH = Math.round(w / va);
  const pageH = Math.round(w / aspect);
  const cx = role === "broll" && !vertical ? W * 0.38 : W / 2;
  // Vertical: above the caption zone (captions sit about a third from the bottom), not on the centre line.
  const cy = vertical ? H * (role === "broll" ? 0.6 : 0.4) : H / 2;
  return {
    left: Math.round(cx - w / 2), top: Math.round(cy - (chromeH + vpH) / 2), w, chromeH, vpH,
    pageW: w, pageH, range: Math.max(0, pageH - vpH),
  };
}

/** Calm part of a browser window: the entry and the push-out stay free of hover frames and scrolls. */
const CALM = { after: 0.8, before: 0.45 };
const MIN_HOVER = 0.4;
const SCROLL_T = 0.9;

export interface BrowserWindow { target: string; start: number; end: number }

/**
 * Keeps the hover frames the window can show, with the reason for each one it drops: a target that is not a browser,
 * a frame outside the page, one that runs into the entry or the exit, and one that overlaps the previous on the same
 * browser (one frame at a time reads; two compete).
 */
export function planHovers(hovers: Hover[], browsers: BrowserWindow[]): { kept: Hover[]; notes: string[] } {
  const kept: Hover[] = [];
  const notes: string[] = [];
  for (const h of [...hovers].sort((a, b) => a.at - b.at)) {
    const win = browsers.find((b) => b.target === h.target);
    const drop = (why: string) => notes.push(`Cadre de survol ${h.id} (${h.at.toFixed(2)} s sur ${h.target}) retiré : ${why}.`);
    if (!win) { drop("la cible n'est pas un navigateur de la composition"); continue; }
    if (h.duration < MIN_HOVER) { drop(`il dure moins de ${MIN_HOVER} s`); continue; }
    if (h.x < 0 || h.y < 0 || h.w <= 0 || h.h <= 0 || h.x + h.w > 1 + 1e-6 || h.y + h.h > 1 + 1e-6) { drop("il sort de la page (positions normalisées 0–1)"); continue; }
    if (h.at < win.start + CALM.after - 1e-6 || h.at + h.duration > win.end - CALM.before + 1e-6) {
      drop(`il sort de la partie calme de la fenêtre (${r3(win.start + CALM.after)}–${r3(win.end - CALM.before)} s)`);
      continue;
    }
    const prev = kept.filter((k) => k.target === h.target).at(-1);
    if (prev && h.at < prev.at + prev.duration) { drop(`il chevauche ${prev.id} : un cadre à la fois`); continue; }
    kept.push(h);
  }
  return { kept, notes };
}

export interface Scroll { at: number; duration: number; from: number; to: number }

/**
 * Scroll offsets (px, 0 = top). With hover frames, one scroll before each that brings its centre to the middle of the
 * viewport and ends on the frame's instant; with none, one reading scroll through the calm part. A scroll with no
 * room in front of its frame is skipped (the frame then shows where the page stands).
 */
export function scrollPlan(win: BrowserWindow, hovers: Hover[], g: Pick<BrowserGeometry, "pageH" | "vpH" | "range">): Scroll[] {
  const first = r3(win.start + CALM.after);
  const last = r3(win.end - CALM.before);
  if (g.range < 8) return [];
  const mine = hovers.filter((h) => h.target === win.target).sort((a, b) => a.at - b.at);
  if (!mine.length) {
    const at = r3(first + 0.2);
    const duration = r3(Math.min(1.8, last - 0.2 - at));
    return duration >= 0.6 ? [{ at, duration, from: 0, to: g.range }] : [];
  }
  const out: Scroll[] = [];
  let cur = 0;
  let free = first;
  for (const h of mine) {
    const to = Math.round(Math.min(g.range, Math.max(0, (h.y + h.h / 2) * g.pageH - g.vpH / 2)));
    const at = r3(h.at - SCROLL_T);
    if (Math.abs(to - cur) < 6 || at < free - 1e-6) continue;
    out.push({ at, duration: SCROLL_T, from: cur, to });
    cur = to;
    free = h.at;
  }
  return out;
}

/** One scroll as three tweens on the page (cut-the-curve §7), the offset going up as the page scrolls down. */
export function scrollTweens(selector: string, s: Scroll): string[] {
  let time = s.at;
  return NUDGE.map((p) => {
    const d = r3(s.duration * p.time);
    const line = `tl.to("${selector}", { y: ${-Math.round(s.from + (s.to - s.from) * p.to)}, duration: ${d}, ease: "${p.ease}" }, ${r3(time)});`;
    time += d;
    return line;
  });
}
