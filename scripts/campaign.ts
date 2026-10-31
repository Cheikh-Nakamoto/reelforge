/**
 * A marketing campaign's tickets (tickets 0030-0044, decision 22): `work/campaigns/<nom>/tickets/`, in the format of
 * `.scratch/tickets/` so the `ticket` skill reads them, driven by `loop-campagne.md`. The default split and the
 * critique rounds are deterministic here (decision 2); the agents only write the deliverables and their verdicts.
 * Reuses the ticket format of `src/tickets.ts` without changing it (the team's rule: `src/` stays untouched).
 *
 *   npx tsx scripts/campaign.ts nouvelle <nom> --produit "<sources>" [--livrables texte,script,visuel,voix] [--essai]
 *   npx tsx scripts/campaign.ts suivant <nom>
 *   npx tsx scripts/campaign.ts fermer <nom> <id> --resultat "…" [--statut ouvert --reprise "…"]
 *   npx tsx scripts/campaign.ts rejeter <nom> <id> --motif "…" [--refaire <id>] [--revues psy,critique,avocat]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { WORK_DIR } from "../src/lib/project.js";
import { closeTicket, nextTicket, readTickets, renderTicket, resumeTicket, validateTickets, writeTickets, type Ticket } from "../src/tickets.js";

/** Review rounds a deliverable gets after its first version; one more rejection goes to the maintainer. */
export const MAX_ROUNDS = 2;

export const LIVRABLES = ["texte", "script", "visuel", "voix"] as const;
export type Livrable = (typeof LIVRABLES)[number];

const AUTEUR: Record<Livrable, string> = {
  texte: "copywriter",
  script: "video-scriptwriter",
  visuel: "art-director",
  voix: "voice-director",
};

type Revue = "psy" | "critique" | "avocat";
const REVUE: Record<Revue, { agent: string; titre: string; fichier: string; consigne: string }> = {
  psy: {
    agent: "psych-auditor",
    titre: "Audit psychologique",
    fichier: "audit-psy",
    consigne:
      "Avis **bloquant**, en grille pour chaque persona, message clé, script, visuel et CTA présents : motivation visée, " +
      "frein levé, émotion, biais mobilisés, contrôle éthique (pas de fausse urgence ni de fausse rareté, pas de " +
      "promesse invérifiable, pas de preuve sociale inventée). Une case éthique en échec rejette le livrable.",
  },
  critique: {
    agent: "product-critic",
    titre: "Critique produit",
    fichier: "critique",
    consigne:
      "Le livrable sert-il le produit réel et sa cible ? Chaque objection cite sa source (fichier du produit ou page " +
      "web) ; une objection sans source est écrite « non vérifié ».",
  },
  avocat: {
    agent: "devils-advocate",
    titre: "Avocat du diable",
    fichier: "avocat",
    consigne:
      "L'argument le plus fort contre ce livrable, puis ce qu'il faudrait pour le réfuter ; rejette seulement si " +
      "l'argument tient après les sources.",
  },
};
const REVUES = Object.keys(REVUE) as Revue[];

export interface CampaignSpec {
  nom: string;
  /** What the agents read about the product: paths or a short description, carried into every ticket. */
  produit: string;
  livrables?: Livrable[];
}

// -- header fields carried by every campaign ticket (kept by src/tickets.ts as `extra`) -------------------------

const field = (t: Ticket, k: string) => t.extra?.find(([key]) => key === k)?.[1];
const label = (livrable: string) => (livrable === "strategie" ? "stratégie" : livrable);
const num = (id: string) => String(Number(id)).padStart(2, "0");
const ROLES = ["création", "revue", "reprise", "gate", "production"] as const;
type Role = (typeof ROLES)[number];

interface Draft {
  slug: string;
  title: string;
  dependsOn: string[];
  agent: string;
  role: Role;
  /** Name of the deliverable file after its number (`produit` → `01-produit.md`); a name ending in `.md` is used as is. */
  sortie: string;
  livrable?: string;
  tour?: number;
  checkpoint?: boolean;
  context: string[];
  done: string[];
}

