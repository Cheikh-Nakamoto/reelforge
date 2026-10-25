/**
 * A project's tickets (decision 22): the edit of one video split into units of work, one per fresh agent context.
 * The format is the one of studio's own development tickets (`.scratch/tickets/`), so one `ticket` skill reads both:
 * a front-matter header (`id`, `statut`, `dépend de`, optional `checkpoint`), a title, then `##` sections
 * (« Contexte », « Terminé quand », « Résultat » once closed, « Reprise » when interrupted).
 *
 * `planTickets` is the deterministic default (decision 2: no model inside); the client agent reviews it. On disk,
 * each ticket file is the source and `README.md` is derived from them, never edited by hand.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { logEvent } from "./events.js";
import { Project, readJson, WORK_DIR, writeJson, type ProjectMeta } from "./lib/project.js";
import { loadRecipe } from "./recipes.js";

export type TicketStatus = "ouvert" | "fait";

export interface Ticket {
  id: string;
  /** File name after the id (`0001-<slug>.md`); for a planned ticket, its role (`cut`, `beats`, `corrections-2`…). */
  slug: string;
  title: string;
  status: TicketStatus;
  dependsOn: string[];
  /** Who must answer before it can close (`utilisateur` on a review gate; `mainteneur` in development tickets). */
  checkpoint?: string;
  /** Header lines other than the four known keys, kept in order so a ticket written by hand survives a rewrite. */
  extra?: [string, string][];
  /** Text between the title line and the first section. */
  preamble: string;
  /** Raw section bodies, from the end of the heading line to the next heading: a rewrite changes nothing. */
  sections: { heading: string; body: string }[];
}

export interface PlanState {
  meta: Pick<ProjectMeta, "name" | "style"> & Partial<Pick<ProjectMeta, "recipe" | "formats" | "assembly">>;
  /** The recipe's brief, carried into every ticket: a fresh session has not read it. */
  brief?: string;
  /** Part projects of an assembly, in their order in the video. */
  parts?: string[];
  /** QA reports in the order they ran, each with the ticket that produced it. */
  qa?: { ticket: string; warnings: string[] }[];
}

const MAX_ROUNDS = 3; // skills/studio/SKILL.md, step 7

