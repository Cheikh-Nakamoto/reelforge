import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { parse, stringify } from "yaml";
import { z } from "zod";
import { Project, readJson, ROOT } from "./lib/project.js";
import { deepMerge, loadStyle } from "./lib/style.js";
import { likeReference } from "./reference.js";

/**
 * Recipes: a validated way of editing a kind of video, kept for the next ones. A recipe holds the editor's brief (the
 * "general prompt" the driving agent follows), a base style with overrides, the formats, and for multi-rush videos
 * the structure. The questionnaire picks a recipe and adjusts it from the answers.
 */
export const RECIPES_DIR = join(ROOT, "recipes");

const Formats = z.array(z.enum(["16x9", "9x16"]));
/** Partial style, deep-merged over the base style (validated after merging). */
const Overrides = z.record(z.string(), z.unknown());

export const RecipeSchema = z.object({
  name: z.string().regex(/^[a-z0-9-]+$/),
  title: z.string(),
  description: z.string(),
  style: z.string(),
  overrides: Overrides.default({}),
  formats: Formats.default(["16x9", "9x16"]),
  engine: z.enum(["hybrid", "parakeet", "whisper"]).optional(),
  /** For several rushes: the expected parts, in order (e.g. intro face → demo screen → explanation in a bubble). */
  structure: z.string().optional(),
  /** The editor's brief the driving agent follows for this kind of video. */
  prompt: z.string(),
  /** Reference video this recipe was measured from: projects made with it keep it for the QA energy check. */
  like: z.string().optional(),
  createdFrom: z.object({ project: z.string(), at: z.string() }).optional(),
});
export type Recipe = z.infer<typeof RecipeSchema>;

const Option = z.object({
  label: z.string(),
  description: z.string().optional(),
  recipe: z.string().optional(),
  overrides: Overrides.optional(),
  formats: Formats.optional(),
});
export const QuestionnaireSchema = z.object({
  questions: z.array(z.object({
    id: z.string(),
    question: z.string(),
    multi: z.boolean().default(false),
    options: z.array(Option).min(2),
  })),
});
export type Questionnaire = z.infer<typeof QuestionnaireSchema>;

export function listRecipes(): Recipe[] {
  if (!existsSync(RECIPES_DIR)) return [];
  return readdirSync(RECIPES_DIR)
    .filter((f) => f.endsWith(".yaml") && f !== "questionnaire.yaml")
    .map((f) => loadRecipe(f.replace(/\.yaml$/, "")));
}