function ticketOf(id: string, d: Draft, common: string[]): Ticket {
  const extra: [string, string][] = [["agent", d.agent], ["rôle", d.role], ["sortie", d.sortie.endsWith(".md") ? d.sortie : `${num(id)}-${d.sortie}.md`]];
  if (d.livrable) extra.push(["livrable", d.livrable], ["tour", String(d.tour ?? 0)]);
  return {
    id,
    slug: d.slug,
    title: d.title,
    status: "ouvert",
    dependsOn: d.dependsOn,
    ...(d.checkpoint ? { checkpoint: "mainteneur" } : {}),
    extra,
    preamble: "\n",
    sections: [
      { heading: "Contexte", body: `\n${[...common, "", ...d.context].join("\n").replaceAll("<id>", id)}\n\n` },
      { heading: "Terminé quand", body: `\n${d.done.map((x) => `- [ ] ${x}`).join("\n")}\n` },
    ],
  };
}

function commonOf(spec: CampaignSpec): string[] {
  return [
    `Campagne \`${spec.nom}\`. Produit : ${spec.produit}`,
    "",
    "Cette session ne connaît rien des précédentes : lis d'abord `AGENTS-WORKFLOW.md` (équipe, flux, règles éthiques). " +
      `Les livrables sont dans \`work/campaigns/${spec.nom}/\`, numérotés ; chaque affirmation y renvoie à une source ` +
      "(fichier du produit ou page web citée), sinon elle est écrite « non vérifié ».",
  ];
}

const cmd = (spec: CampaignSpec, rest: string) => `\`npx tsx scripts/campaign.ts ${rest.replace("<nom>", spec.nom)}\``;

class Builder {
  readonly out: Ticket[] = [];
  constructor(private spec: CampaignSpec, private start = 1) {}
  add(d: Draft): Ticket {
    const id = String(this.start + this.out.length).padStart(4, "0");
    const t = ticketOf(id, d, commonOf(this.spec));
    this.out.push(t);
    return t;
  }
  /** psych-auditor, product-critic, devils-advocate on one deliverable; returns the last review. */
  reviews(livrable: string, inputs: string[], after: Ticket, tour: number, kinds: Revue[] = REVUES): Ticket {
    let prev = after;
    for (const k of kinds) {
      const r = REVUE[k];
      prev = this.add({
        slug: `${r.fichier}-${livrable}${tour ? `-t${tour}` : ""}`,
        title: `${r.titre} : ${label(livrable)}${tour ? `, tour ${tour}` : ""}`,
        dependsOn: [prev.id],
        agent: r.agent,
        role: "revue",
        sortie: `${r.fichier}-${livrable}${tour ? `-t${tour}` : ""}`,
        livrable,
        tour,
        context: [
          `À relire : ${inputs.map((f) => `\`${f}\``).join(", ")}, et les avis déjà écrits sur ce livrable.`,
          r.consigne,
          `Verdict : s'il est bloquant, ferme par ${cmd(this.spec, `rejeter <nom> <id> --motif "<une ligne>"`)} (le ` +
            `script écrit la reprise et le tour suivant, ou, après ${MAX_ROUNDS} tours, le checkpoint de désaccord) ; ` +
            `sinon par ${cmd(this.spec, `fermer <nom> <id> --resultat "<deux lignes>"`)}.`,
        ],
        done: [
          "L'avis est écrit dans le fichier `sortie` de l'en-tête, sources citées, verdict en première ligne (« passe » ou « rejet »).",
          "Le ticket est fermé par `campaign.ts fermer` ou `campaign.ts rejeter`.",
        ],
      });
    }
    return prev;
  }
}

const fileOf = (spec: CampaignSpec, t: Ticket) => `work/campaigns/${spec.nom}/${field(t, "sortie")}`;