export function parseTicket(md: string): Ticket {
  const m = /^---\n([\s\S]*?)\n---\n\n# (.*)\n/.exec(md);
  if (!m) throw new Error("ticket: expected a --- header, a blank line, then a # title");
  const head: Record<string, string> = {};
  const extra: [string, string][] = [];
  for (const line of m[1].split("\n")) {
    const i = line.indexOf(":");
    if (i < 0) throw new Error(`ticket: bad header line « ${line} »`);
    const [k, v] = [line.slice(0, i).trim(), line.slice(i + 1).trim()];
    if (["id", "statut", "dépend de", "checkpoint"].includes(k)) head[k] = v;
    else extra.push([k, v]);
  }
  if (!head.id) throw new Error("ticket: no id");
  if (head.statut !== "ouvert" && head.statut !== "fait") throw new Error(`ticket ${head.id}: statut « ${head.statut} »`);
  const deps = head["dépend de"] ?? "—";

  // Split on `## ` at the start of a line outside code fences.
  const rest = md.slice(m[0].length);
  const chunks: string[] = [];
  let cur = "";
  let fence = false;
  for (const line of rest.split(/(?<=\n)/)) {
    if (/^(```|~~~)/.test(line)) fence = !fence;
    if (!fence && line.startsWith("## ")) {
      chunks.push(cur);
      cur = "";
    }
    cur += line;
  }
  chunks.push(cur);
  const [preamble, ...secs] = chunks;
  const sections = secs.map((s) => {
    const nl = s.indexOf("\n");
    return nl < 0 ? { heading: s.slice(3), body: "" } : { heading: s.slice(3, nl), body: s.slice(nl + 1) };
  });
  return {
    id: head.id,
    slug: slugify(m[2]),
    title: m[2],
    status: head.statut,
    dependsOn: deps === "—" || deps === "" ? [] : deps.split(",").map((d) => d.trim()),
    ...(head.checkpoint ? { checkpoint: head.checkpoint } : {}),
    ...(extra.length ? { extra } : {}),
    preamble,
    sections,
  };
}

export function renderTicket(t: Ticket): string {
  const head = [
    `id: ${t.id}`,
    `statut: ${t.status}`,
    `dépend de: ${t.dependsOn.length ? t.dependsOn.join(", ") : "—"}`,
    ...(t.checkpoint ? [`checkpoint: ${t.checkpoint}`] : []),
    ...(t.extra ?? []).map(([k, v]) => `${k}: ${v}`),
  ];
  return `---\n${head.join("\n")}\n---\n\n# ${t.title}\n${t.preamble}${t.sections.map((s) => `## ${s.heading}\n${s.body}`).join("")}`;
}

/** The first open ticket whose dependencies are all done, a checkpoint included: the loop stops on it, never past it. */
export function nextTicket(tickets: Ticket[]): Ticket | null {
  const done = new Set(tickets.filter((t) => t.status === "fait").map((t) => t.id));
  return tickets.find((t) => t.status === "ouvert" && t.dependsOn.every((d) => done.has(d))) ?? null;
}

/** A copy marked `fait` with its « Résultat » (replacing an earlier one). */
export function closeTicket(t: Ticket, result: string): Ticket {
  return { ...t, status: "fait", sections: withSection(t.sections, "Résultat", result) };
}

/** A copy left open with its « Reprise » (done so far, next step, files touched), for the session that picks it up. */
export function resumeTicket(t: Ticket, reprise: string): Ticket {
  return { ...t, status: "ouvert", sections: withSection(t.sections, "Reprise", reprise) };
}

/** Throws unless ids are unique, every dependency is a known ticket and no dependency chain loops. */
export function validateTickets(tickets: Ticket[]): void {
  const ids = new Set<string>();
  for (const t of tickets) {
    if (!/^\d{4}$/.test(t.id)) throw new Error(`ticket « ${t.id} » : un id a quatre chiffres (0001)`);
    if (ids.has(t.id)) throw new Error(`ticket ${t.id} : id en double`);
    ids.add(t.id);
  }
  for (const t of tickets) for (const d of t.dependsOn) if (!ids.has(d)) throw new Error(`ticket ${t.id} : dépend de ${d}, inconnu`);
  const deps = new Map(tickets.map((t) => [t.id, t.dependsOn]));
  const state = new Map<string, "visiting" | "done">();
  const visit = (id: string, path: string[]) => {
    if (state.get(id) === "done") return;
    if (state.get(id) === "visiting") throw new Error(`dépendances en cycle : ${[...path.slice(path.indexOf(id)), id].join(" → ")}`);
    state.set(id, "visiting");
    for (const d of deps.get(id)!) visit(d, [...path, id]);
    state.set(id, "done");
  };
  for (const t of tickets) visit(t.id, []);
}

function withSection(sections: Ticket["sections"], heading: string, text: string): Ticket["sections"] {
  const kept = sections.filter((s) => s.heading !== heading).map((s) => ({ ...s }));
  const last = kept.at(-1);
  if (last && !last.body.endsWith("\n\n")) last.body = last.body.replace(/\n*$/, "\n\n");
  return [...kept, { heading, body: `\n${text.trim()}\n` }];
}

const FILE = /^(\d{4})-(.+)\.md$/;

export function readTickets(dir: string): Ticket[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => FILE.test(f))
    .sort()
    .map((f) => ({ ...parseTicket(readFileSync(join(dir, f), "utf8")), slug: FILE.exec(f)![2] }));
}

/** Writes every ticket, removes ticket files no longer in the list, and derives the README. */
export function writeTickets(dir: string, tickets: Ticket[]): void {
  mkdirSync(dir, { recursive: true });
  const name = (t: Ticket) => `${t.id}-${t.slug}.md`;
  const keep = new Set(tickets.map(name));
  for (const f of readdirSync(dir)) if (FILE.test(f) && !keep.has(f)) rmSync(join(dir, f));
  for (const t of tickets) writeFileSync(join(dir, name(t)), renderTicket(t));
  const rows = tickets.map((t) => `| ${t.id} | [${t.title}](${name(t)}) | ${t.status} | ${t.dependsOn.length ? t.dependsOn.join(", ") : "—"} |`);
  writeFileSync(join(dir, "README.md"), [
    "# Tickets",
    "",
    "Écrit par studio à partir des fichiers des tickets, qui sont la source : ne pas éditer ce tableau à la main.",
    "",
    "| # | Ticket | Statut | Dépend de |",
    "|---|---|---|---|",
    ...rows,
    "",
  ].join("\n"));
}

/**
 * The default split: one ticket per step, and per part in an assembly. Review gates (each part's cut plan, the first
 * contact sheet) are `checkpoint: utilisateur`. After each QA with warnings comes a correction round, three at most.
 */
export function planTickets(state: PlanState): Ticket[] {
  const { meta } = state;
  const formats = meta.formats?.length ? meta.formats : (["9x16", "16x9"] as const);
  const [first, ...others] = formats;
  const out: Ticket[] = [];
  const add = (slug: string, title: string, dependsOn: string[], ctx: string[], done: string[], checkpoint?: boolean): Ticket => {
    const t: Ticket = {
      id: String(out.length + 1).padStart(4, "0"),
      slug,
      title,
      status: "ouvert",
      dependsOn,
      ...(checkpoint ? { checkpoint: "utilisateur" } : {}),
      preamble: "\n",
      sections: [
        { heading: "Contexte", body: `\n${[...common(state, formats), "", ...ctx].join("\n")}\n\n` },
        { heading: "Terminé quand", body: `\n${done.map((d) => `- [ ] ${d}`).join("\n")}\n` },
      ],
    };
    out.push(t);
    return t;
  };
  const p = meta.name;
  const dir = `work/${p}`;

  const cutReview = (proj: string, part?: string) => add(
    part ? `cut-${proj}` : "cut",
    part ? `Revue du plan de coupe : partie \`${proj}\`` : "Revue du plan de coupe",
    [],
    [
      ...(part ? [`Cette partie est le projet \`${proj}\` ; ${part}. Les outils de ce ticket prennent \`project: "${proj}"\`.`] : []),
      "Étapes 3 et 4 de `skills/studio/SKILL.md` (Review the cut, Apply). À lire : " +
        `\`work/${proj}/03-cut/cutplan.md\` (\`studio_cut_review { project: "${proj}", words: true }\` le rend).`,
      "Checkpoint : résume le plan à l'utilisateur en deux lignes (durée avant → après, ce qui est retiré) et attends son accord.",
    ],
    [
      `Plan relu avec \`studio_cut_review { project: "${proj}", words: true }\`, retraits et restaurations faits.`,
      "L'utilisateur a approuvé le plan.",
      `\`studio_cut_apply { project: "${proj}" }\` a fini (\`studio_status\` : \`done\`) et \`work/${proj}/03-cut/cut.mp4\` existe.`,
    ],
    true,
  );

  let head: Ticket;
  if (meta.assembly && state.parts?.length) {
    const cuts = state.parts.map((part, i) => cutReview(part, `partie ${i + 1} sur ${state.parts!.length} de l'assemblage \`${p}\``));
    head = add("assemble", "Assemblage des parties", cuts.map((t) => t.id), [
      `Section « Several rushes in one video » de \`skills/studio/SKILL.md\`. Parties, dans l'ordre : ${state.parts.map((x) => `\`${x}\``).join(", ")}.`,
      `\`studio_assemble { spec }\` avec \`name: ${p}\`, \`style: ${meta.style}\` et des \`transitions\` explicites (une seule direction, pas de fondu).`,
    ], [
      "Le travail d'assemblage a fini (`studio_status` : `done`).",
      `\`${dir}/03-cut/cut.mp4\` et \`${dir}/03-cut/assembly.json\` existent.`,
    ]);
  } else {
    head = cutReview(p);
  }

  const beats = add("beats", "Motion design : revue des beats", [head.id], [
    "Étape 5 de `skills/studio/SKILL.md` (Plan the motion design). À lire : " +
      `\`${dir}/05-compose/beats.json\` (\`studio_beats { project: "${p}", action: "show" }\`) et ses \`notes\` (fenêtres de matte instables).`,
  ], [
    `\`studio_beats { project: "${p}", action: "propose" }\` a fini (\`studio_status\` : \`done\`).`,
    "Beats revus selon l'étape 5 : mots derrière rares, graphismes et effets justifiés, aucun mot derrière sur une plage instable.",
    `\`studio_beats { action: "set", beats }\` a accepté l'objet corrigé (\`beats.json\` validé).`,
  ]);

  const exportOf = (f: string) => `${dir}/07-render/${p}_${f}.mp4`;
  const qaFiles = `\`${dir}/08-qa/qa.json\`, \`${dir}/08-qa/qa.md\` et les planches \`${dir}/08-qa/sheet_*.png\``;
  const qaDone = (f: string) => [
    `\`${exportOf(f)}\` existe.`,
    `\`studio_qa { project: "${p}", mattePreview: true }\` relu : aucun avertissement bloquant (mots derrière sur le visage, lint ou check en échec, durée fausse) ; les autres sont notés dans « Résultat ».`,
  ];
  const format = new Map<string, string>();

  const produce = add("produce", `Rendu et QA du ${first}`, [beats.id], [
    `Étapes 6 et 7 de \`skills/studio/SKILL.md\` (Produce, Look at the result), sur le premier format seulement : \`studio_produce { project: "${p}", formats: ["${first}"] }\`.`,
    `À lire : ${qaFiles}.`,
    "Checkpoint : montre la planche à l'utilisateur et attends son avis. Studio écrit une ronde de corrections s'il reste des avertissements.",
  ], [...qaDone(first), "L'utilisateur a vu la planche."], true);
  format.set(produce.id, first);

  for (const f of others) {
    const t = add(`format-${f}`, `Rendu et QA du ${f}`, [produce.id], [
      `Étape 7 de \`skills/studio/SKILL.md\` sur le format ${f} : \`studio_produce { project: "${p}", formats: ["${f}"] }\`. Les beats sont déjà relus ; la mise en page change avec le format, regarde chaque planche.`,
      `À lire : ${qaFiles}.`,
    ], qaDone(f));
    format.set(t.id, f);
  }

  const round = new Map<string, number>(); // corrections ticket id → its round
  const lastQa = new Map<string, string[]>();
  for (const q of state.qa ?? []) lastQa.set(q.ticket, q.warnings);
  for (const [src, warnings] of lastQa) {
    const from = out.find((t) => t.id === src);
    const f = from && format.get(from.id);
    if (!from || !f || !warnings.length) continue;
    const n = (round.get(from.id) ?? 0) + 1;
    if (n > MAX_ROUNDS) continue;
    const last = n === MAX_ROUNDS;
    const t = add(f === first ? `corrections-${n}` : `corrections-${f}-${n}`, `Corrections, ronde ${n} (${f})`, [from.id], [
      `Étape 7 de \`skills/studio/SKILL.md\`, ronde ${n} sur ${MAX_ROUNDS}. Avertissements de la QA du ticket ${from.id} :`,
      "",
      ...warnings.map((w) => `- ${w}`),
      "",
      `Corrige par les beats (\`studio_beats set\`) ou le style, puis \`studio_step\` \`compose\`, \`render\` et \`qa\` avec \`formats: ["${f}"]\`. À lire : ${qaFiles}.`,
      ...(last ? ["Dernière ronde : ce qui reste après elle ne se corrige plus ; rapporte-le à l'utilisateur."] : []),
    ], [
      ...qaDone(f),
      ...(last ? ["Ce qui reste est rapporté à l'utilisateur et noté dans « Résultat »."] : []),
    ]);
    round.set(t.id, n);
    format.set(t.id, f);
  }
  return out;
}

