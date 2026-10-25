import assert from "node:assert/strict";
import { test } from "node:test";
import { loadStyle } from "../src/lib/style.js";
import { addEmojis, contextualGraphics, emphasize, pickScenes } from "../src/steps/contextual.js";
import type { Word } from "../src/lib/words.js";

const W = (text: string, from = 0): Word[] =>
  text.split(" ").map((t, i) => ({ id: `w${from + i}`, text: t, start: (from + i) * 0.4, end: (from + i) * 0.4 + 0.35 }));

const style = { ...loadStyle("tech-explainer"), mograph: { ...loadStyle("tech-explainer").mograph, hook: true } };

test("the transcript's phrasing picks the graphic", () => {
  const words = W(
    "Créer un site prêt en dix minutes. Vous le trouverez sur xewxew.click maintenant. " +
      "Un template, c'est-à-dire un modèle tout prêt. Prenez le mobile au lieu de l'ordinateur. " +
      "Pourquoi payer un graphiste ? Allez sur le site et abonnez-vous vite.",
  );
  const scores = new Map(words.map((w) => [w.id, w.text.length / 3]));
  const g = contextualGraphics(words, words.length * 0.4 + 1, style, scores);
  const kinds = g.map((m) => m.kind);
  assert.equal(g.find((m) => m.kind === "url")?.text, "xewxew.click");
  assert.deepEqual(g.find((m) => m.kind === "definition")?.items?.[0], "template");
  assert.deepEqual(g.find((m) => m.kind === "compare")?.items, ["mobile", "l'ordinateur"]);
  assert.ok(kinds.includes("question"), JSON.stringify(kinds));
  assert.ok(kinds.includes("cta"), "call to action in the last third");
  assert.ok(g.find((m) => m.kind === "hook")!.start < 0.5, "hook opens the video");
});

test("kinetic captions: one key word per group, emojis rationed", () => {
  const caps = [
    { id: "cap0", start: 0, end: 1.5, words: W("votre site gratuit") },
    { id: "cap1", start: 1.6, end: 3, words: W("en dix minutes", 3) },
    { id: "cap2", start: 6, end: 7, words: W("avec des photos", 6) },
  ];
  const scores = new Map([["w2", 2], ["w1", 1], ["w5", 1.5], ["w8", 1.2]]);
  emphasize(caps, scores);
  assert.equal(caps[0].emphasis, 2, "« gratuit »");
  addEmojis(caps);
  assert.equal(caps[0].emoji, "🌐");
  assert.equal(caps[1].emoji, undefined, "too close to the previous emoji");
  assert.equal(caps[2].emoji, "📸");
});

test("no hook from a greeting, no card for a tag question, no repeated emoji", () => {
  const words = W("Bonjour, voici votre nouveau site. On peut gérer entre nous, vous voyez?");
  const scores = new Map(words.map((w) => [w.id, w.text.toLowerCase().startsWith("bonjour") ? 9 : 1]));
  const g = contextualGraphics(words, 12, style, scores);
  assert.ok(!g.find((m) => m.kind === "hook")?.text.toLowerCase().includes("bonjour"));
  assert.ok(!g.some((m) => m.kind === "question"), "tag question");
  const caps = [
    { id: "a", start: 0, end: 1, words: W("une vidéo") },
    { id: "b", start: 5, end: 6, words: W("des vidéos", 2) },
  ];
  addEmojis(caps);
  assert.equal(caps[1].emoji, undefined);
});

test("a greeting is never the key word of a caption", () => {
  const caps = [{ id: "c", start: 0, end: 1, words: W("Bonjour, ceci") }];
  emphasize(caps, new Map([["w0", 5], ["w1", 0.1]]));
  assert.equal(caps[0].emphasis, undefined);
});

test("scenes pick a short, strong clause and stay off blocked windows", () => {
  const words = W("Bon alors aujourd'hui. Votre site prêt en 10 minutes! Ensuite on regarde les modèles ensemble tranquillement.");
  const scores = new Map(words.map((w) => [w.id, /site|minutes|10/.test(w.text) ? 2 : 0.2]));
  const s = { ...style, scenes: { ...style.scenes, max: 1 } };
  const scenes = pickScenes(words, scores, 20, s, []);
  assert.equal(scenes.length, 1);
  assert.match(scenes[0].words.map((w) => w.text).join(" "), /10 minutes/);
  assert.equal(scenes[0].words[scenes[0].emphasis!].text.replace(/\W/g, ""), "site");
  const blocked = pickScenes(words, scores, 20, s, [{ start: scenes[0].start, end: scenes[0].end }]);
  assert.ok(!blocked.some((x) => x.start === scenes[0].start));
});

test("a scene is never a discourse filler", () => {
  const words = W("Je vous montre, donc du coup, le site de votre événement.");
  const scores = new Map(words.map((w) => [w.id, /coup|donc/.test(w.text) ? 5 : 1]));
  const scenes = pickScenes(words, scores, 20, { ...style, scenes: { ...style.scenes, max: 2 } }, []);
  assert.ok(!scenes.some((s) => /coup/.test(s.words.map((w) => w.text).join(" "))), JSON.stringify(scenes.map((s) => s.words.map((w) => w.text))));
});

test("discourse is trimmed off the ends of a scene", () => {
  const words = W("intro intro intro. du coup le site de votre événement prend en 10 minutes, vous voyez.");
  const scores = new Map(words.map((w) => [w.id, /site|minutes|événement|10/.test(w.text) ? 2 : 0.1]));
  const [sc] = pickScenes(words, scores, 30, { ...style, scenes: { ...style.scenes, max: 1 } }, []);
  assert.equal(sc.words.map((w) => w.text).join(" "), "le site de votre événement prend en 10 minutes,");
});