/** The default split, written once at creation. */
export function planCampaign(spec: CampaignSpec): Ticket[] {
  const b = new Builder(spec);
  const make = (slug: string, title: string, agent: string, deps: Ticket[], ctx: string[], livrable?: string) =>
    b.add({
      slug, title, agent, role: "création", sortie: slug, dependsOn: deps.map((t) => t.id),
      ...(livrable ? { livrable, tour: 0 } : {}),
      context: [...(deps.length ? [`À lire : ${deps.map((t) => `\`${fileOf(spec, t)}\``).join(", ")}.`] : []), ...ctx],
      done: ["Le livrable est écrit dans le fichier `sortie` de l'en-tête, sources citées.", "Le ticket est fermé par `campaign.ts fermer`."],
    });

  const produit = make("produit", "Analyse du produit", "product-analyst", [], [
    "Ce que le produit fait, pour qui, sa promesse, ses preuves, ses alternatives. Sources : les fichiers du produit.",
  ], "strategie");
  const cible = make("cible", "Cible et personas", "audience-researcher", [produit], [
    "Cible, personas, langage réel de la cible ; sources web citées, aucune donnée privée dans une requête.",
  ], "strategie");
  const psy = make("profil-psy", "Profil psychologique de la cible", "psych-profiler", [produit, cible], [
    "Par persona : motivations, freins, émotions, biais.",
  ], "strategie");
  const pos = make("positionnement", "Positionnement et message clé", "positioning-strategist", [produit, cible, psy], [
    "Positionnement, message clé, promesse et preuves, chacune vérifiable.",
  ], "strategie");
  const strat = [produit, cible, psy, pos].map((t) => fileOf(spec, t));
  const endStrat = b.reviews("strategie", strat, pos, 0);

  const gate = (n: number, deps: Ticket[], what: string, livrable?: string) => b.add({
    slug: `gate-${n}`, title: `Gate ${n} : ${what}`, dependsOn: deps.map((t) => t.id), agent: "general-purpose",
    role: "gate", sortie: `gate-${n}`, checkpoint: true, ...(livrable ? { livrable, tour: 0 } : {}),
    context: [
      `Checkpoint : un sous-agent prépare la question (ce que le mainteneur juge, les fichiers à regarder, les ` +
        "désaccords restants entre critique et avocat du diable), la session pilote la pose par `AskUserQuestion`, un " +
        "second sous-agent applique la réponse.",
      `Si le mainteneur demande des corrections : ${cmd(spec, `rejeter <nom> <id> --motif "…" --refaire <ticket> --revues psy`)} ` +
        "(la correction repasse l'audit psy).",
    ],
    done: [
      "La question, la réponse du mainteneur et sa date sont journalisées dans le fichier `sortie` de l'en-tête.",
      "Le ticket est fermé par `campaign.ts fermer` (ou `rejeter` s'il demande des corrections).",
    ],
  });
  const g1 = gate(1, [endStrat], "positionnement", "strategie");

  const plan = make("plan", "Plan de campagne", "campaign-planner", [g1, pos], [
    "Arc de campagne, livrables par canal et par langue (français ; wolof pour la cible sénégalaise, relu par le " +
      "mainteneur), objectifs mesurables. Pas de fausse urgence ni de fausse rareté.",
  ]);

  const ends: Ticket[] = [];
  let scriptEnd: Ticket | undefined;
  let scriptFile: string | undefined;
  for (const l of spec.livrables ?? LIVRABLES) {
    const deps = l === "voix" && scriptEnd ? [plan, scriptEnd] : [plan, pos];
    const t = make(l, `Création : ${l}`, AUTEUR[l], deps, [
      ...(l === "voix" && scriptFile ? [`La voix lit le script validé (\`${scriptFile}\`).`] : []),
      "Toute image et toute vidéo passe par RealForge (voir `AGENTS-WORKFLOW.md`) ; aucun générateur externe.",
    ], l);
    const end = b.reviews(l, [fileOf(spec, t)], t, 0);
    if (l === "script") [scriptEnd, scriptFile] = [end, fileOf(spec, t)];
    ends.push(end);
  }
  const g2 = gate(2, ends, "avant rendu");
  const prod = b.add({
    slug: "production", title: "Production RealForge", dependsOn: [g2.id], agent: "technical-producer", role: "production",
    sortie: "production",
    context: ["Rendu par RealForge des livrables validés à la gate 2. Médias hors de tout dépôt ; le fichier `sortie` liste leurs chemins."],
    done: ["Chaque média est rendu et son chemin noté dans le fichier `sortie`.", "Le ticket est fermé par `campaign.ts fermer`."],
  });
  const qa = b.add({
    slug: "qa", title: "QA des rendus", dependsOn: [prod.id], agent: "technical-producer", role: "production", sortie: "qa",
    context: [`À lire : \`${fileOf(spec, prod)}\`. Gates \`hyperframes check\`, planches regardées image par image, loudness mesurée.`],
    done: ["Le rapport est écrit dans le fichier `sortie`, chaque défaut avec son image ou sa mesure.", "Le ticket est fermé par `campaign.ts fermer`."],
  });
  b.add({
    slug: "bilan", title: "Bilan de la campagne", dependsOn: [qa.id], agent: "campaign-planner", role: "production", sortie: "bilan",
    context: ["Qui a passé quoi à qui, combien de tours de critique, ce que les gates ont changé, ce qui manque."],
    done: ["Le bilan est écrit dans le fichier `sortie`.", "Le ticket est fermé par `campaign.ts fermer`."],
  });
  validateTickets(b.out);
  return b.out;
}