function common(state: PlanState, formats: readonly string[]): string[] {
  const { meta } = state;
  return [
    `Projet \`${meta.name}\`${meta.assembly ? " (assemblage)" : ""}, style \`${meta.style}\`` +
      `${meta.recipe ? `, recette \`${meta.recipe}\`` : ""}. Formats : ${formats.join(", ")} (le premier est rendu et revu d'abord).`,
    ...(state.brief ? ["", `Brief de la recette : ${state.brief.trim()}`] : []),
    "",
    "Cette session ne connaît rien des précédentes : `skills/studio/SKILL.md` décrit les outils `studio_*` et l'ordre des étapes ; les fichiers cités sont sous `work/`.",
  ];
}

function slugify(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48).replace(/-$/, "");
}

// ---------------------------------------------------------------------------------------------------------------
// A project's tickets on disk (`work/<project>/tickets/`), for the MCP tools and the CLI: the agent never sees the tree.
// `plan.json` beside the tickets keeps what planning needs and no file gives back: an assembly's parts before its
// project exists, and the QA history, keyed by the slug of the ticket that ran each QA (ids can be renumbered by `set`).

export const ticketsDir = (project: string) => join(WORK_DIR, project, "tickets");

interface PlanFile {
  parts?: string[];
  qa?: { ticket: string; warnings: string[] }[];
}

