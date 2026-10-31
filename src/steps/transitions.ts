import type { Style } from "../lib/style.js";
import type { Beats } from "./beats.js";

/**
 * 3D transitions of the typography scenes (ticket 0013): the rush and a scene are two faces of one cube (or of one
 * flap) and a hard cut joins them mid-turn. "portal" is the scene's own inverse zoom-through (`stage.ts`, a Z
 * crossing with blur) and stays the default; "cube" turns on the vertical axis, "flip" on the horizontal one.
 *
 * The law of vectors (motion-doctrine): both sides of a cut move on the same axis, the same way, at the same speed,
 * and the cut falls in mid-motion. The leaving face accelerates into the cut (power2.in over OUT_T), the arriving
 * face starts from the mirror pose and decelerates out of it (power3.out over IN_T = 1.5 OUT_T: the two curves meet
 * at the same speed, 2 d / OUT_T against 3 d / IN_T). Only one side is on screen at any frame.
 */
export type TransitionKind = "portal" | "cube" | "flip";
export const KINDS: readonly TransitionKind[] = ["portal", "cube", "flip"];

export const OUT_T = 0.3;
export const IN_T = 0.45;
/** The rush needs room for the turn on each side of a scene; the budget leaves the rig at least one of the three effects. */
const MAX_SCENES = 2;
const HALF_TURN = 45;

export type Pose = Partial<Record<"rotationX" | "rotationY" | "x" | "y", number>>;
export interface SeamMotion { from: Pose; to: Pose; duration: number; ease: string }

/** The axis the ledger reads: the film's current is left (cube), a flip lifts the picture up. */
export function seamAxis(kind: Exclude<TransitionKind, "portal">): { axis: "x" | "y"; dir: 1 | -1 } {
  return kind === "cube" ? { axis: "x", dir: -1 } : { axis: "y", dir: -1 };
}

/** The pose a face holds on the cut, from rest (0): half a turn and the travel of its hinge. */
function cutPose(kind: Exclude<TransitionKind, "portal">, W: number, H: number): Pose {
  return kind === "cube"
    ? { rotationY: -HALF_TURN, x: -Math.round(W * 0.16) }
    : { rotationX: HALF_TURN, y: -Math.round(H * 0.1) };
}
const negate = (p: Pose): Pose => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, -v!]));
const zero = (p: Pose): Pose => Object.fromEntries(Object.keys(p).map((k) => [k, 0]));

/** What the face that leaves ("out": rest to the cut pose) or the one that arrives ("in": mirror pose to rest) does. */
export function seamMotion(kind: Exclude<TransitionKind, "portal">, side: "out" | "in", W: number, H: number): SeamMotion {
  const pose = cutPose(kind, W, H);
  return side === "out"
    ? { from: zero(pose), to: pose, duration: OUT_T, ease: "power2.in" }
    : { from: negate(pose), to: zero(pose), duration: IN_T, ease: "power3.out" };
}

/**
 * Perspective in proportion to the side that turns (1800 px at 1080), not to the short side: a fixed value shifts the
 * projected centre of a 1920 px wide plane enough to read as motion against the seam's direction (seen on 16:9).
 */
export const seamPerspective = (kind: Exclude<TransitionKind, "portal">, W: number, H: number) => Math.round((kind === "cube" ? W : H) * 1.67);

export const poseProps = (p: Pose) => Object.entries(p).map(([k, v]) => `${k}: ${v}`).join(", ");

export interface TransitionContext { fx: Beats["fx"]; behind: Beats["behind"]; duration: number }

const CAMERA_FX = new Set<string>(["shake", "zoomPunch", "whip", "ladder"]);
const hits = (a: { start: number; end: number }, b: { start: number; end: number }) => a.start < b.end && b.start < a.end;

/**
 * Keeps the transitions the composition can honour (decision 2: the heuristic proposes, the hand edit disposes, and
 * the plan says why it drops one): the budget of 3D effects (`max`, rig included), the room the rush needs for its
 * turn before and after the scene, no camera effect or behind-word under that turn, and scenes that touch turn as
 * one (the second takes the first's kind).
 */
export function planTransitions(scenes: Beats["scenes"], ctx: TransitionContext, max: number): { kinds: TransitionKind[]; notes: string[] } {
  const notes: string[] = [];
  const kinds: TransitionKind[] = [];
  let used = 0;
  scenes.forEach((sc, i) => {
    const want = sc.transition ?? "portal";
    const prev = scenes[i - 1];
    if (prev && sc.start - prev.end < 1 / 30 && kinds[i - 1] !== "portal") {
      kinds.push(kinds[i - 1]);
      if (want !== kinds[i - 1] && want !== "portal") notes.push(`Transition de la scène ${i} (${want}) remplacée par ${kinds[i - 1]} : deux scènes qui se touchent tournent d'un seul tenant.`);
      return;
    }
    if (want === "portal") { kinds.push("portal"); return; }
    const drop = (why: string) => { notes.push(`Transition ${want} de la scène ${i} retirée : ${why}.`); kinds.push("portal"); };
    const rushIn = { start: sc.start - OUT_T, end: sc.start };
    const rushOut = { start: sc.end, end: sc.end + IN_T };
    if (rushIn.start < 0.05 || rushOut.end > ctx.duration - 0.05) return drop("la caméra n'a pas la place de tourner avant ou après la scène");
    const touchesNext = scenes[i + 1] && scenes[i + 1].start - sc.end < 1 / 30;
    if (used >= max) return drop(`budget de ${max} effets 3D par vidéo atteint (décision 23)`);
    const busy = (w: { start: number; end: number }) =>
      ctx.fx.some((f) => CAMERA_FX.has(f.kind) && hits({ start: f.at, end: f.at + f.duration }, w)) || ctx.behind.some((b) => hits(b, w));
    if (busy(rushIn) || (!touchesNext && busy(rushOut))) return drop("un effet de caméra ou un mot derrière joue pendant le tour");
    used++;
    kinds.push(want);
  });
  return { kinds, notes };
}

/**
 * The default: the style's transition on the first scenes the plan accepts, at most two so the rig keeps one of the
 * three 3D effects. One kind per film (doctrine: two or three types, repeated).
 */
export function proposeTransitions(scenes: Beats["scenes"], ctx: TransitionContext, style: Pick<Style, "scenes" | "camera">): TransitionKind[] {
  const kind = style.scenes.transition;
  if (kind === "portal") return scenes.map(() => "portal");
  const want = scenes.map((s) => ({ ...s, transition: kind }));
  return planTransitions(want, ctx, Math.min(MAX_SCENES, style.camera.max)).kinds;
}

/** Targets of the 3D budget a plan already spends: one per scene that turns. */
export const turning = (kinds: readonly TransitionKind[]) => kinds.filter((k) => k !== "portal").length;