export function loadRecipe(name: string): Recipe {
  const file = join(RECIPES_DIR, `${name}.yaml`);
  if (!existsSync(file)) throw new Error(`Unknown recipe "${name}". Available: ${listRecipeNames().join(", ") || "(none)"}`);
  const parsed = RecipeSchema.safeParse(parse(readFileSync(file, "utf8")));
  if (!parsed.success) throw new Error(`recipes/${name}.yaml is invalid:\n${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

function listRecipeNames(): string[] {
  return existsSync(RECIPES_DIR) ? readdirSync(RECIPES_DIR).filter((f) => f.endsWith(".yaml") && f !== "questionnaire.yaml").map((f) => f.slice(0, -5)) : [];
}

export function loadQuestionnaire(): Questionnaire {
  return QuestionnaireSchema.parse(parse(readFileSync(join(RECIPES_DIR, "questionnaire.yaml"), "utf8")));
}

export interface Resolved {
  recipe: Recipe;
  style: string;
  overrides: Record<string, unknown>;
  formats: ("16x9" | "9x16")[];
  /** The brief, with the answers that shaped it, for the agent. */
  prompt: string;
}

/**
 * Answers (question id → option label, or labels for multi) → a recipe with its overrides and formats. The "type"
 * answer picks the recipe; later answers add overrides in questionnaire order; formats come from the last answer
 * that sets them.
 */
export function resolve(answers: Record<string, string | string[]>, recipeName?: string): Resolved {
  const q = loadQuestionnaire();
  const picked: z.infer<typeof Option>[] = [];
  for (const question of q.questions) {
    const a = answers[question.id];
    if (a === undefined) continue;
    for (const label of Array.isArray(a) ? a : [a]) {
      const opt = question.options.find((o) => o.label.toLowerCase() === label.toLowerCase());
      if (!opt) throw new Error(`"${label}" is not an option of ${question.id}: ${question.options.map((o) => o.label).join(", ")}`);
      picked.push(opt);
    }
  }
  const name = recipeName ?? picked.find((o) => o.recipe)?.recipe ?? listRecipeNames()[0];
  if (!name) throw new Error("No recipe: add one to recipes/");
  const recipe = loadRecipe(name);
  let overrides = recipe.overrides;
  let formats = recipe.formats;
  for (const o of picked) {
    if (o.overrides) overrides = deepMerge(overrides, o.overrides);
    if (o.formats) formats = o.formats;
  }
  loadStyle(recipe.style, overrides); // fail early on an override the style schema rejects
  const said = Object.entries(answers).map(([k, v]) => `- ${k}: ${Array.isArray(v) ? v.join(", ") : v}`).join("\n");
  return {
    recipe, style: recipe.style, overrides, formats,
    prompt: recipe.prompt + (said ? `\n\nRéponses au questionnaire :\n${said}` : ""),
  };
}

/**
 * Save a validated project as a recipe: its style and overrides, formats, structure (for an assembly) and a brief.
 * Without a brief, one is written from what the project did, for a person to refine.
 */
export function saveRecipe(projectName: string, name: string, opts: { title?: string; description?: string; prompt?: string } = {}): Recipe {
  const project = new Project(projectName);
  if (!project.exists()) throw new Error(`Unknown project "${projectName}"`);
  const meta = project.meta;
  const formats = (["16x9", "9x16"] as const).filter((f) => existsSync(project.path("render", `${project.name}_${f}.mp4`)));
  let structure: string | undefined;
  const layout = project.path("cut", "assembly.json");
  if (existsSync(layout)) {
    const a = readJson<{ parts: { name: string; kind: string }[]; frames: { mode: string; broll?: { src: string } }[] }>(layout);
    structure = a.parts.map((p) => `${p.kind === "screen" ? "enregistrement d'écran" : "face caméra"} (${p.name})`).join(" → ") +
      (a.frames.some((f) => f.broll) ? " ; le visage passe en bulle au-dessus de l'écran pendant l'explication" : "");
  }
  const beatsPath = project.path("compose", "beats.json");
  const used = existsSync(beatsPath)
    ? (() => {
      const b = readJson<{ mographs: { kind: string }[]; behind: unknown[]; frames: { mode: string }[]; fx: { kind: string }[] }>(beatsPath);
      const kinds = [...new Set(b.mographs.map((m) => m.kind))].join(", ");
      return `graphiques : ${kinds || "aucun"} ; mots derrière : ${b.behind.length} ; cadres : ${[...new Set(b.frames.map((f) => f.mode))].join(", ") || "aucun"} ; effets : ${[...new Set(b.fx.map((f) => f.kind))].join(", ") || "aucun"}`;
    })()
    : "";
  const recipe: Recipe = RecipeSchema.parse({
    name,
    title: opts.title ?? name,
    description: opts.description ?? `Recette tirée du montage validé « ${projectName} ».`,
    style: meta.style,
    overrides: meta.overrides ?? {},
    formats: formats.length ? [...formats] : ["9x16"],
    structure,
    prompt: opts.prompt ?? [
      `Monte cette vidéo comme le montage validé « ${projectName} » (style ${meta.style}).`,
      structure ? `Structure : ${structure}.` : "",
      used ? `Le montage validé utilisait — ${used}.` : "",
      "Garde les mêmes choix éditoriaux : relis le plan de coupe et les beats, corrige les noms mal entendus avec studio_fix_words, puis vérifie les planches de QA.",
    ].filter(Boolean).join("\n"),
    createdFrom: { project: projectName, at: new Date().toISOString() },
  });
  writeFileSync(join(RECIPES_DIR, `${name}.yaml`), stringify(recipe));
  return recipe;
}

/**
 * A recipe from a reference video: its measured energy and look over a base style, and a brief saying what was
 * measured. The reference stays attached, so the QA of every project made with the recipe compares against it.
 */
export async function recipeFromReference(
  file: string, name: string, style: string,
  opts: { title?: string; description?: string; formats?: ("16x9" | "9x16")[]; log?: (m: string) => void } = {},
): Promise<Recipe> {
  const like = await likeReference(file, opts.log);
  loadStyle(style, like.overrides);
  const recipe: Recipe = RecipeSchema.parse({
    name,
    title: opts.title ?? name,
    description: opts.description ?? `Recette mesurée sur la vidéo de référence « ${basename(file)} ».`,
    style,
    overrides: like.overrides,
    formats: opts.formats ?? ["9x16"],
    prompt: [
      `Monte cette vidéo avec l'énergie de « ${basename(file)} », mesurée en local :`,
      ...like.why.map((w) => `- ${w}`),
      "Les coupes suivent la parole : si la section Énergie de la QA dit le montage plus calme que la référence, " +
        "resserre le plan de coupe (minPause) ou ajoute des effets sur les moments forts, sans en mettre sur une phrase triste ou sérieuse.",
    ].join("\n"),
    like: like.reference.file,
    createdFrom: { project: `référence : ${basename(file)}`, at: new Date().toISOString() },
  });
  writeFileSync(join(RECIPES_DIR, `${name}.yaml`), stringify(recipe));
  return recipe;
}