const planFile = (project: string) => join(ticketsDir(project), "plan.json");
const readPlan = (project: string): PlanFile => (existsSync(planFile(project)) ? readJson<PlanFile>(planFile(project)) : {});
function savePlan(project: string, p: PlanFile): void {
  mkdirSync(ticketsDir(project), { recursive: true });
  writeJson(planFile(project), p);
}

function stateOf(project: string, base?: PlanState["meta"]): PlanState {
  const p = new Project(project);
  const meta = p.exists() ? { ...base, ...p.meta } : base;
  if (!meta) throw new Error(`Unknown project "${project}"`);
  let brief: string | undefined;
  if (meta.recipe) {
    try {
      brief = loadRecipe(meta.recipe).prompt;
    } catch {
      // A recipe renamed or deleted since: the tickets go without its brief.
    }
  }
  const file = readPlan(project);
  // Replay the QA history: each QA's ticket gets the id it has in the plan built from the QAs before it.
  const qa: { ticket: string; warnings: string[] }[] = [];
  for (const h of file.qa ?? []) {
    const t = planTickets({ meta, brief, parts: file.parts, qa }).find((x) => x.slug === h.ticket);
    if (t) qa.push({ ticket: t.id, warnings: h.warnings });
  }
  return { meta, ...(brief ? { brief } : {}), ...(file.parts ? { parts: file.parts } : {}), qa };
}

