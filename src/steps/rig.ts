import { r3 } from "../lib/markup.js";
import type { Style } from "../lib/style.js";
import type { Beats } from "./beats.js";

/**
 * The 3D camera rig: a perspective wrapper (`.rig` > `.rigcam`) around ONE scene, phone or graphic, moved by a camera
 * (motion-doctrine's "camera with intent": a single monotonic move that arrives on the subject, never an oscillation).
 * The rush keeps its own levels (`.cam`, `.push`, `.shake`, `.drift`): a rig move never targets them.
 */
export type CameraMove = Beats["camera"][number];
export const MOVES = ["orbit", "crane", "dolly", "truck"] as const;

/** A thing the rig can wrap, with the window in which it is on screen. `dv<i>` = i-th device, as compose builds them. */
export interface RigTarget { target: string; start: number; end: number }

// Calm part of each target: a move stays out of the entry (the target's own Z handoff) and the exit, so it never
// shares a seam window with the vector the seam gate reads. Seconds after the start / before the end.
const CALM = {
  scene: { after: 0.5, before: 0.25 },
  device: { after: 0.8, before: 0.45 },
  mograph: { after: 0.5, before: 0.4 },
} as const;
const kindOf = (target: string) => (target.startsWith("sc") ? "scene" : target.startsWith("dv") ? "device" : "mograph");

/** The tweened properties of a move, from rest (0). One direction per move. */
function props(move: CameraMove["move"], unit: number, W: number): string {
  switch (move) {
    // Along the film's current (left): the subject turns towards the left.
    case "orbit": return `rotationY: -14`;
    // Elevation (reserved vector): up and tilted down onto the subject.
    case "crane": return `rotationX: 8, y: ${Math.round(-40 * unit)}`;
    // Z forward: a push, the camera goes deeper into the same thought.
    case "dolly": return `z: ${Math.round(160 * unit)}`;
    case "truck": return `x: ${Math.round(-W * 0.06)}`;
  }
}

/** Travels decelerate onto the subject (arrival); an orbit or a crane eases both ends, a travelling shot has no tail. */
const EASE: Record<CameraMove["move"], string> = { orbit: "power2.inOut", crane: "power2.inOut", dolly: "power3.out", truck: "power2.inOut" };

/** One GSAP line: the move as a single `to` on the rig (the baseline `set` is the caller's). */
export function rigTween(selector: string, c: Pick<CameraMove, "at" | "duration" | "move">, unit: number, W: number): string {
  return `tl.to("${selector}", { ${props(c.move, unit, W)}, duration: ${r3(c.duration)}, ease: "${EASE[c.move]}" }, ${r3(c.at)});`;
}

/** The properties a move leaves at rest, for the baseline `set` that comes first. */
export function rigBaseline(move: CameraMove["move"]): string {
  return { orbit: "rotationY: 0", crane: "rotationX: 0, y: 0", dolly: "z: 0", truck: "x: 0" }[move];
}

/**
 * Targets are positional, like the element ids in the composition (`sc0` is the first scene in the list, whatever its
 * id). Default camera (decision 2: a heuristic and an editable artifact). A scene takes an orbit (its inverse zoom owns the
 * Z axis); a phone and a graphic that frames a thought (hook, comparison, definition, question) take a dolly forward.
 * Priority: phones, scenes, graphics; at most `style.camera.max` (decision 23: three 3D effects per video, rig
 * included), and each only if the calm part of its target holds a move of 0.6 s at least.
 */
export function proposeCamera(
  from: { scenes: Beats["scenes"]; mographs: Beats["mographs"]; devices: RigTarget[] },
  style: Pick<Style, "camera">,
  /** 3D effects already spent (scenes that turn) and targets that already carry one. */
  spent: { used?: number; skip?: ReadonlySet<string> } = {},
): Beats["camera"] {
  const out: Beats["camera"] = [];
  const room3d = style.camera.max - (spent.used ?? 0);
  const room = (t: RigTarget, maxDur: number) => {
    const k = CALM[kindOf(t.target)];
    const at = r3(t.start + k.after);
    const duration = r3(Math.min(maxDur, t.end - k.before - at));
    return duration >= 0.6 ? { at, duration } : null;
  };
  const cands: { t: RigTarget; move: CameraMove["move"]; maxDur: number; reason: string }[] = [
    ...from.devices.map((t) => ({ t, move: "dolly" as const, maxDur: 2.2, reason: "téléphone : travelling avant sur l'écran" })),
    ...from.scenes.map((s, i) => ({ t: { target: `sc${i}`, start: s.start, end: s.end }, move: "orbit" as const, maxDur: 1.6, reason: "scène typo : orbite vers l'accent" })),
    ...from.mographs.flatMap((m, i) =>
      ["hook", "compare", "definition", "question"].includes(m.kind)
        ? [{ t: { target: `mg${i}`, start: m.start, end: m.end }, move: "dolly" as const, maxDur: 1.4, reason: `graphisme « ${m.text} » : on entre dans l'idée` }]
        : []),
  ];
  for (const c of cands) {
    if (out.length >= room3d) break;
    if (spent.skip?.has(c.t.target)) continue;
    const w = room(c.t, c.maxDur);
    if (w) out.push({ id: "", ...w, move: c.move, target: c.t.target, reason: c.reason });
  }
  return out.sort((a, b) => a.at - b.at).map((c, i) => ({ ...c, id: `cam${i}` }));
}

/**
 * Keeps the moves the composition can honour and says why it drops the others (hand edits come through `beats.json`):
 * an unknown target, a move outside the calm part of its target, a second move on a target already moving, and a
 * move past the budget.
 */
export function planRig(
  camera: Beats["camera"],
  from: { scenes: Beats["scenes"]; mographs: Beats["mographs"]; devices: RigTarget[] },
  max = 3,
  /** Targets that already carry a 3D effect (a scene that turns, a browser): one per target. */
  turns: ReadonlySet<string> = new Set(),
): { kept: Beats["camera"]; notes: string[] } {
  const targets: RigTarget[] = [
    ...from.scenes.map((s, i) => ({ target: `sc${i}`, start: s.start, end: s.end })),
    ...from.mographs.map((m, i) => ({ target: `mg${i}`, start: m.start, end: m.end })),
    ...from.devices,
  ];
  const kept: Beats["camera"] = [];
  const notes: string[] = [];
  for (const c of [...camera].sort((a, b) => a.at - b.at)) {
    const t = targets.find((x) => x.target === c.target);
    const drop = (why: string) => notes.push(`Mouvement de caméra ${c.id} (${c.move} sur ${c.target}) retiré : ${why}.`);
    if (!t) { drop("la cible n'existe pas"); continue; }
    const k = CALM[kindOf(t.target)];
    if (c.at < t.start + k.after - 1e-6 || c.at + c.duration > t.end - k.before + 1e-6) {
      drop(`il sort de la partie calme de la cible (${r3(t.start + k.after)}–${r3(t.end - k.before)} s : ni dans l'entrée ni dans la sortie)`);
      continue;
    }
    if (turns.has(c.target)) { drop("la cible porte déjà un effet 3D (transition de scène ou navigateur) : un seul par cible"); continue; }
    if (kept.some((x) => x.target === c.target)) { drop("la cible bouge déjà : un seul mouvement par cible"); continue; }
    if (kept.length >= max) { drop(`budget de ${max} effets 3D par vidéo atteint (décision 23)`); continue; }
    kept.push(c);
  }
  return { kept, notes };
}
