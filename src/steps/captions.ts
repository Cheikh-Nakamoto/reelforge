import { CHAR_EM, esc, r3 } from "../lib/markup.js";
import type { Style } from "../lib/style.js";
import type { Beats } from "./beats.js";

type T = (line: string) => void;
type Group = Beats["captions"][number];

/**
 * Captions as top short-form edits set them in 2025–26 (Submagic / CapCut / Opus presets, HyperFrames caption blocks):
 * two or three words at a time on one line, large and heavy, legible without a box (thick outline and a hard drop
 * shadow), one base colour plus one accent, the spoken word marked, the key word bigger on its own line, an emoji as a
 * sticker above the line rather than inside it, a hard cut between groups. Looks:
 * - bold: white heavy type, black outline, the spoken word turns accent and pops (Hormozi / Beast).
 * - pill: the spoken word sits on an accent pill that hops from word to word (the rising 2026 look).
 * - editorial: sans words with the key word in a serif italic, larger (documentary / premium).
 * - minimal: heavy white, thin outline, no colour: words land as they are spoken ("dynamic minimalism").
 */

/** Caption band: font size, bottom edge of the groups and top of the tallest group (behind-words stay above it). */
export function captionZone(style: Style, W: number, H: number) {
  const unit = Math.min(W, H) / 1080;
  const vertical = H > W;
  const cap = style.captions;
  const size = Math.round(cap.size * unit * (vertical ? 1.15 : 1));
  // Portrait: chest height, clear of the platform UI (bottom ~20 %). Landscape: ~90 px from the bottom.
  const bottom = Math.round(H * (cap.position === "mid" ? (vertical ? 0.64 : 0.7) : vertical ? 0.75 : 0.91));
  const tallest = size * 1.1 * (cap.stack ? 1 + cap.emphasis : 1);
  return { size, bottom, top: Math.round(bottom - tallest) };
}

