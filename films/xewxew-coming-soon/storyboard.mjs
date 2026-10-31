// Teaser « Coming Soon » XewXew v2 — 3 compositions HyperFrames 9:16 (wolof 25 s, fr 12 s, en 12 s).
// Dark Cinematic × Kinetic Typography × Product Reveal. Une seule composition par vidéo (root "main").
//
//   node storyboard.mjs --check       valide timings, assets, SFX, lisibilité (n'écrit rien)
//   node storyboard.mjs --only=fr     ne régénère qu'une langue
//   node storyboard.mjs               réécrit work/xewxew-coming-soon/05-compose/<lang>/index.html
//
// Tout est déterministe (PRNG à graine fixe, aucun Math.random) : même script = mêmes frames.
import { mkdirSync, writeFileSync, symlinkSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const HERE = new URL(".", import.meta.url).pathname;
const ROOT = join(HERE, "../..");
const WORK = process.env.WORK ?? join(ROOT, "work/xewxew-coming-soon");
const ARGS = process.argv.slice(2);
const CHECK = ARGS.includes("--check");
const ONLY = ARGS.find((a) => a.startsWith("--only="))?.split("=")[1];
const W = 1080, H = 1920;
const r3 = (x) => Math.round(x * 1000) / 1000;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

// Réglages globaux : coupe un effet ici si le rendu est trop lourd.
const FX = {
  grain: true,            // grain de pellicule animé (10 fps)
  dust: 26,               // particules d'or flottantes (0 = off)
  chroma: true,           // split RGB sur l'impact du drop
  fadeOut: 0.35,          // fondu au noir final (s, 0 = off)
  camDrift: 0.045,        // zoom lent continu de la caméra
  scroll: true,           // défilement interne des captures dans les téléphones
  scrollTo: "50% 40%",    // jusqu'où on scrolle (ajuste selon la hauteur de tes captures)
};

// Marque (Logo.tsx + design-tokens)
const C = { bg: "#0A0806", ink: "#1F1B18", em: "#0F5C4A", gold: "#C9A34E", goldLight: "#E8C97A", cream: "#F0EEE9", white: "#FFFFFF" };

const VIDEOS = [
  {
    lang: "wolof", dur: 24.96, music: "dont-miss-out.m4a",
    accroche: "Lu bees a gui *ñëw",
    produit: "Sa xew, ci sa *téléphone",
    fin: "Dina *ñëw léegi",
    cta: "BIENTÔT DISPONIBLE",
    screens: ["tpl-faire-part", "tpl-douceur", "tpl-mocha"],
    k: { accIn: 0, drop: 4.86, accOut: 5.2, prodIn: 5.35, prodOut: 6.6, phoneIn: 6.8, phonePushEnd: 12.8, logoIn: 13.2, logoEnd: 16.5, endIn: 17.2 },
  },
  {
    lang: "fr", dur: 11.89, music: "song.m4a",
    accroche: "Quelque chose de nouveau *arrive",
    produit: "Le site de votre événement, depuis votre *téléphone",
    fin: "*Bientôt disponible",
    cta: "NE MANQUEZ RIEN",
    screens: ["tpl-faire-part", "tpl-douceur"],
    k: { accIn: 0, drop: 2.6, accOut: 2.95, prodIn: 3.1, prodOut: 4.1, phoneIn: 4.3, phonePushEnd: 6.2, logoIn: 6.2, logoEnd: 8.6, endIn: 8.5 },
  },
  {
    lang: "en", dur: 11.89, music: "song.m4a",
    accroche: "Something new is *coming",
    produit: "Your event's website, from your *phone",
    fin: "Coming *soon",
    cta: "DON'T MISS OUT",
    screens: ["tpl-faire-part", "tpl-douceur"],
    k: { accIn: 0, drop: 2.6, accOut: 2.95, prodIn: 3.1, prodOut: 4.1, phoneIn: 4.3, phonePushEnd: 6.2, logoIn: 6.2, logoEnd: 8.6, endIn: 8.5 },
  },
];

// Accents rythmiques mesurés (hyperframes audio). Plus la liste est complète, plus le snap-to-beat est efficace :
// mesure aussi les beats APRÈS le drop pour que téléphones / logo tombent pile sur le rythme.
const BEATS = {
  "dont-miss-out.m4a": [0.21, 2.32, 2.76, 3.1, 3.5, 3.9, 4.24, 4.74, 4.86],
  "song.m4a": [0.19, 0.91, 1.76, 2.62],
};

// Disposition « éventail » des téléphones selon leur nombre (x en px, s = échelle, r = rotation°, z = profondeur).
const FAN = {
  1: [{ x: 0, s: 1, r: 0, z: 3 }],
  2: [{ x: -150, s: 0.9, r: -6, z: 1 }, { x: 110, s: 1, r: 3, z: 2 }],
  3: [{ x: -270, s: 0.82, r: -8, z: 1 }, { x: 270, s: 0.82, r: 8, z: 2 }, { x: 0, s: 1, r: 0, z: 3 }],
};

// ---------------------------------------------------------------- utilitaires
function rng(seed) { // mulberry32
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// Cale un instant sur le beat le plus proche (tolérance serrée : on ne déplace que ce qui est déjà presque en rythme).
const snap = (at, beats, tol = 0.08) => {
  let best = at, d = tol;
  for (const b of beats) { const e = Math.abs(b - at); if (e <= d) { best = b; d = e; } }
  return best;
};

// ---------------------------------------------------------------- SFX (tolérant : un son absent du catalogue est ignoré)
let SFX_CATALOG = {};
try { SFX_CATALOG = JSON.parse(readFileSync(join(ROOT, "assets/sfx/catalog.json"), "utf8")); }
catch { console.warn("⚠ assets/sfx/catalog.json introuvable : aucun SFX ne sera ajouté"); }
const sfxEls = [];
const missingSfx = new Set();
let sfxN = 0;
function sfx(file, at, volume = 0.5, dur) {
  const key = file.endsWith(".wav") ? file : file + ".wav";
  if (!SFX_CATALOG[key]) { missingSfx.add(key); return; }
  const d = dur ?? SFX_CATALOG[key].duration ?? 0.1;
  sfxEls.push(`<audio id="sfx${sfxN}" src="assets/sfx/${key}" data-start="${r3(at)}" data-duration="${r3(d)}" data-track-index="${200 + sfxN}" data-volume="${volume}"></audio>`);
  sfxN++;
}

// ---------------------------------------------------------------- texte
const words = (text, prefix) =>
  text.split(" ").map((w, i) =>
    `<span id="${prefix}${i}" class="w${w.startsWith("*") ? " acc" : ""}">${esc(w.replace(/^\*/, ""))}</span>`).join(" ");
const ids = (prefix, text) => text.split(" ").map((_, i) => `#${prefix}${i}`);

// Découpe en caractères (le mot marqué * est en accent or italique). meta : id, accent, index de mot, index dans le mot.
function typeChars(text, prefix) {
  const out = [], meta = [];
  let i = 0;
  text.split(" ").forEach((word, wi) => {
    if (wi > 0) out.push(`<span class="sp"> </span>`);
    const acc = word.startsWith("*");
    out.push(`<span class="wnw">`);
    let c = 0;
    for (const ch of word.replace(/^\*/, "")) {
      out.push(`<span id="${prefix}${i}" class="ch${acc ? " acc" : ""}">${esc(ch)}</span>`);
      meta.push({ id: `#${prefix}${i}`, acc, w: wi, c });
      i++; c++;
    }
    out.push(`</span>`);
  });
  return { html: out.join(""), meta, count: i };
}

// Révélation caractère par caractère (ou mot par mot si le texte est trop long pour être lu) :
// cadence qui s'accélère (tension), chaque caractère monte, dé-zoome et se dé-floute.
function revealText(t, items, t0, t1, mode = "char", tickEvery = 1) {
  const slots = mode === "word" ? [...new Set(items.map((m) => m.w))] : null;
  const n = mode === "word" ? slots.length : items.length;
  items.forEach((m, k) => {
    const slot = mode === "word" ? slots.indexOf(m.w) : k;
    const u = n > 1 ? slot / (n - 1) : 0;
    const at = t0 + (t1 - t0) * Math.pow(u, 0.85) + (mode === "word" ? 0.008 * m.c : 0);
    t.push(["set", m.id, { opacity: 0, y: 28, scale: 1.3, filter: "blur(10px)", transformOrigin: "50% 100%" }, 0]);
    t.push(["set", m.id, { opacity: 1 }, at]);
    t.push(["to", m.id, { y: 0, scale: 1, filter: "blur(0px)", duration: 0.22, ease: "power3.out" }, at]);
    const tick = mode === "word" ? m.c === 0 : k % tickEvery === 0;
    if (tick) sfx(slot % 2 === 0 ? "click/tick_001" : "click/tick_002", at, 0.28, 0.04);
  });
}
// Le mot d'accent est retenu jusqu'au drop, puis s'écrase à l'écran (gros, flou, haut → net) : le « money shot » de l'accroche.
function slamAccents(t, items, at) {
  items.forEach((m, j) => {
    const a = at + j * 0.035;
    t.push(["set", m.id, { opacity: 0, y: -50, scale: 2.4, filter: "blur(26px)", transformOrigin: "50% 60%" }, 0]);
    t.push(["set", m.id, { opacity: 1 }, a]);
    t.push(["to", m.id, { y: 0, scale: 1, filter: "blur(0px)", duration: 0.38, ease: "back.out(2.2)" }, a]);
  });
}
// Révélation mot à mot (invisible → blur → net) + tip-in 3D (rotationX).
function wordReveal(t, sels, t0, step = 0.5) {
  sels.forEach((el, i) => {
    t.push(["set", el, { opacity: 0, filter: "blur(16px)", rotationX: -45, transformOrigin: "50% 100%", transformPerspective: 900 }, 0]);
    t.push(["set", el, { opacity: 1 }, t0 + i * step]);
    t.push(["to", el, { filter: "blur(0px)", rotationX: 0, duration: 0.6, ease: "power2.out" }, t0 + i * step]);
  });
}

// ---------------------------------------------------------------- impacts & effets
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
// Secousse de caméra (4 frames), sur #shake — indépendante de la dérive lente de #cam.
function camShake(t, at, amp = 12) {
  [[1, -0.6], [-0.8, 0.5], [0.5, -0.3], [0, 0]].forEach(([a, b], k) =>
    t.push(["to", "#shake", { x: a * amp, y: b * amp, rotation: a * amp * 0.03, duration: 1 / 30, ease: "none" }, at + k / 30]));
}
// Flash de lumière chaude (instantané, décroissance rapide).
function flash(t, at, peak = 0.8) {
  t.push(["set", "#flash", { opacity: peak }, at]);
  t.push(["to", "#flash", { opacity: 0, duration: 0.4, ease: "power2.out" }, at]);
}
// Onde de choc : anneau doré qui se dilate.
function ring(t, sel, at, size = 6, dur = 0.9) {
  t.push(["set", sel, { scale: 0.15, opacity: 0.95 }, at]);
  t.push(["to", sel, { scale: size, duration: dur, ease: "power3.out" }, at]);
  t.push(["to", sel, { opacity: 0, duration: dur * 0.8, ease: "power1.in" }, at + dur * 0.2]);
}
// Trait de lumière horizontal (anamorphique) qui balaie l'écran à chaque transition.
function streak(t, at, y = 960) {
  t.push(["set", "#streak", { top: y, scaleX: 0, opacity: 1 }, at]);
  t.push(["to", "#streak", { scaleX: 1, duration: 0.22, ease: "power3.out" }, at]);
  t.push(["to", "#streak", { opacity: 0, duration: 0.28, ease: "power1.in" }, at + 0.14]);
}
// Parallax zoom-through 3D : le sortant plonge en Z (scale↑ + rotationX + blur), l'entrant surgit de derrière.
function zoomThrough(t, outSel, inSel, at, dur = 0.55) {
  t.push(["to", outSel, { scale: 5, rotationX: -20, opacity: 0, filter: "blur(14px)", duration: 0.3, ease: "power2.in" }, at]);
  t.push(["set", inSel, { scale: 0.4, rotationX: 20, autoAlpha: 0 }, 0]);
  t.push(["to", inSel, { scale: 1, rotationX: 0, autoAlpha: 1, duration: dur, ease: "power2.out" }, at + 0.12]);
}
// Transition complète : zoom-through + trait de lumière + whoosh.
function transition(t, outSel, inSel, at, { y = 960, vol = 0.45 } = {}) {
  zoomThrough(t, outSel, inSel, at);
  streak(t, at + 0.05, y);
  sfx("whoosh/swish-3", at, vol);
}

// Un téléphone entre (gauche / droite / bas), se pose avec rebond, caméra qui encaisse. Renvoie l'instant d'impact.
function deviceIn(t, sel, cfg, from, at, dur = 0.55) {
  const base = { rotation: cfg.r, scale: cfg.s, transformOrigin: "50% 60%", transformPerspective: 2400 };
  let hit;
  if (from === "b") {
    t.push(["set", sel, { ...base, x: cfg.x, y: 1400, rotationX: 18, autoAlpha: 0 }, 0]);
    t.push(["set", sel, { autoAlpha: 1 }, at]);
    t.push(["to", sel, { y: 0, rotationX: 0, duration: dur + 0.1, ease: "power4.out" }, at]);
    hit = at + dur + 0.1;
    t.push(["to", sel, { y: 18, duration: 0.08, ease: "power2.out" }, hit]);
    t.push(["to", sel, { y: 0, duration: 0.14, ease: "power2.in" }, hit + 0.08]);
  } else {
    const sx = from === "r" ? 1150 : -1150;
    t.push(["set", sel, { ...base, x: cfg.x + sx, rotationY: sx > 0 ? -28 : 28, autoAlpha: 0 }, 0]);
    t.push(["set", sel, { autoAlpha: 1 }, at]);
    t.push(["to", sel, { x: cfg.x, rotationY: 0, duration: dur, ease: "power3.out" }, at]);
    hit = at + dur;
    t.push(["to", sel, { x: cfg.x + (sx > 0 ? -14 : 14), duration: 0.08, ease: "power2.out" }, hit]);
    t.push(["to", sel, { x: cfg.x, duration: 0.12, ease: "power2.in" }, hit + 0.08]);
  }
  sfx("whoosh/swish-3", at, 0.4);
  sfx("hit/impactPunch_heavy_000", hit, 0.5);
  camShake(t, hit, 9);
  return hit;
}

// Poussière dorée : particules déterministes qui montent lentement (parallax, derrière le texte).
function dust(t, n, seed, dur) {
  const rnd = rng(seed), out = [];
  for (let i = 0; i < n; i++) {
    const size = 3 + rnd() * 7, left = rnd() * W, top = H * 0.15 + rnd() * H * 0.85;
    const op = 0.12 + rnd() * 0.5, blur = rnd() < 0.4 ? 2 : 0;
    out.push(`<i id="d${i}" class="dust" style="left:${r3(left)}px;top:${r3(top)}px;width:${r3(size)}px;height:${r3(size)}px;opacity:${r3(op)};filter:blur(${blur}px)"></i>`);
    t.push(["to", `#d${i}`, { y: -(350 + rnd() * 750), duration: dur, ease: "none" }, 0]);
    t.push(["to", `#d${i}`, { x: (rnd() - 0.5) * 120, duration: dur, ease: "sine.inOut" }, 0]);
  }
  return out.join("");
}

// ---------------------------------------------------------------- vérifications
const KEY_ORDER = ["accIn", "drop", "accOut", "prodIn", "prodOut", "phoneIn", "phonePushEnd", "logoIn", "logoEnd", "endIn"];
function checkVideo(v) {
  const w = [], k = v.k;
  if (v.screens.length > 3) w.push("plus de 3 écrans : la disposition en éventail est limitée à 3");
  for (let i = 1; i < KEY_ORDER.length; i++)
    if (k[KEY_ORDER[i]] < k[KEY_ORDER[i - 1]]) w.push(`${KEY_ORDER[i]} (${k[KEY_ORDER[i]]}) arrive avant ${KEY_ORDER[i - 1]} (${k[KEY_ORDER[i - 1]]})`);
  if (k.endIn + 1.6 > v.dur) w.push(`la carte de fin a seulement ${r3(v.dur - k.endIn)} s pour se lire`);
  const holdEnd = v.dur - k.endIn;
  if (holdEnd > 6) w.push(`carte de fin tenue ${r3(holdEnd)} s : envisager un ajout (rappel logo, second CTA)`);
  const A = join(WORK, "05-compose", "9x16", "assets");
  const need = ["gsap.min.js", "fonts/Fraunces.ttf", "fonts/Fraunces-Italic.ttf", "fonts/Geist.ttf", `music/${v.music}`, ...v.screens.map((s) => `media/images/${s}.png`)];
  for (const f of need) if (!existsSync(join(A, f))) w.push(`asset manquant : assets/${f}`);
  return w;
}

// ---------------------------------------------------------------- build
function build(v) {
  const dir = join(WORK, "05-compose", v.lang);
  const t = [];
  sfxEls.length = 0; sfxN = 0; missingSfx.clear();

  const beats = BEATS[v.music] ?? [];
  const K = Object.fromEntries(Object.entries(v.k).map(([n, x]) => [n, n === "drop" ? x : snap(x, beats)]));
  const n = v.screens.length;
  const fan = FAN[n] ?? FAN[3];
  const acc = typeChars(v.accroche, "a");
  const prod = typeChars(v.produit, "p");
  const fin = words(v.fin, "f");
  const finIds = ids("f", v.fin);
  const nFin = v.fin.split(" ").length;

  // Perspective propre à chaque scène (les scènes sont dans #cam > #shake, donc plus enfants directs du root).
  for (const sel of ["#acc", "#prod", "#devices", "#logoWrap", "#endWrap"]) t.push(["set", sel, { transformPerspective: 1800 }, 0]);

  // ---- Atmosphère : caméra, fond en parallax, lueurs qui respirent, poussière, grain
  t.push(["set", "#streak", { scaleX: 0, opacity: 0 }, 0]);
  t.push(["to", "#back", { scale: 1.12, duration: v.dur, ease: "none" }, 0]);
  t.push(["to", "#cam", { scale: 1 + FX.camDrift, duration: v.dur, ease: "none" }, 0]);
  const half = v.dur / 2;
  t.push(["to", "#cam", { rotation: 0.35, x: 8, duration: half, ease: "sine.inOut" }, 0]);
  t.push(["to", "#cam", { rotation: -0.25, x: -6, duration: half, ease: "sine.inOut" }, half]);
  for (let i = 0, at = 0; at < v.dur; i++, at += 2.4) {
    t.push(["to", "#glow1", { opacity: i % 2 ? 1 : 0.65, duration: 2.4, ease: "sine.inOut" }, at]);
    t.push(["to", "#glow2", { opacity: i % 2 ? 0.7 : 1, duration: 2.4, ease: "sine.inOut" }, at]);
  }
  const dustHtml = FX.dust > 0 ? dust(t, FX.dust, 7, v.dur) : "";
  if (FX.grain) {
    const g = rng(11);
    for (let f = 0; f < Math.floor(v.dur * 10); f++)
      t.push(["set", "#grain", { x: -Math.floor(g() * 200), y: -Math.floor(g() * 200) }, f / 10]);
  }

  // ---- 1. Accroche (mystère) : le texte se tape en accélérant, le mot d'accent est retenu et s'écrase sur le drop
  const plain = acc.meta.filter((m) => !m.acc), accents = acc.meta.filter((m) => m.acc);
  const hold = accents.length > 0;
  revealText(t, hold ? plain : acc.meta, K.accIn + 0.1, Math.max(hold ? K.drop - 0.14 : K.accOut - 0.3, K.accIn + 0.8), "char", 1);
  if (hold) slamAccents(t, accents, K.drop);
  const onsets = beats.filter((x) => x < K.drop);
  onsets.forEach((b, i) => beatPulse(t, "#acc", b, 0.025 + 0.04 * (i / Math.max(onsets.length - 1, 1))));

  // Le drop : punch + secousse caméra + flash + onde de choc + split RGB + poussière qui gicle + impact sonore.
  punch(t, "#acc", K.drop);
  camShake(t, K.drop, 16);
  flash(t, K.drop, 0.75);
  ring(t, "#ring1", K.drop, 7, 1.0);
  if (FX.chroma) {
    t.push(["set", "#acc", { filter: "drop-shadow(10px 0 0 rgba(255,40,80,0.75)) drop-shadow(-10px 0 0 rgba(0,210,255,0.75))" }, K.drop]);
    t.push(["to", "#acc", { filter: "drop-shadow(0px 0 0 rgba(255,40,80,0)) drop-shadow(0px 0 0 rgba(0,210,255,0))", duration: 0.35, ease: "power3.out" }, K.drop]);
    t.push(["set", "#acc", { filter: "none" }, K.drop + 0.36]);
  }
  t.push(["to", "#dustLayer", { scale: 1.18, duration: 0.12, ease: "power2.out" }, K.drop]);
  t.push(["to", "#dustLayer", { scale: 1.0, duration: 1.2, ease: "power3.out" }, K.drop + 0.12]);
  sfx("hit/impactPunch_heavy_000", K.drop, 0.6);

  // ---- 2. Accroche → produit
  transition(t, "#acc", "#prod", K.accOut);

  // Produit : par caractère si c'est lisible, par mot sinon (> 26 caractères/s on ne lit plus rien).
  const prodEnd = K.prodOut - 0.35;
  const cps = prod.count / Math.max(prodEnd - K.prodIn, 0.1);
  const prodMode = cps > 26 ? "word" : "char";
  revealText(t, prod.meta, K.prodIn, prodEnd, prodMode, 2);

  // ---- 3. Produit → téléphones
  transition(t, "#prod", "#devices", K.prodOut);

  // Éventail de téléphones : arrivées rapprochées pour laisser le héros respirer, puis scroll interne + flottement.
  const step = clamp((K.logoIn - K.phoneIn - 1.2) / Math.max(n - 1, 1), 0.45, 0.9);
  const from = n === 3 ? ["l", "r", "b"] : n === 2 ? ["l", "b"] : ["b"];
  v.screens.forEach((_, i) => {
    const sel = `#dev${i}`;
    const hit = deviceIn(t, sel, fan[i], from[i], K.phoneIn + i * step, 0.55);
    // reflet qui balaie l'écran à l'impact
    t.push(["set", `#gl${i}`, { xPercent: -160, skewX: -18 }, 0]);
    t.push(["to", `#gl${i}`, { xPercent: 340, duration: 0.9, ease: "power2.inOut" }, hit + 0.05]);
    // la page défile doucement dans le téléphone
    if (FX.scroll) {
      const s0 = hit + 0.3;
      t.push(["to", `${sel} img`, { objectPosition: FX.scrollTo, duration: Math.max(1, K.logoIn - 0.3 - s0), ease: "power1.inOut" }, s0]);
    }
    // flottement lent (alterné)
    const b0 = hit + 0.3;
    t.push(["to", sel, { y: i % 2 ? 12 : -12, duration: Math.max(0.5, K.logoIn - b0), ease: "sine.inOut" }, b0]);
  });
  // poussée + tilt 3D continus sur tout le groupe, après l'entrée en zoom-through
  const ps = Math.max(K.phoneIn, K.prodOut + 0.12 + 0.55);
  t.push(["set", "#devices", { rotationY: 6 }, 0]);
  if (K.phonePushEnd > ps + 0.3)
    t.push(["to", "#devices", { scale: 1.07, rotationY: -6, duration: K.phonePushEnd - ps, ease: "none" }, ps]);

  // ---- 4. Révélation marque
  const L = K.logoIn;
  transition(t, "#devices", "#logoWrap", L, { y: 807 });
  t.push(["set", "#x1", { strokeDashoffset: 100 }, 0]);
  t.push(["to", "#x1", { strokeDashoffset: 0, duration: 0.6, ease: "power2.inOut" }, L + 0.1]);
  t.push(["set", "#x2", { strokeDashoffset: 100 }, 0]);
  t.push(["to", "#x2", { strokeDashoffset: 0, duration: 0.6, ease: "power2.inOut" }, L + 0.3]);
  // le point d'or s'allume : pop élastique + onde + flash + impact
  t.push(["set", "#dot", { opacity: 0, scale: 0, transformOrigin: "50% 50%" }, 0]);
  t.push(["to", "#dot", { opacity: 1, scale: 1, duration: 0.45, ease: "back.out(3)" }, L + 0.9]);
  ring(t, "#ring2", L + 0.9, 5, 0.9);
  flash(t, L + 0.9, 0.35);
  camShake(t, L + 0.9, 7);
  sfx("hit/impactPunch_heavy_000", L + 0.9, 0.5);
  // halo qui s'ouvre puis respire derrière le logo
  t.push(["set", "#bloom", { opacity: 0, scale: 0.5 }, 0]);
  t.push(["to", "#bloom", { opacity: 1, scale: 1.1, duration: 1.2, ease: "power2.out" }, L + 0.9]);
  t.push(["to", "#bloom", { scale: 1.25, duration: Math.max(0.8, K.logoEnd - L - 2.1), ease: "sine.inOut" }, L + 2.1]);
  // wordmark : chaque lettre monte depuis un masque
  [..."XewXew"].forEach((_, i) => {
    t.push(["set", `#m${i}`, { yPercent: 115 }, 0]);
    t.push(["to", `#m${i}`, { yPercent: 0, duration: 0.6, ease: "power4.out" }, L + 0.95 + i * 0.06]);
  });
  t.push(["set", "#logo", { scale: 1.0 }, 0]);
  t.push(["to", "#logo", { scale: 1.03, duration: Math.max(0.5, K.logoEnd - L - 1.5), ease: "none" }, L + 1.5]);

  // ---- 5. Conclusion : fin + CTA localisé
  const E = K.endIn;
  transition(t, "#logoWrap", "#endWrap", E);
  wordReveal(t, finIds, E + 0.12, 0.35);
  const ctaAt = E + 0.12 + 0.35 * (nFin - 1) + 0.5;
  t.push(["set", "#cta", { opacity: 0, y: 30, scale: 1.04 }, 0]);
  t.push(["to", "#cta", { opacity: 1, y: 0, scale: 1, duration: 0.7, ease: "power3.out" }, ctaAt]);
  t.push(["set", "#rule", { scaleX: 0 }, 0]);
  t.push(["to", "#rule", { scaleX: 1, duration: 0.5, ease: "power2.out" }, ctaAt + 0.3]);
  // lent zoom continu sur la carte de fin (push monotone, pas de creux)
  t.push(["set", "#end", { scale: 1.0 }, 0]);
  t.push(["to", "#end", { scale: 1.05, duration: Math.max(0.5, v.dur - ctaAt), ease: "none" }, ctaAt]);

  // fondu final + garantie que la timeline dure exactement la composition
  if (FX.fadeOut > 0) t.push(["to", "#fade", { autoAlpha: 1, duration: FX.fadeOut, ease: "power1.in" }, v.dur - FX.fadeOut]);
  t.push(["set", "#root", { opacity: 1 }, v.dur]);

  // États initiaux cachés → gsap.set immédiat (hors timeline) ; le reste dans la timeline.
  const initial = [], tl = [];
  for (const [op, sel, vars, at] of t) {
    if (op === "set" && at === 0) initial.push(`gsap.set(${JSON.stringify(sel)}, ${JSON.stringify(vars)});`);
    else if (op === "set") tl.push(`  tl.set(${JSON.stringify(sel)}, ${JSON.stringify(vars)}, ${r3(at)});`);
    else tl.push(`  tl.to(${JSON.stringify(sel)}, ${JSON.stringify({ ...vars, duration: r3(vars.duration) })}, ${r3(at)});`);
  }

  const devices = v.screens.map((s, i) =>
    `<div id="dev${i}" class="device" style="z-index:${fan[i].z}"><div class="dphone"><div class="dscreen"><img src="assets/media/images/${s}.png" alt="" /><div id="gl${i}" class="gloss"></div><div class="island"></div></div></div></div>`).join("");
  const wordmark = [..."XewXew"].map((c, i) => `<span class="mc"><span id="m${i}" class="mi">${c}</span></span>`).join("");

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
      #root { position: relative; width: ${W}px; height: ${H}px; overflow: hidden; background: ${C.bg}; color: ${C.white}; font-family: "Geist", sans-serif; }
      .layer { position: absolute; inset: 0; }
      #back, #cam, #shake { position: absolute; inset: 0; }
      #back { transform-origin: 50% 45%; }
      #bg { background: radial-gradient(circle at 50% 38%, #1c1815 0%, ${C.bg} 70%); }
      #glow1 { background: radial-gradient(circle at 50% 30%, rgba(15,92,74,0.35), rgba(15,92,74,0) 55%); }
      #glow2 { background: radial-gradient(circle at 50% 82%, rgba(201,163,78,0.22), rgba(201,163,78,0) 55%); }
      .dust { position: absolute; border-radius: 50%; background: ${C.goldLight}; box-shadow: 0 0 10px rgba(232,201,122,0.8); }
      .w { display: inline-block; }
      .ch { display: inline-block; }
      .wnw { display: inline-block; white-space: nowrap; }
      .sp { display: inline-block; width: 0.28em; }
      .acc { font-family: "Fraunces", serif; font-style: italic; color: ${C.gold};
        text-shadow: 0 1px 0 ${C.goldLight}, 0 2px 0 #8a6d2a, 0 3px 0 #5a4518, 0 4px 0 #3a2c0f, 0 22px 44px rgba(0,0,0,0.5), 0 0 50px rgba(201,163,78,0.35); }
      .line { position: absolute; left: 90px; right: 90px; top: 0; bottom: 0; padding-bottom: 140px; display: flex; align-items: center; justify-content: center; text-align: center; font-family: "Fraunces", serif; letter-spacing: -0.015em; }
      .line .in { max-width: 100%; }
      #acc { font-size: 118px; line-height: 1.06; color: ${C.white}; text-shadow: 0 1px 0 #d9d3c8, 0 2px 0 #8a847a, 0 3px 0 #6a645c, 0 4px 0 #4a453e, 0 5px 0 #2a2621, 0 22px 44px rgba(0,0,0,0.5); }
      #prod { font-size: 84px; line-height: 1.1; color: ${C.white}; text-shadow: 0 1px 0 #d9d3c8, 0 2px 0 #8a847a, 0 3px 0 #4a453e, 0 16px 34px rgba(0,0,0,0.5); }
      #devices { position: absolute; inset: 0; z-index: 4; }
      .device { position: absolute; left: 190px; top: 440px; width: 700px; height: 1380px; }
      .dphone { position: absolute; inset: 0; border-radius: 84px; background: #0E0D0C; padding: 14px;
        box-shadow: 0 0 0 3px #3A3633, inset 0 0 0 2px rgba(255,255,255,0.08), 0 70px 140px rgba(0,0,0,0.6), 0 0 120px rgba(15,92,74,0.35); }
      .dscreen { position: relative; width: 100%; height: 100%; border-radius: 70px; overflow: hidden; background: #F8F4EE; }
      .dscreen img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: 50% 0%; }
      .gloss { position: absolute; top: -10%; bottom: -10%; left: 0; width: 55%; pointer-events: none; mix-blend-mode: screen;
        background: linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,0.22), rgba(255,255,255,0)); }
      .island { position: absolute; top: 26px; left: 50%; width: 190px; height: 54px; margin-left: -95px; border-radius: 30px; background: #050505; }
      #logoWrap { z-index: 6; }
      #bloom { position: absolute; left: 50%; top: 807px; width: 1000px; height: 1000px; margin: -500px 0 0 -500px; border-radius: 50%;
        background: radial-gradient(circle, rgba(201,163,78,0.30), rgba(201,163,78,0) 62%); }
      #logo { position: absolute; inset: 0; padding-bottom: 120px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; }
      .mark { width: 340px; height: 340px; overflow: visible; }
      .mark path { fill: none; stroke: ${C.cream}; stroke-width: 7; stroke-linecap: round; }
      .mark .gold { fill: ${C.gold}; stroke: none; }
      #wordmark { font-family: "Fraunces", serif; font-size: 160px; line-height: 1.05; color: ${C.cream}; display: flex; }
      .mc { display: inline-block; overflow: hidden; padding: 0 0.01em 0.14em; }
      .mi { display: inline-block; }
      #endWrap { z-index: 7; }
      #end { position: absolute; left: 90px; right: 90px; top: 780px; text-align: center; font-family: "Fraunces", serif; font-size: 96px; line-height: 1.1; color: ${C.white}; text-shadow: 0 1px 0 #d9d3c8, 0 2px 0 #8a847a, 0 3px 0 #4a453e, 0 16px 34px rgba(0,0,0,0.5); }
      #cta { position: absolute; left: 0; right: 0; top: 1010px; text-align: center; font-family: "Geist", sans-serif; font-weight: 600; font-size: 44px; letter-spacing: 0.2em; color: ${C.gold}; }
      #rule { position: absolute; left: 50%; top: 1090px; width: 240px; height: 2px; margin-left: -120px; background: ${C.gold}; }
      /* Couches d'effets au-dessus de tout (hors caméra) */
      #fx { position: absolute; inset: 0; z-index: 20; pointer-events: none; }
      .ring { position: absolute; left: 50%; width: 300px; height: 300px; margin: -150px 0 0 -150px; border-radius: 50%; border: 3px solid ${C.gold}; opacity: 0;
        box-shadow: 0 0 40px rgba(201,163,78,0.5), inset 0 0 40px rgba(201,163,78,0.3); }
      #ring1 { top: 890px; }
      #ring2 { top: 807px; }
      #streak { position: absolute; left: 0; width: 100%; top: 960px; height: 4px; margin-top: -2px; opacity: 0;
        background: linear-gradient(90deg, rgba(201,163,78,0), ${C.gold} 25%, #fff 50%, ${C.gold} 75%, rgba(201,163,78,0));
        box-shadow: 0 0 30px 6px rgba(201,163,78,0.55); }
      #flash { opacity: 0; mix-blend-mode: screen; background: radial-gradient(circle at 50% 46%, rgba(255,240,200,0.95), rgba(201,163,78,0.55) 45%, rgba(201,163,78,0) 75%); }
      #vig { background: radial-gradient(ellipse at 50% 50%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.65) 100%); }
      #grain { inset: -200px; opacity: ${FX.grain ? 0.09 : 0}; mix-blend-mode: overlay;
        background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='300' height='300'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix type='saturate' values='0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>"); }
      #fade { background: ${C.bg}; opacity: 0; visibility: hidden; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${r3(v.dur)}" data-width="${W}" data-height="${H}">
      <div id="back">
        <div id="bg" class="layer"></div>
        <div id="glow1" class="layer"></div>
        <div id="glow2" class="layer"></div>
        <div id="dustLayer" class="layer">${dustHtml}</div>
      </div>
      <div id="cam"><div id="shake">
        <div id="acc" class="line"><div class="in">${acc.html}</div></div>
        <div id="prod" class="line"><div class="in">${prod.html}</div></div>
        <div id="devices" class="layer">${devices}</div>
        <div id="logoWrap" class="layer">
          <div id="bloom"></div>
          <div id="logo">
            <svg class="mark" viewBox="0 0 52 52">
              <path id="x1" d="M14 10 38 42" stroke-dasharray="100" />
              <path id="x2" d="M38 10 14 42" stroke-dasharray="100" />
              <circle id="mask" cx="26" cy="26" r="6" fill="${C.bg}" />
              <circle class="gold" id="dot" cx="26" cy="26" r="3.6" />
            </svg>
            <div id="wordmark">${wordmark}</div>
          </div>
        </div>
        <div id="endWrap" class="layer">
          <div id="end">${fin}</div>
          <div id="cta">${esc(v.cta)}</div>
          <div id="rule"></div>
        </div>
      </div></div>
      <div id="fx">
        <div id="ring1" class="ring"></div>
        <div id="ring2" class="ring"></div>
        <div id="streak"></div>
        <div id="flash" class="layer"></div>
        <div id="vig" class="layer" data-layout-allow-occlusion></div>
        <div id="grain" class="layer"></div>
        <div id="fade" class="layer"></div>
      </div>
      ${sfxEls.join("\n      ")}
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
  return { dir, html, stats: { tweens: initial.length + tl.length, sfx: sfxN, prodMode, cps: Math.round(cps), missing: [...missingSfx] } };
}

// ---------------------------------------------------------------- exécution
const todo = VIDEOS.filter((v) => !ONLY || v.lang === ONLY);
if (!todo.length) { console.error(`✗ langue inconnue : ${ONLY} (wolof | fr | en)`); process.exit(1); }

let warnings = 0;
for (const v of todo) {
  const issues = checkVideo(v);
  const { dir, html, stats } = build(v);
  warnings += issues.length + stats.missing.length;
  console.log(`${CHECK ? "✓ check" : "✓ wrote"} ${v.lang} (${r3(v.dur)}s) · ${stats.tweens} instructions GSAP · ${stats.sfx} SFX · produit en mode ${stats.prodMode} (${stats.cps} car/s)`);
  for (const i of issues) console.log(`   ⚠ ${i}`);
  if (stats.missing.length) console.log(`   ⚠ SFX absents du catalogue (ignorés) : ${stats.missing.join(", ")}`);
  if (CHECK) continue;
  mkdirSync(dir, { recursive: true });
  // symlink vers les assets partagés (fonts, gsap, music, images)
  const shared = join(WORK, "05-compose", "9x16", "assets");
  const target = join(dir, "assets");
  if (!existsSync(target)) symlinkSync(shared, target, "dir");
  writeFileSync(join(dir, "index.html"), html);
  console.log(`   → 05-compose/${v.lang}/index.html`);
}
console.log(warnings ? `terminé avec ${warnings} avertissement(s)` : "done");