/** Two tickets with the built-in agent, to try the loop: a note, then a checkpoint on it. */
export function trialCampaign(spec: CampaignSpec): Ticket[] {
  const b = new Builder(spec);
  const note = b.add({
    slug: "note", title: "Note d'essai", dependsOn: [], agent: "general-purpose", role: "création", sortie: "note",
    context: ["Écris en trois lignes ce que dit le produit décrit plus haut, et d'où tu le sais."],
    done: ["La note est écrite dans le fichier `sortie` de l'en-tête.", "Le ticket est fermé par `campaign.ts fermer`."],
  });
  b.add({
    slug: "gate-essai", title: "Gate d'essai : la note", dependsOn: [note.id], agent: "general-purpose", role: "gate",
    sortie: "gate-essai", checkpoint: true,
    context: [`Checkpoint : la question au mainteneur porte sur \`${fileOf(spec, note)}\` (la note lui convient-elle ?).`],
    done: ["La question, la réponse du mainteneur et sa date sont journalisées dans le fichier `sortie` de l'en-tête.", "Le ticket est fermé par `campaign.ts fermer`."],
  });
  return b.out;
}

export interface RejectOptions {
  /** The ticket whose deliverable is redone (its agent and file); default: the deliverable's last creation or reprise. */
  refaire?: string;
  /** Reviews the redone deliverable passes again; default all three (a gate's correction: `psy`). */
  revues?: Revue[];
}

/**
 * A blocking verdict on ticket `id`: closes it, voids the rest of its round, and writes the next round (a reprise by
 * the deliverable's author, then the reviews again) or, once a review rejects a round-`MAX_ROUNDS` version, the
 * maintainer's checkpoint. Open tickets that waited on the voided round wait on the new one instead.
 */
