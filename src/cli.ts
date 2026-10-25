#!/usr/bin/env node
import { parseArgs } from "node:util";
import { existsSync, readFileSync } from "node:fs";
import { continuePipeline, createProject, listProjects, openProject, runQa, status, writeDefaultTickets } from "./pipeline.js";
import { proposeTickets, showTickets, ticketClose, ticketNext } from "./tickets.js";
import { doctor, formatChecks } from "./doctor.js";
import { journaled, logEvent } from "./events.js";
import { startDashboard } from "./dashboard.js";
import { Project } from "./lib/project.js";
import { buildAssembly, loadAssemblySpec } from "./assembly.js";
import { listRecipes, recipeFromReference, resolve as resolveRecipe, saveRecipe } from "./recipes.js";
import { analyzeReference, overridesFrom } from "./reference.js";
import { listStyles } from "./lib/style.js";
import { applyCut, fixWords, proposeCut } from "./steps/cut.js";
import { applyCompose, proposeCompose } from "./steps/compose.js";
import { matteSurvey } from "./steps/matte.js";
import { audio } from "./steps/audio.js";
import { render } from "./steps/render.js";
import type { Format } from "./steps/html.js";

const HELP = `studio — rushs face caméra → vidéos montées (100 % local)

  studio run <rush> --style <nom> [--engine hybrid|parakeet|whisper] [--approve-cut] [--formats 16x9,9x16] [--quality draft|standard|high] [--workers N|auto]
      Pipeline complet. S'arrête au plan de coupe tant qu'il n'est pas validé (--approve-cut le valide).
  studio run <rush> --style <nom> --like <référence.mp4>
      Monte comme une vidéo de référence : son rythme de coupe, ses effets et son look, mesurés en local.
  studio assemble <spec.yaml> [--approve-cut] [--formats …] [--like <référence.mp4>]
      Plusieurs rushs en une vidéo (intro, explication en bulle sur l'écran, démo…). Voir skills/studio/SKILL.md.
  studio reference <vidéo> [--save-recipe <nom> --style <base>]
      Mesure une vidéo de référence (coupes, flashs, punchs, secousses, whips, zooms en escalier, look) et
      donne les réglages qui la reproduisent ; --save-recipe en fait une recette.
  studio cut <projet> [--remove w1,w2] [--restore w3] [--apply]
      Affiche / corrige le plan de coupe ; --apply le valide et rend cut.mp4.
  studio run <rush> --recipe <recette> [--answers '{"ton":"Posé"}']
  studio recipes | recipe-save <projet> <nom> [--title …] [--description …]
      Recettes : un montage validé gardé pour les suivants (brief + style + réglages + formats).
  studio fix <projet> "khemrafa.clic=xewxew.click" …
      Corrige un mot mal entendu dans la transcription (sous-titres et graphiques).
  studio step <projet> <matte|beats|compose|audio|render|qa> [--force]
  studio status <projet>
  studio tickets <projet> [--propose] [--next] [--close <id> --result "…" [--status ouvert --reprise "…"]]
      Le montage découpé en tickets, une session chacun (work/<projet>/tickets/) : tableau, suivant, fermeture.
  studio serve [--port 4600]
      Tableau de bord local (127.0.0.1) : étapes, plan de coupe, motion design, journal de Claude, QA.
  studio styles | projects | doctor

Le même pipeline est exposé en MCP : node dist/mcp.js (voir skills/studio/SKILL.md).`;

const baseLog = (m: string) => console.error(m);