export function projectTickets(project: string): Ticket[] {
  return readTickets(ticketsDir(project));
}

/** Writes the default split unless the project already has tickets. `base` stands in for a project.json not yet written. */
export function ensureTickets(project: string, base?: PlanState["meta"], parts?: string[]): Ticket[] {
  const have = projectTickets(project);
  if (have.length) return have;
  if (parts) savePlan(project, { ...readPlan(project), parts });
  const ts = planTickets(stateOf(project, base));
  writeTickets(ticketsDir(project), ts);
  return ts;
}

/** The default split again, keeping every ticket already `fait` (in place of the planned one with its id). */
export function proposeTickets(project: string): Ticket[] {
  const done = projectTickets(project).filter((t) => t.status === "fait");
  const planned = planTickets(stateOf(project));
  const byId = new Map(done.map((t) => [t.id, t]));
  const out = planned.map((t) => byId.get(t.id) ?? t);
  for (const d of done) if (!planned.some((t) => t.id === d.id)) out.push(d);
  out.sort((a, b) => a.id.localeCompare(b.id));
  validateTickets(out);
  writeTickets(ticketsDir(project), out);
  return out;
}

/** What `studio_tickets set` accepts per ticket: its markdown (as `show` returns it), or the fields. */
export type TicketInput = string | {
  id: string; title: string; slug?: string; dependsOn?: string[]; checkpoint?: string;
  /** Shorthand for the two usual sections. */
  context?: string; done?: string[];
  sections?: { heading: string; body: string }[];
};

function fromInput(x: TicketInput): Ticket {
  if (typeof x === "string") return { ...parseTicket(x), status: "ouvert" };
  if (!x || typeof x.id !== "string" || typeof x.title !== "string") throw new Error("ticket : id et title sont requis");
  const sections = x.sections?.map((s) => ({ heading: s.heading, body: `\n${s.body.trim()}\n\n` })) ?? [
    ...(x.context ? [{ heading: "Contexte", body: `\n${x.context.trim()}\n\n` }] : []),
    ...(x.done?.length ? [{ heading: "Terminé quand", body: `\n${x.done.map((d) => `- [ ] ${d}`).join("\n")}\n` }] : []),
  ];
  return {
    id: x.id, slug: x.slug ?? slugify(x.title), title: x.title, status: "ouvert", dependsOn: x.dependsOn ?? [],
    ...(x.checkpoint ? { checkpoint: x.checkpoint } : {}), preamble: "\n", sections,
  };
}

/** Replaces every open ticket by the agent's list; tickets already `fait` stay as they are. */
export function setTickets(project: string, input: TicketInput[]): Ticket[] {
  if (!Array.isArray(input)) throw new Error("tickets : une liste");
  const done = projectTickets(project).filter((t) => t.status === "fait");
  const out = [...done, ...input.map(fromInput)].sort((a, b) => a.id.localeCompare(b.id));
  validateTickets(out);
  writeTickets(ticketsDir(project), out);
  return out;
}

export function showTickets(project: string): string {
  const dir = ticketsDir(project);
  const ts = projectTickets(project);
  if (!ts.length) return "Aucun ticket : `studio_tickets { action: \"propose\" }` écrit le découpage par défaut.";
  return [readFileSync(join(dir, "README.md"), "utf8"), ...ts.map(renderTicket)].join("\n\n");
}