export function rejectTicket(spec: CampaignSpec, tickets: Ticket[], id: string, motif: string, opts: RejectOptions = {}): Ticket[] {
  const t = tickets.find((x) => x.id === id);
  if (!t) throw new Error(`ticket ${id} inconnu`);
  if (t.status !== "ouvert") throw new Error(`ticket ${id} déjà fait`);
  const livrable = field(t, "livrable");
  if (!livrable) throw new Error(`ticket ${id} : pas de livrable dans l'en-tête, rien à refaire`);
  const role = field(t, "rôle");
  if (role !== "revue" && role !== "gate") throw new Error(`ticket ${id} : seul une revue ou une gate rejette (rôle « ${role} »)`);
  const tour = Number(field(t, "tour") ?? 0);

  // Void the open reviews of this round that come after the rejecting one.
  const voided = new Set([id]);
  for (let grew = true; grew;) {
    grew = false;
    for (const x of tickets) {
      if (voided.has(x.id) || x.status !== "ouvert" || field(x, "livrable") !== livrable || field(x, "rôle") !== "revue") continue;
      if (Number(field(x, "tour") ?? 0) === tour && x.dependsOn.some((d) => voided.has(d))) {
        voided.add(x.id);
        grew = true;
      }
    }
  }
  let out = tickets.map((x) =>
    x.id === id ? closeTicket(x, `Rejeté : ${motif}`)
    : voided.has(x.id) ? closeTicket(x, `Sans objet : livrable rejeté au ticket ${id}.`)
    : x);

  const b = new Builder(spec, Math.max(...tickets.map((x) => Number(x.id))) + 1);
  let end: Ticket;
  const reviewsOf = tickets.filter((x) => field(x, "livrable") === livrable && field(x, "rôle") === "revue" && x.status === "fait")
    .filter((x) => !x.sections.some((s) => s.heading === "Résultat" && s.body.trim().startsWith("Sans objet")))
    .map((x) => fileOf(spec, x));
  const verdict = fileOf(spec, t);
  if (role === "revue" && tour >= MAX_ROUNDS) {
    end = b.add({
      slug: `desaccord-${livrable}`, title: `Désaccord sur ${label(livrable)} : le mainteneur tranche`, dependsOn: [id],
      agent: "general-purpose", role: "gate", sortie: `desaccord-${livrable}`, livrable, tour, checkpoint: true,
      context: [
        `${MAX_ROUNDS} tours de critique n'ont pas suffi. Dernier rejet (ticket ${id}) : ${motif}`,
        `À présenter au mainteneur par \`AskUserQuestion\` : le livrable, ${[...reviewsOf, verdict].map((f) => `\`${f}\``).join(", ")}, ` +
          "le désaccord en une ligne par avis.",
        `S'il demande des corrections : ${cmd(spec, `rejeter <nom> <id> --motif "…" --refaire <ticket> --revues psy`)}.`,
      ],
      done: [
        "La question, la réponse du mainteneur et sa date sont journalisées dans le fichier `sortie` de l'en-tête.",
        "Le ticket est fermé par `campaign.ts fermer` (ou `rejeter` s'il demande des corrections).",
      ],
    });
  } else {
    const authors = out.filter((x) => field(x, "livrable") === livrable && ["création", "reprise"].includes(field(x, "rôle") ?? ""));
    const src = opts.refaire ? out.find((x) => x.id === opts.refaire) : authors.at(-1);
    if (!src) throw new Error(`ticket ${opts.refaire ?? "?"} : rien à refaire pour ${livrable}`);
    const next = Math.max(tour, ...out.filter((x) => field(x, "livrable") === livrable).map((x) => Number(field(x, "tour") ?? 0))) + 1;
    const sortie = field(src, "sortie") ?? "";
    const file = `work/campaigns/${spec.nom}/${sortie}`;
    const kept = file.replace(/\.md$/, `-v${next - 1}.md`);
    // The corrected version takes the file's place, so tickets planned on it read the latest version.
    const reprise = b.add({
      slug: `reprise-${livrable}-t${next}`, title: `Reprise : ${label(livrable)}, tour ${next}`, dependsOn: [id],
      agent: field(src, "agent") ?? "general-purpose", role: "reprise", sortie, livrable, tour: next,
      context: [
        `Rejet au ticket ${id} : ${motif}`,
        `À lire : \`${verdict}\`${reviewsOf.length ? `, ${reviewsOf.map((f) => `\`${f}\``).join(", ")}` : ""}, et la version rejetée \`${file}\`.`,
        `Copie d'abord la version rejetée en \`${kept}\`, puis écris la version corrigée à la place de \`${file}\`, avec en tête ce qui a changé et pourquoi.`,
      ],
      done: [`\`${kept}\` garde la version rejetée ; la version corrigée est dans \`${file}\`, sources citées.`, "Le ticket est fermé par `campaign.ts fermer`."],
    });
    const inputs = [...new Set(authors.map((x) => fileOf(spec, x)))];
    end = b.reviews(livrable, inputs, reprise, next, opts.revues ?? (role === "gate" ? ["psy"] : REVUES));
  }

  out = out.map((x) => {
    if (x.status !== "ouvert" || !x.dependsOn.some((d) => voided.has(d))) return x;
    return { ...x, dependsOn: [...new Set(x.dependsOn.map((d) => (voided.has(d) ? end.id : d)))] };
  });
  out = [...out, ...b.out];
  validateTickets(out);
  return out;
}

// -- on disk ----------------------------------------------------------------------------------------------------

export const campaignDir = (nom: string) => join(WORK_DIR, "campaigns", nom);
const ticketsDir = (nom: string) => join(campaignDir(nom), "tickets");
const specFile = (nom: string) => join(campaignDir(nom), "campagne.json");

function readSpec(nom: string): CampaignSpec {
  if (!existsSync(specFile(nom))) throw new Error(`campagne « ${nom} » inconnue (${specFile(nom)} absent)`);
  return JSON.parse(readFileSync(specFile(nom), "utf8"));
}