async function main() {
  const { values: o, positionals: [cmd, ...args] } = parseArgs({
    allowPositionals: true,
    options: {
      style: { type: "string" },
      recipe: { type: "string" },
      like: { type: "string" },
      "save-recipe": { type: "string" },
      answers: { type: "string" },
      title: { type: "string" },
      port: { type: "string" },
      description: { type: "string" },
      name: { type: "string" },
      engine: { type: "string" },
      language: { type: "string" },
      model: { type: "string" },
      "approve-cut": { type: "boolean" },
      apply: { type: "boolean" },
      remove: { type: "string" },
      restore: { type: "string" },
      formats: { type: "string" },
      quality: { type: "string" },
      workers: { type: "string" },
      force: { type: "boolean" },
      propose: { type: "boolean" },
      next: { type: "boolean" },
      close: { type: "string" },
      result: { type: "string" },
      status: { type: "string" },
      reprise: { type: "string" },
      repropose: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  const formats = o.formats?.split(",") as Format["id"][] | undefined;
  // Render workers reach every render of this process (run, assemble, step render) through the environment.
  if (o.workers) process.env.STUDIO_RENDER_WORKERS = o.workers;
  // Every CLI run goes to the project's journal too (dashboard), with the command that started it.
  const projName = cmd === "run" && args[0] ? o.name ?? Project.nameFromSource(args[0])
    : cmd === "assemble" && args[0] && existsSync(args[0]) ? loadAssemblySpec(args[0]).name
    : ["cut", "step", "status", "fix", "recipe-save", "tickets"].includes(cmd ?? "") ? args[0] : undefined;
  const log = projName ? journaled(projName, "cli", baseLog) : baseLog;
  if (projName && cmd !== "status") logEvent(projName, { kind: "tool", source: "cli", tool: `studio ${cmd}`, args: process.argv.slice(3), message: `studio ${process.argv.slice(2).join(" ")}` });
  const quality = o.quality as "draft" | "standard" | "high" | undefined;

  switch (cmd) {
    case "run": {
      const r = o.recipe || o.answers ? resolveRecipe(o.answers ? JSON.parse(o.answers) : {}, o.recipe) : null;
      const styleName = r?.style ?? o.style;
      if (!args[0] || !styleName) throw new Error("usage: studio run <rush> --style <nom> | --recipe <recette>");
      if (r) log(`[recette] ${r.recipe.name} — ${r.style}, ${r.formats.join(" + ")}`);
      const { project, style } = await createProject(args[0], styleName, {
        overrides: r?.overrides, recipe: r?.recipe.name, formats: r?.formats, name: o.name, like: o.like ?? r?.recipe.like, engine: o.engine as "hybrid" | "parakeet" | "whisper" | undefined, language: o.language, model: o.model, log });
      writeDefaultTickets(project.name);
      const out = await continuePipeline(project, style, { approveCut: o["approve-cut"], formats, quality, repropose: o.repropose, log });
      if (out.status === "awaiting-cut-approval") {
        console.log(readFileSync(out.plan, "utf8"));
        log(`\nPlan de coupe à relire : ${out.plan}\nValider : studio cut ${project.name} --apply  (ou relancer avec --approve-cut)`);
      } else {
        for (const [f, p] of Object.entries(out.outputs)) console.log(`${f}\t${p}`);
        log(`QA : ${project.path("qa", "qa.md")}`);
      }
      return;
    }
    case "assemble": {
      const spec = { ...loadAssemblySpec(need(args[0], "spec.yaml")), ...(o.like ? { like: o.like } : {}) };
      writeDefaultTickets(spec.name, spec);
      let out = await buildAssembly(spec, { log });
      if (out.status === "awaiting-cut-approval" && o["approve-cut"]) {
        for (const p of out.pending) await applyCut(openProject(p.project).project);
        out = await buildAssembly(spec, { log });
      }
      if (out.status === "awaiting-cut-approval") {
        log("Plans de coupe à relire, puis `studio cut <projet> --apply` pour chacun :");
        for (const p of out.pending) log(`  ${p.project}\t${p.plan}`);
        return;
      }
      log(`[assembly] ${out.project}: ${out.duration.toFixed(1)}s — ${out.parts.map((p) => `${p.name} (${p.kind})`).join(" → ")}`);
      const { project, style } = openProject(out.project);
      const res = await continuePipeline(project, style, { formats, quality, repropose: o.repropose, log });
      if (res.status === "done") for (const [f, p] of Object.entries(res.outputs)) console.log(`${f}\t${p}`);
      return;
    }
    case "serve": {
      const url = await startDashboard(Number(o.port ?? 4600));
      console.log(`Tableau de bord : ${url}  (Ctrl+C pour arrêter)`);
      await new Promise(() => {});
      return;
    }
    case "reference": {
      const file = need(args[0], "vidéo");
      if (o["save-recipe"]) {
        const r = await recipeFromReference(file, o["save-recipe"], need(o.style, "--style <base>"), { title: o.title, description: o.description, log });
        console.log(`recipes/${r.name}.yaml`);
        return;
      }
      const ref = await analyzeReference(file, log);
      const { overrides, why } = overridesFrom(ref);
      console.log(why.map((w) => `- ${w}`).join("\n"));
      console.log(JSON.stringify({ per10s: ref.per10s, look: ref.look, overrides }, null, 2));
      log(`Planche : ${ref.sheet}`);
      return;
    }
    case "recipes":
      for (const r of listRecipes()) console.log(`${r.name}\t${r.style}\t${r.formats.join("+")}\t${r.description}`);
      return;
    case "recipe-save": {
      const r = saveRecipe(need(args[0], "projet"), need(args[1], "nom"), { title: o.title, description: o.description });
      console.log(`recipes/${r.name}.yaml`);
      return;
    }
    case "fix": {
      const { project } = openProject(need(args[0], "projet"));
      const pairs = Object.fromEntries(args.slice(1).map((a) => a.split("=")).filter((p) => p.length === 2));
      if (!Object.keys(pairs).length) throw new Error('usage: studio fix <projet> "mal entendu=correct" …');
      console.log(`${fixWords(project, pairs).changed} mot(s) corrigé(s)`);
      return;
    }
    case "cut": {
      const { project, style } = openProject(need(args[0], "projet"));
      if (o.remove || o.restore || !existsSync(project.path("cut", "cutplan.json"))) {
        await proposeCut(project, style, { remove: o.remove?.split(","), restore: o.restore?.split(",") });
      }
      if (o.apply) {
        const r = await applyCut(project, { force: o.force });
        log(`cut.mp4 : ${r.video} (${r.words.length} mots)`);
      } else console.log(readFileSync(project.path("cut", "cutplan.md"), "utf8"));
      return;
    }
    case "step": {
      const { project, style } = openProject(need(args[0], "projet"));
      const step = need(args[1], "étape");
      const force = o.force;
      if (step === "matte") console.log(JSON.stringify((await matteSurvey(project, { force })).report, null, 2));
      else if (step === "beats") console.log((await proposeCompose(project, style, log)).summary);
      else if (step === "compose") console.log(JSON.stringify(await applyCompose(project, style, { formats, force }), null, 2));
      else if (step === "audio") console.log(JSON.stringify((await audio(project, style, { force })).report, null, 2));
      else if (step === "render" || step === "qa") {
        const r = await render(project, { formats, quality, force: force && step === "render", onProgress: (l) => l && log(l) });
        if (step === "qa") console.log(JSON.stringify(await runQa(project, style, r.outputs), null, 2));
        else console.log(JSON.stringify(r.outputs, null, 2));
      } else throw new Error(`Étape inconnue : ${step}`);
      return;
    }
    case "tickets": {
      const name = need(args[0], "projet");
      openProject(name);
      if (o.close) {
        const st = o.status === undefined ? undefined : o.status === "ouvert" || o.status === "fait" ? o.status : undefined;
        if (o.status !== undefined && !st) throw new Error("--status fait | ouvert");
        const t = ticketClose(name, o.close, need(o.result, "--result"), { status: st, reprise: o.reprise });
        log(`ticket ${t.id} : ${t.status}`);
      }
      if (o.propose) proposeTickets(name);
      if (o.next) {
        const n = ticketNext(name);
        console.log(n.id !== null ? n.markdown : n.reason);
      } else console.log(showTickets(name));
      return;
    }
    case "status":
      console.log(JSON.stringify(status(openProject(need(args[0], "projet")).project), null, 2));
      return;
    case "styles":
      for (const s of listStyles()) console.log(`${s.name}\t${s.description}`);
      return;
    case "projects":
      console.log(listProjects().join("\n"));
      return;
    case "doctor": {
      const checks = await doctor();
      console.log(formatChecks(checks));
      if (checks.some((c) => !c.ok && c.fix && !c.name.includes("optional"))) process.exitCode = 1;
      return;
    }
    default:
      console.log(HELP);
  }
}

function need(v: string | undefined, what: string): string {
  if (!v) throw new Error(`argument manquant : ${what}`);
  return v;
}

main().catch((e) => {
  console.error(`✗ ${e.message}`);
  process.exit(1);
});