/** Relative luminance of a #rrggbb colour (WCAG). */
function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 1;
  const [r, g, b] = [0, 2, 4].map((k) => {
    const v = parseInt(m[1].slice(k, k + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function buildCaptions(groups: Group[], style: Style, W: number, H: number, t: T): { html: string; css: string } {
  const cap = style.captions;
  const c = style.colors;
  const vertical = H > W;
  const zone = captionZone(style, W, H);
  const maxW = Math.round(W * (vertical ? 0.86 : 0.8));
  const look = cap.box ? "minimal" : cap.look;
  const reveal = cap.animation === "slam" || cap.animation === "rise";
  const keyFont = cap.keyFont ?? style.fonts.caption;
  const pillText = luminance(c.accent) > 0.18 ? "#0b0b0f" : "#ffffff";
  const shadow = look === "editorial"
    ? "0 0.03em 0.08em rgba(0,0,0,0.8), 0 0 0.4em rgba(0,0,0,0.55)"
    : look === "pill" ? "0 0.06em 0 rgba(0,0,0,0.85), 0 0.1em 0.35em rgba(0,0,0,0.55)"
    : "0 0.08em 0 #000, 0 0.14em 0.35em rgba(0,0,0,0.5)";

  // Width of a word in px, from the face's average advance (capitals run wider than lower case).
  const wordW = (text: string, font: string, fs: number) =>
    text.length * (CHAR_EM[font] ?? 0.62) * fs * (cap.uppercase ? 1 : 0.86);

  const html = groups.map((g, gi) => {
    const s = r3(g.start), e = r3(g.end);
    const texts = g.words.map((w) => cap.uppercase ? w.text.toUpperCase() : w.text);
    const key = g.emphasis !== undefined && g.words[g.emphasis] ? g.emphasis : -1;
    // The key word takes its own line when it opens or closes the group (a middle word stays inline: reading order).
    const stacked = cap.stack && key >= 0 && g.words.length > 1 && (key === 0 || key === g.words.length - 1);
    const lines = stacked ? (key === 0 ? [[0], texts.map((_, j) => j).slice(1)] : [texts.map((_, j) => j).slice(0, -1), [key]]) : [texts.map((_, j) => j)];
    const lineW = (idx: number[], fs: number) => idx.reduce((sum, j, k) =>
      sum + wordW(texts[j], j === key ? keyFont : style.fonts.caption, j === key ? fs * cap.emphasis : fs) + (k ? fs * 0.26 : 0), 0);
    let fs = zone.size;
    const widest = Math.max(...lines.map((l) => lineW(l, fs)));
    if (widest > maxW) fs = Math.max(Math.round(zone.size * 0.62), Math.floor((fs * maxW) / widest));

    const wordHtml = (j: number) => {
      const cls = `cw${j === key ? " key" : ""}`;
      const pill = look === "pill" ? `<span class="pl" id="${g.id}p${j}"></span>` : "";
      return `<span class="${cls}" id="${g.id}w${j}">${pill}${esc(texts[j])}</span>`;
    };
    const inner = lines.map((l) => l.map(wordHtml).join("")).join(`<span class="br"></span>`) +
      (g.emoji ? `<span class="emo" id="${g.id}e">${g.emoji}</span>` : "");

    // Entrance: the group springs up from the line (pop / karaoke), or each word lands when spoken (slam / rise).
    if (reveal) t(`tl.set("#${g.id} .ci", { opacity: 1 }, ${s});`);
    else t(`tl.fromTo("#${g.id} .ci", { scale: 0.86, y: ${Math.round(fs * 0.22)}, opacity: 0 }, { scale: 1, y: 0, opacity: 1, duration: 0.16, ease: "back.out(2.2)" }, ${s});`);

    g.words.forEach((w, j) => {
      const id = `#${g.id}w${j}`;
      const at = r3(Math.max(g.start, w.start - 0.04));
      // The word stays marked until the next one starts: no flicker in the gaps between words.
      const until = r3(Math.min(e, g.words[j + 1]?.start ?? e));
      if (cap.animation === "slam") {
        t(j === key
          ? `tl.fromTo("${id}", { scale: 0.3, rotation: -8, opacity: 0 }, { scale: 1, rotation: 0, opacity: 1, duration: 0.3, ease: "back.out(3)" }, ${at});`
          : `tl.fromTo("${id}", { scale: 1.7, y: ${Math.round(-fs * 0.3)}, opacity: 0 }, { scale: 1, y: 0, opacity: 1, duration: 0.15, ease: "back.out(2.4)" }, ${at});`);
      } else if (cap.animation === "rise") {
        t(j === key
          ? `tl.fromTo("${id}", { y: ${Math.round(fs * 0.5)}, scale: 0.9, opacity: 0 }, { y: 0, scale: 1, opacity: 1, duration: 0.32, ease: "power3.out" }, ${at});`
          : `tl.fromTo("${id}", { y: ${Math.round(fs * 0.4)}, opacity: 0 }, { y: 0, opacity: 1, duration: 0.2, ease: "power3.out" }, ${at});`);
      } else if (cap.animation === "karaoke") {
        t(`tl.to("${id}", { opacity: 1, duration: 0.08, ease: "none" }, ${r3(w.start)});`);
      }
      // Pop and karaoke show every word from the start: the key word punches when it is spoken instead of appearing.
      if (!reveal && j === key) {
        t(`tl.to("${id}", { scale: 1.16, duration: 0.08, ease: "power2.out" }, ${at});`);
        t(`tl.to("${id}", { scale: 1, duration: 0.18, ease: "back.out(3)" }, ${r3(at + 0.08)});`);
      }
      if (!cap.highlightActive || look === "editorial" || look === "minimal") return;
      if (look === "pill") {
        t(`tl.fromTo("#${g.id}p${j}", { scale: 0.6, rotation: -6, opacity: 0 }, { scale: 1, rotation: -2, opacity: 1, duration: 0.1, ease: "back.out(2.5)" }, ${r3(w.start)});`);
        t(`tl.set("#${g.id}p${j}", { opacity: 0 }, ${until});`);
        // On the pill the outline goes (dark type with a black outline reads as a blot).
        t(`tl.set("${id}", { color: "${pillText}", textShadow: "none", "--sk": "transparent" }, ${r3(w.start)});`);
        t(`tl.set("${id}", { color: "${j === key ? c.accent : c.text}", textShadow: "${shadow}", "--sk": "#000" }, ${until});`);
      } else if (j !== key) {
        t(`tl.set("${id}", { color: "${c.accent}" }, ${r3(w.start)});`);
        t(`tl.set("${id}", { color: "${c.text}" }, ${until});`);
        if (!reveal) {
          t(`tl.to("${id}", { scale: 1.1, duration: 0.06, ease: "power2.out" }, ${r3(w.start)});`);
          t(`tl.to("${id}", { scale: 1, duration: 0.12, ease: "power2.inOut" }, ${r3(w.start + 0.06)});`);
        }
      }
    });
    if (g.emoji) {
      t(`tl.fromTo("#${g.id}e", { scale: 0, rotation: -30, y: ${Math.round(fs * 0.3)} }, { scale: 1, rotation: ${gi % 2 ? 8 : -8}, y: 0, duration: 0.35, ease: "back.out(2.6)" }, ${r3(g.start + 0.06)});`);
    }
    // Hard cut to the next group (a short fade reads as lag at 2–3 words a group).
    t(`tl.to("#${g.id} .ci", { opacity: 0, duration: 0.05, ease: "none" }, ${r3(Math.max(g.start + 0.15, e - 0.05))});`);
    return `      <div id="${g.id}" class="clip cg" data-start="${s}" data-duration="${r3(e - g.start)}"><div class="ci" style="font-size:${fs}px">${inner}</div></div>`;
  }).join("\n");

  // Bright footage (a light wall, a pale shirt) swallows white type without an outline; editorial gets a soft scrim
  // sized to the text instead (30–40 %, never a full-width bar).
  const outline = look === "bold" ? "0.13em" : look === "pill" ? "0.09em" : look === "minimal" ? "0.08em" : "0";
  const css = `
      #captions { position: absolute; inset: 0; z-index: 7; }
      .cg { position: absolute; inset: auto; left: 0; width: ${W}px; bottom: ${H - zone.bottom}px; display: flex; justify-content: center; }
      .ci { position: relative; isolation: isolate; display: flex; flex-wrap: wrap; justify-content: center; align-items: baseline; column-gap: 0.26em;
        max-width: ${maxW}px; text-align: center; opacity: 0; transform-origin: 50% 100%;
        font-family: "${style.fonts.caption}"; font-weight: ${look === "editorial" ? Math.max(700, style.fonts.captionWeight) : style.fonts.captionWeight}; line-height: 1.08; color: ${c.text};${cap.box
          ? ` background: ${c.panel}; padding: 0.16em 0.42em; border-radius: 0.28em;` : ""} }
      .cw { position: relative; z-index: 0; display: inline-block; white-space: nowrap; transform-origin: 50% 70%;
        ${outline !== "0" ? `-webkit-text-stroke: ${outline} var(--sk, #000); paint-order: stroke fill; ` : ""}text-shadow: ${shadow};${reveal ? " opacity: 0;" : cap.animation === "karaoke" ? " opacity: 0.4;" : ""} }
      .key { color: ${look === "minimal" ? c.text : c.accent}; font-size: ${cap.emphasis}em; line-height: 1; font-family: "${keyFont}";${cap.keyItalic ? " font-style: italic;" : ""}${look === "editorial" ? " font-weight: 700;" : ""}
        ${look === "bold" ? "text-shadow: 0 0.05em 0 #000, 0 0.1em 0 #000, 0 0.16em 0.35em rgba(0,0,0,0.5);" : ""} }
      .br { flex-basis: 100%; height: 0; }${look === "editorial" ? `
      .ci::before { content: ""; position: absolute; z-index: -1; inset: -0.5em -0.9em;
        background: radial-gradient(closest-side, rgba(0,0,0,0.42), rgba(0,0,0,0)); }` : ""}
      .pl { position: absolute; z-index: -1; left: -0.14em; right: -0.14em; top: 0.02em; bottom: -0.02em; border-radius: 0.2em;
        background: ${c.accent}; opacity: 0; box-shadow: 0 0.08em 0.25em rgba(0,0,0,0.35); }
      .emo { position: absolute; left: 50%; bottom: 100%; width: 1.3em; margin-left: -0.65em; margin-bottom: 0.12em; text-align: center;
        font-size: 1.25em; line-height: 1; font-family: "Noto Color Emoji"; -webkit-text-stroke: 0; }`;
  return { html, css };
}
