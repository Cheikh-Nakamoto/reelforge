#!/usr/bin/env node
import { parseArgs } from "node:util";
import { existsSync, readFileSync } from "node:fs";
import { continuePipeline, createProject, listProjects, openProject, status } from "./pipeline.js";
import { doctor, formatChecks } from "./doctor.js";
import { listStyles } from "./lib/style.js";
import { applyCut, proposeCut } from "./steps/cut.js";
import { applyCompose, proposeCompose } from "./steps/compose.js";
import { matteSurvey } from "./steps/matte.js";
import { audio } from "./steps/audio.js";
import { render } from "./steps/render.js";
import { qa } from "./steps/qa.js";
import type { Format } from "./steps/html.js";

const HELP = `studio — rushs face caméra → vidéos montées (100 % local)

  studio run <rush> --style <nom> [--engine parakeet|whisper] [--approve-cut] [--formats 16x9,9x16] [--quality draft|standard|high]
      Pipeline complet. S'arrête au plan de coupe tant qu'il n'est pas validé (--approve-cut le valide).
  studio cut <projet> [--remove w1,w2] [--restore w3] [--apply]
      Affiche / corrige le plan de coupe ; --apply le valide et rend cut.mp4.
  studio step <projet> <matte|beats|compose|audio|render|qa> [--force]
  studio status <projet>
  studio styles | projects | doctor

Le même pipeline est exposé en MCP : node dist/mcp.js (voir skills/studio/SKILL.md).`;

const log = (m: string) => console.error(m);

async function main() {
  const { values: o, positionals: [cmd, ...args] } = parseArgs({
    allowPositionals: true,
    options: {
      style: { type: "string" },
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
      force: { type: "boolean" },
      repropose: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  const formats = o.formats?.split(",") as Format["id"][] | undefined;
  const quality = o.quality as "draft" | "standard" | "high" | undefined;

  switch (cmd) {
    case "run": {
      if (!args[0] || !o.style) throw new Error("usage: studio run <rush> --style <nom>");
      const { project, style } = await createProject(args[0], o.style, { name: o.name, engine: o.engine as "parakeet" | "whisper" | undefined, language: o.language, model: o.model, log });
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
        if (step === "qa") console.log(JSON.stringify(await qa(project, style, r.outputs), null, 2));
        else console.log(JSON.stringify(r.outputs, null, 2));
      } else throw new Error(`Étape inconnue : ${step}`);
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
