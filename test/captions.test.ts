import assert from "node:assert/strict";
import { test } from "node:test";
import { loadStyle } from "../src/lib/style.js";
import { groupCaptions } from "../src/steps/beats.js";
import { buildCaptions } from "../src/steps/captions.js";

const words = (text: string, at = 0) =>
  text.split(" ").map((w, i) => ({ id: `w${i}`, text: w, start: at + i * 0.4, end: at + i * 0.4 + 0.3 }));

const build = (styleName: string, g: Parameters<typeof buildCaptions>[0], over: Record<string, unknown> = {}) => {
  const style = loadStyle(styleName);
  Object.assign(style.captions, over);
  const lines: string[] = [];
  const out = buildCaptions(g, style, 1080, 1920, (l) => lines.push(l));
  return { ...out, tl: lines.join("\n"), style };
};

test("pop shows every word from the start: the key word punches, it never leaves a hole in the line", () => {
  const { html, css, tl } = build("tech-explainer", [{ id: "cap0", start: 0, end: 1.6, words: words("ça sera plutôt"), emphasis: 2 }]);
  assert.doesNotMatch(css, /\.cw \{[^}]*opacity: 0;/, "words are not hidden until spoken");
  assert.doesNotMatch(tl, /tl\.fromTo\("#cap0w2", \{[^}]*opacity: 0/, "the key word does not appear from nothing");
  assert.match(tl, /tl\.to\("#cap0w2", \{ scale: 1\.16/);
  assert.match(html, /<span class="br"><\/span><span class="cw key"/, "key word closing the group takes its own line");
});

test("pill: the spoken word sits on the pill until the next word starts", () => {
  const { tl } = build("tech-explainer", [{ id: "cap0", start: 0, end: 1.6, words: words("un site web") }]);
  assert.match(tl, /tl\.fromTo\("#cap0p1", \{ scale: 0\.6.*, 0\.4\);/);
  assert.match(tl, /tl\.set\("#cap0p1", \{ opacity: 0 \}, 0\.8\);/);
  assert.match(tl, /tl\.set\("#cap0w1", \{ color: "#0b0b0f", textShadow: "none", "--sk": "transparent" \}, 0\.4\);/, "dark text on a light accent");
});

test("slam reveals words in order as they are spoken", () => {
  const { css, tl } = build("reel-dynamique", [{ id: "cap0", start: 0, end: 1, words: words("vraiment rapide") }]);
  assert.match(css, /\.cw \{[^}]*opacity: 0;/);
  const at = [...tl.matchAll(/tl\.fromTo\("#cap0w(\d)", .*, ([\d.]+)\);/g)].map((m) => Number(m[2]));
  assert.deepEqual(at, [0, 0.36]);
});

test("a long group shrinks to fit the frame width, within limits", () => {
  const { html } = build("reel-dynamique", [{ id: "cap0", start: 0, end: 1, words: words("ANTICONSTITUTIONNELLEMENT") }]);
  const fs = Number(/class="ci" style="font-size:(\d+)px"/.exec(html)![1]);
  assert.ok(fs < 104 && fs >= Math.round(104 * 0.62), `font size ${fs}`);
});

test("groups close on the character limit as well as the word limit", () => {
  const style = loadStyle("reel-dynamique");
  const g = groupCaptions(words("développement personnel quotidien"), style, 3);
  assert.deepEqual(g.map((x) => x.words.length), [1, 1, 1]);
});

test("the editorial key word is set in the serif italic", () => {
  const { css } = build("cinematic", []);
  assert.match(css, /\.key \{[^}]*font-family: "Playfair Display"; font-style: italic;/);
});

test("a group never ends on an article or a preposition, and breaks on commas", () => {
  const style = loadStyle("tech-explainer");
  const text = (g: ReturnType<typeof groupCaptions>) => g.map((x) => x.words.map((w) => w.text).join(" "));
  assert.deepEqual(text(groupCaptions(words("mon programme de site web"), style, 3)), ["mon programme", "de site web"]);
  assert.deepEqual(text(groupCaptions(words("Bonjour, ceci est"), style, 2)), ["Bonjour,", "ceci est"]);
});
