# Équipe marketing : déroulement

Une équipe de 13 sous-agents prépare une campagne (stratégie, textes, scripts, visuels, voix) et la fait produire par
RealForge. Ce fichier est le squelette commun ; les tickets 0032 et 0037 décrivent les agents, 0044 y ajoute
l'exemple de bout en bout tiré de `xewxew-lancement`. Règles du lot : section « Équipe marketing » de
`.scratch/tickets/README.md`.

## Règles

- **Sources** : chaque affirmation sur le produit renvoie à un fichier du produit ou à une page web citée ; un fait
  introuvable est écrit « non vérifié ». Aucune donnée privée dans une requête web.
- **Persuasion éthique** : pas de fausse urgence, de fausse rareté, de promesse invérifiable ni de preuve sociale
  inventée. psych-auditor rejette tout livrable qui en porte.
- **Langues** : français ; wolof pour la cible sénégalaise, relu par le mainteneur.
- **Médias par RealForge seulement** : voie `films/` sans rush, pipeline studio avec rush, images par
  `npx hyperframes snapshot`. Aucun générateur externe. Toute modification de `src/` est signalée au mainteneur
  avant d'être faite.
- **Hors dépôt** : `.claude/agents/` et les skills marketing reliées dans `.claude/skills/` sont gitignorés, jamais
  publiés avec RealForge.

## Équipe

Agents dans `.claude/agents/<nom>.md`. Skills reliées au ticket 0030 depuis `/home/zone01/skil/Moun-Skills/`
(`voicestudio` depuis `~/VoiceStudio/skills/voicestudio`) ; *retirée* = écartée à l'audit de 0030 (instructions
injectées), sort décidé au ticket 0047.

| Agent | Rôle | Skills | Modèle | Web | Créé par |
|---|---|---|---|---|---|
| product-analyst | ce que le produit fait, promesse, preuves, alternatives | inspired-product, jobs-to-be-done, obviously-awesome (competitive-teardown *retirée*) | sonnet | non | 0032 |
| audience-researcher | cible, personas, langage de la cible | target-audience, audience-research, mom-test, crossing-the-chasm (market-research *retirée*) | sonnet | oui | 0032 |
| psych-profiler | motivations, freins, émotions, biais par persona | influence-psychology, drive-motivation, hooked-ux, ux-psychology-skill, jobs-to-be-done | sonnet | non | 0032 |
| positioning-strategist | positionnement, message clé, promesse | brand-positioning, storybrand-messaging, made-to-stick, good-strategy-bad-strategy | sonnet | non | 0032 |
| psych-auditor | avis bloquant en grille sur chaque livrable | influence-psychology, social-proof-and-testimonials, conversion-optimization, ux-psychology-skill | opus | non | 0032 |
| product-critic | le livrable sert-il le produit et sa cible | mom-test, steve-jobs-design-review, ux-heuristics (competitive-teardown *retirée*) | opus | oui | 0032 |
| devils-advocate | l'argument le plus fort contre | good-strategy-bad-strategy, experimentation-and-ab-testing, brand-measurement | opus | oui | 0032 |
| campaign-planner | plan de campagne, canaux, objectifs ; bilan | campaign-and-launch-planning, content-calendar, platform-specs-and-validation, goals-and-kpis, whatsapp-marketing | sonnet | non | 0037 |
| copywriter | textes, accroches, légendes | hook-writer, caption-writer, brand-voice, content-humanizer (sales-copywriting *retirée*) | sonnet | non | 0037 |
| video-scriptwriter | script et storyboard | scripting-and-storyboarding, short-form-video-script, storytelling-and-narrative, improve-retention | sonnet | non | 0037 |
| art-director | visuels, miniature, typographie | visual-style, top-design, thumbnail-design, quote-cards-and-text-graphics, web-typography | sonnet | non | 0037 |
| voice-director | voix off : écriture pour l'oreille, direction, consentement | ai-voiceover (sans ElevenLabs), voicestudio | sonnet | non | 0037 |
| technical-producer | production RealForge et QA des rendus | studio, hyperframes, motion-doctrine, cut-the-curve, seam-craft, captions-overlay | opus | non | 0037 |

Plusieurs skills citent des générateurs (HeyGen, Veo, nano-banana, Ideogram, Canva, ElevenLabs) ou WoopSocial : les
consignes des agents les remplacent par RealForge, et la publication est hors périmètre.

## Flux

Un sous-agent ne lance pas d'autre sous-agent : « transmettre à » veut dire que le ticket suivant lit le livrable sur
disque. Découpage par défaut, écrit à la création (`scripts/campaign.ts`, fonction `planCampaign`) :

```
produit → cible → profil psy → positionnement → [audit psy → critique → avocat] → ⛳ gate 1
→ plan de campagne → par livrable (texte, script, visuel, voix) : création → [audit psy → critique → avocat]
→ ⛳ gate 2 avant rendu → production RealForge → QA → bilan
```

La voix attend le script revu. Chaque ticket porte dans son en-tête `agent`, `rôle` (création, revue, reprise, gate,
production), `sortie` (son fichier livrable) et, dans une chaîne de critique, `livrable` et `tour`.

**Boucle de critique** : psych-auditor, product-critic puis devils-advocate. Un avis bloquant ferme son ticket par
`rejeter` : le reste du tour est annulé, l'auteur écrit une reprise (la version rejetée gardée en `<fichier>-vN.md`,
la corrigée à sa place), les trois revues repassent. Au plus 2 tours ; un rejet au tour 2 ouvre un checkpoint
« Désaccord » où le mainteneur tranche.

**Gates** (`checkpoint: mainteneur`) : un sous-agent prépare la question, la session pilote la pose par
`AskUserQuestion`, un second sous-agent journalise la réponse dans le fichier `sortie` et l'applique. Des corrections
demandées à une gate passent par `rejeter --refaire <ticket> --revues psy` : elles repassent l'audit psy seulement.

## Où vont les livrables

- `work/campaigns/<nom>/` (gitignoré) : `campagne.json`, les livrables numérotés par ticket (`01-produit.md`,
  `05-audit-psy-strategie.md`…) et `tickets/` (format de `.scratch/tickets/` ; `README.md` y est dérivé des tickets).
- Textes validés : copiés dans le dépôt du produit, sous `marketing/campaigns/<nom>/` (XewXew :
  `~/ambiance/marketing/campaigns/<nom>/`), sans commit sans demande.
- Médias : hors de tout dépôt (XewXew : `~/xewxew-medias`) ; le livrable de production liste leurs chemins.

## Lancer et reprendre

```bash
npx tsx scripts/campaign.ts nouvelle <nom> --produit "<sources du produit>"   # [--livrables texte,script] [--essai]
```

Puis, dans une session vide : `/loop exécute loop-campagne.md sur la campagne <nom>`. La boucle s'arrête à chaque
checkpoint (pose la question, ou l'affiche en `claude -p`), à un ticket bloqué, ou à la fin. Reprendre : la même
commande, suivie de `réponse au checkpoint NNNN : <réponse>` si elle s'est arrêtée sur une question. Les autres
commandes du script (`suivant`, `fermer`, `rejeter`) sont celles des sous-agents ; `npx tsx scripts/campaign.ts`
seul les liste.