export function createCampaign(spec: CampaignSpec, opts: { essai?: boolean } = {}): Ticket[] {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(spec.nom)) throw new Error(`nom « ${spec.nom} » : minuscules, chiffres et tirets`);
  if (existsSync(ticketsDir(spec.nom))) throw new Error(`campagne « ${spec.nom} » déjà créée`);
  const ts = opts.essai ? trialCampaign(spec) : planCampaign(spec);
  mkdirSync(campaignDir(spec.nom), { recursive: true });
  writeFileSync(specFile(spec.nom), JSON.stringify({ ...spec, essai: !!opts.essai, creee: new Date().toISOString() }, null, 2) + "\n");
  writeTickets(ticketsDir(spec.nom), ts);
  return ts;
}

function parseArgs(argv: string[]): { pos: string[]; o: Record<string, string> } {
  const pos: string[] = [];
  const o: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const k = argv[i].slice(2);
      o[k] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "oui";
    } else pos.push(argv[i]);
  }
  return { pos, o };
}

const need = (v: string | undefined, what: string) => {
  if (!v) throw new Error(`${what} manquant`);
  return v;
};

function main(argv: string[]): void {
  const { pos: [verb, nom, id], o } = parseArgs(argv);
  if (!verb || !nom) {
    console.log(readFileSync(new URL(import.meta.url), "utf8").split("\n").filter((l) => l.startsWith(" *   ")).map((l) => l.slice(5)).join("\n"));
    process.exit(verb ? 1 : 0);
  }
  switch (verb) {
    case "nouvelle": {
      const livrables = o.livrables ? (o.livrables.split(",") as Livrable[]) : undefined;
      for (const l of livrables ?? []) if (!LIVRABLES.includes(l)) throw new Error(`livrable « ${l} » : ${LIVRABLES.join(", ")}`);
      const ts = createCampaign({ nom, produit: need(o.produit, "--produit"), ...(livrables ? { livrables } : {}) }, { essai: !!o.essai });
      console.log(`${ts.length} tickets dans ${ticketsDir(nom)}`);
      break;
    }
    case "suivant": {
      const ts = readTickets(ticketsDir(nom));
      if (!ts.length) throw new Error(`campagne « ${nom} » sans tickets`);
      const t = nextTicket(ts);
      if (t) console.log(renderTicket(t));
      else {
        const open = ts.filter((x) => x.status === "ouvert");
        console.log(open.length ? `AUCUN : rien de prêt (${open.map((x) => `${x.id} attend ${x.dependsOn.join(", ")}`).join(" ; ")})` : "AUCUN : tout est fait.");
      }
      break;
    }
    case "fermer": {
      const ts = readTickets(ticketsDir(nom));
      const t = ts.find((x) => x.id === need(id, "<id>"));
      if (!t) throw new Error(`ticket ${id} inconnu dans ${nom}`);
      const open = o.statut === "ouvert";
      const next = open ? resumeTicket(t, need(o.reprise, "--reprise")) : closeTicket(t, need(o.resultat, "--resultat"));
      writeTickets(ticketsDir(nom), ts.map((x) => (x.id === t.id ? next : x)));
      console.log(`ticket ${t.id} : ${next.status}`);
      break;
    }
    case "rejeter": {
      const ts = readTickets(ticketsDir(nom));
      const revues = o.revues ? (o.revues.split(",") as Revue[]) : undefined;
      for (const r of revues ?? []) if (!REVUES.includes(r)) throw new Error(`revue « ${r} » : ${REVUES.join(", ")}`);
      const out = rejectTicket(readSpec(nom), ts, need(id, "<id>"), need(o.motif, "--motif"), { ...(o.refaire ? { refaire: o.refaire } : {}), ...(revues ? { revues } : {}) });
      writeTickets(ticketsDir(nom), out);
      const added = out.filter((x) => !ts.some((y) => y.id === x.id));
      console.log(`ticket ${id} rejeté ; ajoutés : ${added.map((x) => `${x.id} ${x.title}`).join(" ; ")}`);
      break;
    }
    default:
      throw new Error(`commande « ${verb} » : nouvelle, suivant, fermer, rejeter`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}
