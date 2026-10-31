// Teaser « Coming Soon » XewXew — génère 3 compositions HyperFrames 9:16 (wolof 25 s, fr 12 s, en 12 s).
// Dark Cinematic × Kinetic Typography × Product Reveal. Une seule composition par vidéo (root "main").
// `node storyboard.mjs` réécrit work/xewxew-coming-soon/05-compose/<lang>/index.html. setup une fois avant.
import { mkdirSync, writeFileSync, symlinkSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const HERE = new URL(".", import.meta.url).pathname;
const ROOT = join(HERE, "../..");
const WORK = process.env.WORK ?? join(ROOT, "work/xewxew-coming-soon");
const W = 1080, H = 1920;
const r3 = (x) => Math.round(x * 1000) / 1000;

// Marque (Logo.tsx + design-tokens)
const C = { bg: "#0A0806", ink: "#1F1B18", em: "#0F5C4A", gold: "#C9A34E", cream: "#F0EEE9", white: "#FFFFFF" };

const VIDEOS = [
  {
    lang: "wolof", dur: 24.96, music: "dont-miss-out.m4a",
    accroche: "Lu bees a gui *ñëw",
    produit: "Sa xew, ci sa *téléphone",
    fin: "Dina *ñëw léegi",
    screens: ["tpl-faire-part", "tpl-douceur", "tpl-mocha"],
    k: { accIn: 0, drop: 4.86, accOut: 5.2, prodIn: 5.35, prodOut: 6.6, phoneIn: 6.8, phonePushEnd: 12.8, logoIn: 13.2, logoEnd: 16.5, endIn: 17.2 },
  },
  {
    lang: "fr", dur: 11.89, music: "song.m4a",
    accroche: "Quelque chose de nouveau *arrive",
    produit: "Le site de votre événement, depuis votre *téléphone",
    fin: "*Bientôt disponible",
    screens: ["tpl-faire-part", "tpl-douceur"],
    k: { accIn: 0, drop: 2.6, accOut: 2.95, prodIn: 3.1, prodOut: 4.1, phoneIn: 4.3, phonePushEnd: 6.2, logoIn: 6.2, logoEnd: 8.6, endIn: 8.5 },
  },
  {
    lang: "en", dur: 11.89, music: "song.m4a",
    accroche: "Something new is *coming",
    produit: "Your event's website, from your *phone",
    fin: "Coming *soon · Don't miss out",
    screens: ["tpl-faire-part", "tpl-douceur"],
    k: { accIn: 0, drop: 2.6, accOut: 2.95, prodIn: 3.1, prodOut: 4.1, phoneIn: 4.3, phonePushEnd: 6.2, logoIn: 6.2, logoEnd: 8.6, endIn: 8.5 },
  },
];

// Accents rythmiques mesurés (hyperframes audio) : le texte vibre dessus, en crescendo jusqu'au drop.
const BEATS = {
  "dont-miss-out.m4a": [0.21, 2.32, 2.76, 3.1, 3.5, 3.9, 4.24, 4.74, 4.86],
  "song.m4a": [0.19, 0.91, 1.76, 2.62],
};

// ---------------------------------------------------------------- helpers
const words = (text, prefix) =>
  text.split(" ").map((w, i) =>
    `<span id="${prefix}${i}" class="w${w.startsWith("*") ? " acc" : ""}">${w.replace(/^\*/, "")}</span>`).join(" ");
const ids = (prefix, text) => text.split(" ").map((_, i) => `#${prefix}${i}`);

// Révélation mot à mot (invisible → blur → net) + tip-in 3D (rotationX). firstVisible = premier mot déjà à l'écran.
function wordReveal(t, sels, t0, step = 0.5, firstVisible = false) {
  sels.forEach((el, i) => {
    if (i === 0 && firstVisible) return;
    t.push(["set", el, { opacity: 0, filter: "blur(16px)", rotationX: -45, transformOrigin: "50% 100%", transformPerspective: 900 }, 0]);
    t.push(["set", el, { opacity: 1 }, t0 + i * step]);
    t.push(["to", el, { filter: "blur(0px)", rotationX: 0, duration: 0.6, ease: "power2.out" }, t0 + i * step]);
  });
}
// Sortie en cascade (waterfall cut, vers la gauche) : power4.in.
function wordsOut(t, sels, cut) {
  let s = cut - 0.2 - 0.022 * (sels.length - 1);
  for (const el of sels) {
    t.push(["to", el, { x: -230, duration: 0.2, ease: "power4.in" }, s]);
    t.push(["to", el, { opacity: 0, duration: 0.18, ease: "power1.in" }, s]);
    s += 0.022;
  }
}
// Entrée en cascade (waterfall entry) depuis la droite.
function wordsIn(t, sels, cut) {
  let off = 0, gap = 0.05;
  for (const el of sels) {
    t.push(["set", el, { x: 230, opacity: 0 }, 0]);
    t.push(["set", el, { opacity: 0.35 }, cut + off]);
    t.push(["to", el, { x: 0, opacity: 1, duration: 0.3, ease: "power4.out" }, cut + off]);
    off += gap; gap *= 0.84;
  }
}
// Impact : scale punch + shake 4 frames (un impact, pas un tremblement).
function punch(t, sel, at) {
  t.push(["to", sel, { scale: 1.06, duration: 0.08, ease: "power2.out" }, at]);
  t.push(["to", sel, { scale: 1.0, duration: 0.22, ease: "power2.in" }, at + 0.08]);
  [[10, -6], [-7, 4.5], [3.5, -2], [0, 0]].forEach(([x, y], k) =>
    t.push(["to", sel, { x, y, duration: 1 / 30, ease: "none" }, at + k / 30]));
}
// Vibration au rythme du son : petite pulsation d'échelle sur un accent musical.
function beatPulse(t, sel, at, amp) {
  t.push(["to", sel, { scale: 1 + amp, duration: 0.04, ease: "power2.out" }, at]);
  t.push(["to", sel, { scale: 1, duration: 0.08, ease: "power2.in" }, at + 0.04]);
}

// ---------------------------------------------------------------- SFX
const SFX_CATALOG = JSON.parse(readFileSync(join(ROOT, "assets/sfx/catalog.json"), "utf8"));
const sfxEls = [];
let sfxN = 0;
function sfx(file, at, volume = 0.5, dur) {
  const key = file.endsWith(".wav") ? file : file + ".wav";
  const d = dur ?? (SFX_CATALOG[key]?.duration ?? 0.1);
  sfxEls.push(`<audio id="sfx${sfxN}" src="assets/sfx/${key}" data-start="${r3(at)}" data-duration="${r3(d)}" data-track-index="${200 + sfxN}" data-volume="${volume}"></audio>`);
  sfxN++;
}

// ---------------------------------------------------------------- typing (texte qui se tape)
// Découpe en caractères ; le mot marqué * est en accent (or italique).
function typeChars(text, prefix) {
  const out = [];
  let i = 0;
  text.split(" ").forEach((word, wi) => {
    if (wi > 0) out.push(`<span class="sp"> </span>`);
    const acc = word.startsWith("*");
    const w = word.replace(/^\*/, "");
    out.push(`<span class="wnw">`);
    for (const c of w) {
      out.push(`<span id="${prefix}${i}" class="ch${acc ? " acc" : ""}">${c}</span>`);
      i++;
    }
    out.push(`</span>`);
  });
  return { html: out.join(""), count: i };
}
// Révèle les caractères un à un, chaque frappe joue un « tick » de clavier.
function typeIn(t, count, prefix, t0, tick = 0.07) {
  for (let i = 0; i < count; i++) {
    t.push(["set", `#${prefix}${i}`, { opacity: 0 }, 0]);
    t.push(["set", `#${prefix}${i}`, { opacity: 1 }, t0 + i * tick]);
    sfx(i % 2 === 0 ? "click/tick_001" : "click/tick_002", t0 + i * tick, 0.3, 0.04);
  }
}

// ---------------------------------------------------------------- appareils multiples
// Un appareil glisse depuis un côté (alterné) vers le centre, avec rebond de collision.
function deviceIn(t, sel, from, at, dur = 0.6) {
  t.push(["set", sel, { x: from, autoAlpha: 0 }, 0]);
  t.push(["set", sel, { autoAlpha: 1 }, at]);
  t.push(["to", sel, { x: 0, duration: dur, ease: "power3.out" }, at]);
  t.push(["to", sel, { x: from > 0 ? -14 : 14, duration: 0.08, ease: "power2.out" }, at + dur]);
  t.push(["to", sel, { x: 0, duration: 0.12, ease: "power2.in" }, at + dur + 0.08]);
  sfx("whoosh/swish-3", at, 0.4);
  sfx("hit/impactPunch_heavy_000", at + dur, 0.5);
}
// Parallax zoom-through 3D : le sortant plonge en Z (scale↑ + rotationX + blur), l'entrant surgit de derrière.
function zoomThrough(t, outSel, inSel, at, dur = 0.55) {
  t.push(["to", outSel, { scale: 5, rotationX: -20, opacity: 0, filter: "blur(12px)", duration: 0.3, ease: "power2.in" }, at]);
  t.push(["set", inSel, { scale: 0.4, rotationX: 20, autoAlpha: 0 }, 0]);
  t.push(["to", inSel, { scale: 1, rotationX: 0, autoAlpha: 1, duration: dur, ease: "power2.out" }, at + 0.12]);
}

function build(v) {
  const dir = join(WORK, "05-compose", v.lang);
  const t = [];
  sfxEls.length = 0;
  sfxN = 0;
  const K = v.k;
  const acc = typeChars(v.accroche, "a");
  const prod = typeChars(v.produit, "p");
  const fin = words(v.fin, "f");
  const finIds = ids("f", v.fin);
  const devices = v.screens.map((s, i) => `<div id="dev${i}" class="device"><div class="dphone"><div class="dscreen"><img src="assets/media/images/${s}.png" alt="" /></div></div></div>`).join("");

  // Accroche (mystère) : le texte se tape caractère par caractère (son de frappe), vibre au rythme, punch au drop.
  typeIn(t, acc.count, "a", K.accIn, 0.07);
  const onsets = (BEATS[v.music] || []).filter((x) => x < K.drop);
  onsets.forEach((b, i) => beatPulse(t, `#acc`, b, 0.025 + 0.04 * (i / Math.max(onsets.length - 1, 1))));
  punch(t, `#acc`, K.drop);

  // Transition accroche → produit : parallax zoom-through (on entre dans le texte).
  zoomThrough(t, `#acc`, `#prod`, K.accOut);

  // Produit : se tape aussi, cadencé pour tenir avant la sortie.
  typeIn(t, prod.count, "p", K.prodIn, Math.max(0.02, (K.prodOut - K.prodIn - 0.1) / prod.count));

  // Transition produit → téléphone : parallax zoom-through.
  zoomThrough(t, `#prod`, `#devices`, K.prodOut);

  // Chaque écran dans son propre appareil : slide alterné droite/gauche vers le centre, crash + rebond.
  const devSpan = Math.max(0.5, K.logoIn - K.phoneIn - 0.7);
  v.screens.forEach((_, i) => {
    const at = v.screens.length === 1 ? K.phoneIn : K.phoneIn + i * devSpan / (v.screens.length - 1);
    deviceIn(t, `#dev${i}`, i % 2 === 0 ? 1150 : -1150, at, 0.55);
    t.push(["set", `#dev${i}`, { rotation: [0, -5, 5][i] || 0, scale: Math.max(0.9, 1 - i * 0.035), transformOrigin: "50% 100%" }, 0]);
  });

  // Révélation marque : les appareils sortent en parallax, le logo entre en parallax et se trace.
  zoomThrough(t, `#devices`, `#logoWrap`, K.logoIn);
  t.push([`set`, `#x1`, { strokeDashoffset: 100 }, 0]);
  t.push([`to`, `#x1`, { strokeDashoffset: 0, duration: 0.6, ease: "power2.inOut" }, K.logoIn + 0.1]);
  t.push([`set`, `#x2`, { strokeDashoffset: 100 }, 0]);
  t.push([`to`, `#x2`, { strokeDashoffset: 0, duration: 0.6, ease: "power2.inOut" }, K.logoIn + 0.3]);
  t.push([`set`, `#dot`, { opacity: 0 }, 0]);
  t.push([`to`, `#dot`, { opacity: 1, duration: 0.35, ease: "power2.out" }, K.logoIn + 0.9]);
  t.push([`set`, `#wordmark`, { opacity: 0, x: -40 }, 0]);
  t.push([`to`, `#wordmark`, { opacity: 1, x: 0, duration: 0.4, ease: "power2.out" }, K.logoIn + 1.1]);
  t.push([`set`, `#logo`, { scale: 1.0 }, 0]);
  t.push([`to`, `#logo`, { scale: 1.03, duration: K.logoEnd - K.logoIn - 1.5, ease: "none" }, K.logoIn + 1.5]);

  // Conclusion : la marque sort en parallax, la fin + CTA entrent en parallax.
  zoomThrough(t, `#logoWrap`, `#endWrap`, K.endIn);
  wordReveal(t, finIds, K.endIn, 0.35);
  t.push([`set`, `#cta`, { opacity: 0, y: 30 }, 0]);
  t.push([`to`, `#cta`, { opacity: 1, y: 0, duration: 0.4, ease: "power2.out" }, K.endIn + 1.2]);
  // lent zoom continu sur la carte de fin (push monotone, pas de creux).
  t.push([`set`, `#end`, { scale: 1.0 }, 0]);
  t.push([`to`, `#end`, { scale: 1.05, duration: v.dur - (K.endIn + 1.2), ease: "none" }, K.endIn + 1.2]);

  // États initiaux cachés → gsap.set immédiat (hors timeline) ; le reste dans la timeline.
  const initial = [];
  const tl = [];
  for (const [op, sel, vars, at] of t) {
    if (op === "set" && at === 0) initial.push(`gsap.set(${JSON.stringify(sel)}, ${JSON.stringify(vars)});`);
    else if (op === "set") tl.push(`  tl.set(${JSON.stringify(sel)}, ${JSON.stringify(vars)}, ${r3(at)});`);
    else tl.push(`  tl.to(${JSON.stringify(sel)}, ${JSON.stringify({ ...vars, duration: r3(vars.duration) })}, ${r3(at)});`);
  }

  const html = `<!doctype html>
<html lang="${v.lang}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${W}, height=${H}" />
    <script src="assets/gsap.min.js"></script>
    <style>
      @font-face { font-family: "Fraunces"; src: url("assets/fonts/Fraunces.ttf"); font-weight: 100 900; font-style: normal; }
      @font-face { font-family: "Fraunces"; src: url("assets/fonts/Fraunces-Italic.ttf"); font-weight: 100 900; font-style: italic; }
      @font-face { font-family: "Geist"; src: url("assets/fonts/Geist.ttf"); font-weight: 100 900; }
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: ${W}px; height: ${H}px; overflow: hidden; background: ${C.bg}; }
      #root { position: relative; width: ${W}px; height: ${H}px; overflow: hidden; background: ${C.bg}; color: ${C.white}; font-family: "Geist", sans-serif; perspective: 2200px; }
      .layer { position: absolute; inset: 0; }
      #bg { background: radial-gradient(circle at 50% 38%, #1c1815 0%, ${C.bg} 70%); }
      #glow1 { background: radial-gradient(circle at 50% 30%, rgba(15,92,74,0.35), rgba(15,92,74,0) 55%); }
      #glow2 { background: radial-gradient(circle at 50% 82%, rgba(201,163,78,0.22), rgba(201,163,78,0) 55%); }
      .w { display: inline-block; }
      .ch { display: inline-block; }
      .wnw { display: inline-block; white-space: nowrap; }
      .sp { display: inline-block; width: 0.28em; }
      .acc { font-family: "Fraunces", serif; font-style: italic; color: ${C.gold}; }
      .line { position: absolute; left: 90px; right: 90px; text-align: center; font-family: "Fraunces", serif; letter-spacing: -0.015em; }
      #acc { top: 720px; font-size: 118px; line-height: 1.06; color: ${C.white}; text-shadow: 0 1px 0 #d9d3c8, 0 2px 0 #8a847a, 0 3px 0 #6a645c, 0 4px 0 #4a453e, 0 5px 0 #2a2621, 0 22px 44px rgba(0,0,0,0.5); }
      #prod { top: 840px; font-size: 84px; line-height: 1.1; color: ${C.white}; text-shadow: 0 1px 0 #d9d3c8, 0 2px 0 #8a847a, 0 3px 0 #4a453e, 0 16px 34px rgba(0,0,0,0.5); }
      #devices { position: absolute; inset: 0; z-index: 4; perspective: 2400px; }
      .device { position: absolute; left: 190px; top: 480px; width: 700px; height: 1380px; }
      .dphone { position: absolute; inset: 0; border-radius: 84px; background: #0E0D0C; padding: 14px; transform-style: preserve-3d; box-shadow: 0 0 0 3px #3A3633, 0 70px 140px rgba(0,0,0,0.6); }
      .dscreen { position: relative; width: 100%; height: 100%; border-radius: 70px; overflow: hidden; background: #F8F4EE; }
      .dscreen img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: 50% 0%; }
      #logoWrap { z-index: 6; }
      #logo { position: absolute; left: 0; right: 0; top: 640px; display: flex; flex-direction: column; align-items: center; gap: 10px; }
      .mark { width: 340px; height: 340px; overflow: visible; }
      .mark path { fill: none; stroke: ${C.cream}; stroke-width: 7; stroke-linecap: round; }
      .mark .gold { fill: ${C.gold}; stroke: none; }
      #wordmark { font-family: "Fraunces", serif; font-size: 160px; line-height: 1.05; color: ${C.cream}; }
      #endWrap { z-index: 7; }
      #end { position: absolute; left: 90px; right: 90px; top: 780px; text-align: center; font-family: "Fraunces", serif; font-size: 96px; line-height: 1.1; color: ${C.white}; text-shadow: 0 1px 0 #d9d3c8, 0 2px 0 #8a847a, 0 3px 0 #4a453e, 0 16px 34px rgba(0,0,0,0.5); }
      #cta { position: absolute; left: 0; right: 0; top: 1010px; text-align: center; font-family: "Geist", sans-serif; font-weight: 600; font-size: 44px; letter-spacing: 0.2em; color: ${C.gold}; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${r3(v.dur)}" data-width="${W}" data-height="${H}">
      <div id="bg" class="layer"></div>
      <div id="glow1" class="layer"></div>
      <div id="glow2" class="layer"></div>
      <div id="acc" class="line">${acc.html}</div>
      <div id="prod" class="line">${prod.html}</div>
      <div id="devices" class="layer">${devices}</div>
      <div id="logoWrap" class="layer">
        <div id="logo">
          <svg class="mark" viewBox="0 0 52 52">
            <path id="x1" d="M14 10 38 42" stroke-dasharray="100" />
            <path id="x2" d="M38 10 14 42" stroke-dasharray="100" />
            <circle id="mask" cx="26" cy="26" r="6" fill="${C.bg}" />
            <circle class="gold" id="dot" cx="26" cy="26" r="3.6" />
          </svg>
          <div id="wordmark">XewXew</div>
        </div>
      </div>
      <div id="endWrap" class="layer">
        <div id="end">${fin}</div>
        <div id="cta">BIENTÔT DISPONIBLE</div>
      </div>
      ${sfxEls.join("\n")}
      <audio id="music" src="assets/music/${v.music}" data-timeline-role="music" data-start="0" data-duration="${r3(v.dur)}" data-track-index="1" data-volume="1"></audio>
    </div>
    <script>
      window.__timelines = window.__timelines || {};
${initial.join("\n")}
      const tl = gsap.timeline({ paused: true, defaults: { ease: "power2.out" } });
${tl.join("\n")}
      window.__timelines["main"] = tl;
    </script>
  </body>
</html>
`;
  return { dir, html };
}

for (const v of VIDEOS) {
  const { dir, html } = build(v);
  mkdirSync(dir, { recursive: true });
  // symlinks vers les assets partagés (fonts, gsap, music, images)
  const shared = join(WORK, "05-compose", "9x16", "assets");
  const target = join(dir, "assets");
  if (!existsSync(target)) symlinkSync(shared, target, "dir");
  writeFileSync(join(dir, "index.html"), html);
  console.log(`wrote ${v.lang} (${r3(v.dur)}s) -> 05-compose/${v.lang}/index.html`);
}
console.log("done");