export type NextResult =
  | { id: string; title: string; checkpoint: string | null; markdown: string; note?: string }
  | { id: null; reason: string };

export function ticketNext(project: string): NextResult {
  const ts = projectTickets(project);
  if (!ts.length) return { id: null, reason: "Aucun ticket : studio_tickets propose." };
  const t = nextTicket(ts);
  if (t) return {
    id: t.id, title: t.title, checkpoint: t.checkpoint ?? null, markdown: renderTicket(t),
    ...(t.checkpoint ? { note: `Checkpoint : seule la session pilote demande la réponse (${t.checkpoint}) ; un sous-agent prépare la question.` } : {}),
  };
  const open = ts.filter((x) => x.status === "ouvert");
  if (!open.length) return { id: null, reason: "Tout est fait." };
  return { id: null, reason: `Rien de prêt : ${open.map((x) => `${x.id} attend ${x.dependsOn.join(", ")}`).join(" ; ")}.` };
}

/** Closes a ticket with its « Résultat », or leaves it open with a « Reprise », and journals it (decision 12). */
export function ticketClose(project: string, id: string, result: string, opts: { status?: TicketStatus; reprise?: string } = {}): Ticket {
  const ts = projectTickets(project);
  const t = ts.find((x) => x.id === id);
  if (!t) throw new Error(`ticket ${id} inconnu dans ${project} (${ts.map((x) => x.id).join(", ") || "aucun"})`);
  const open = opts.status === "ouvert";
  const next = open ? resumeTicket(t, opts.reprise ?? result) : closeTicket(t, result);
  writeTickets(ticketsDir(project), ts.map((x) => (x.id === id ? next : x)));
  logEvent(project, { kind: "ticket", source: "pipeline", message: `ticket ${id} ${open ? "reste ouvert" : "fait"} : ${t.title}`, args: { id, status: next.status, result } });
  return next;
}

/** The format a planned render ticket works on, from its slug; null for another ticket. */
function formatOf(slug: string, first: string): string | null {
  if (slug === "produce" || /^corrections-\d+$/.test(slug)) return first;
  return /^(?:format|corrections)-(\d+x\d+)(?:-\d+)?$/.exec(slug)?.[1] ?? null;
}

/**
 * After a QA: records each format's warnings against the ticket rendering it (the first open one of that format,
 * else its last), and adds the correction rounds the plan now asks for. Returns the tickets added.
 */
export function recordQa(project: string, formats: string[], warnings: string[]): Ticket[] {
  const existing = ensureTickets(project);
  const first = stateOf(project).meta.formats?.[0] ?? "9x16";
  const file = readPlan(project);
  const history = [...(file.qa ?? [])];
  const tagged = /^(\d+x\d+): /;
  for (const f of formats) {
    const mine = existing.filter((t) => formatOf(t.slug, first) === f);
    const src = mine.find((t) => t.status === "ouvert") ?? mine.at(-1);
    if (!src) continue;
    history.push({ ticket: src.slug, warnings: warnings.filter((w) => (tagged.exec(w)?.[1] ?? f) === f) });
  }
  savePlan(project, { ...file, qa: history });

  // Append the planned tickets missing from disk, renumbered past the existing ones if their id is taken.
  const planned = planTickets(stateOf(project));
  const idOf = new Map<string, string>(); // planned id → id on disk
  const bySlug = new Map(existing.map((t) => [t.slug, t.id]));
  const taken = new Set(existing.map((t) => t.id));
  let max = Math.max(0, ...existing.map((t) => Number(t.id)));
  const added: Ticket[] = [];
  for (const t of planned) {
    const have = bySlug.get(t.slug);
    if (have) {
      idOf.set(t.id, have);
      continue;
    }
    const id = taken.has(t.id) ? String(++max).padStart(4, "0") : t.id;
    max = Math.max(max, Number(id));
    taken.add(id);
    idOf.set(t.id, id);
    added.push({ ...t, id, dependsOn: t.dependsOn.map((d) => idOf.get(d) ?? d) });
  }
  if (added.length) {
    const out = [...existing, ...added].sort((a, b) => a.id.localeCompare(b.id));
    validateTickets(out);
    writeTickets(ticketsDir(project), out);
  }
  return added;
}
