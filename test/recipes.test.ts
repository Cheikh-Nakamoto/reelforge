import assert from "node:assert/strict";
import { test } from "node:test";
import { loadStyle } from "../src/lib/style.js";
import { listRecipes, loadQuestionnaire, resolve } from "../src/recipes.js";

test("every shipped recipe uses an existing style and its overrides validate", () => {
  for (const r of listRecipes()) assert.doesNotThrow(() => loadStyle(r.style, r.overrides), r.name);
});

test("every questionnaire option resolves to a valid style", () => {
  const q = loadQuestionnaire();
  for (const question of q.questions) {
    for (const o of question.options) {
      const answers = { type: "Démo produit / tutoriel", [question.id]: question.multi ? [o.label] : o.label };
      assert.doesNotThrow(() => resolve(answers), `${question.id} → ${o.label}`);
    }
  }
});

test("answers pick the recipe, then adjust it", () => {
  const r = resolve({ type: "Reel viral", plateforme: "YouTube", sous: "x" } as never);
  assert.equal(r.recipe.name, "reel-viral");
  assert.deepEqual(r.formats, ["16x9"]);
  const calm = resolve({ type: "Storytelling / témoignage", ton: "Posé", "sous-titres": "Aucun" });
  const style = loadStyle(calm.style, calm.overrides);
  assert.equal(style.captions.enabled, false);
  assert.equal(style.effects.maxPer10s, 1);
  assert.match(calm.prompt, /ton: Posé/);
});

test("an unknown answer is an error, not a silent default", () => {
  assert.throws(() => resolve({ ton: "Furieux" }), /not an option/);
});

test("the captions answer picks a caption look", () => {
  const r = resolve({ type: "Démo produit / tutoriel", "sous-titres": "Éditorial" });
  const style = loadStyle(r.style, r.overrides);
  assert.equal(style.captions.look, "editorial");
  assert.equal(style.captions.keyItalic, true);
});
