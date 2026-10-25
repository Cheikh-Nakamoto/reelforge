# Architecture

> **Pour qui** : vous voulez modifier studio, corriger un bug ou ajouter une fonctionnalité. Cette page donne la
> carte du code. Les **raisons** des choix sont dans les décisions numérotées de [CLAUDE.md](../CLAUDE.md), le
> journal des décisions du projet : lisez-les avant de revenir sur l'une d'elles.

## Les principes

1. **Pas de LLM dans studio.** Chaque étape a une heuristique déterministe par défaut et écrit un fichier lisible
   et modifiable. Le LLM du client relit ces fichiers par MCP. Une nouvelle fonctionnalité apporte une heuristique
   et un artefact modifiable, jamais un appel de modèle (décision 2).
2. **Deux façades, les mêmes fonctions.** `src/mcp.ts` et `src/cli.ts` appellent `src/pipeline.ts` et les modules
   d'étapes ; aucune logique métier ne vit dans les façades.
3. **Tout est local.** FFmpeg pour l'image et le son, HyperFrames pour la composition et le rendu, des modèles en
   cache local. Chaque processus enfant tourne sans télémétrie (décision 17).
4. **Un cache par étape.** Relancer ne refait que ce qui a changé.
5. **La logique pure est testée.** `cutplan.ts`, `beats.ts` et `html.ts` sont des fonctions pures, et leurs tests
   n'ont besoin d'aucun média.

## La carte

```
src/
├── mcp.ts              serveur MCP (stdio) : outils, prompts, journal des appels
├── cli.ts              ligne de commande
├── pipeline.ts         orchestration : création, reprise, arrêt au plan de coupe, QA, tickets
├── jobs.ts             jobs d'arrière-plan pour MCP (un seul en cours par projet)
├── assembly.ts         plusieurs rushs → un projet joint (03-cut/ synthétique, transitions xfade)
├── recipes.ts          recettes et questionnaire → style + overrides + formats + brief
├── reference.ts        mesure d'une vidéo de référence → overrides ; comparaison d'énergie en QA
├── tickets.ts          découpage d'un projet en tickets, prochain ticket, fermeture
├── dashboard.ts        tableau de bord local (127.0.0.1, sans dépendance, plages HTTP)
├── events.ts           journal events.jsonl
├── doctor.ts           vérification de la chaîne d'outils
├── lib/
│   ├── exec.ts         processus enfants (environnement sans télémétrie), appel de HyperFrames
│   ├── ffmpeg.ts       mesures EBU R128, aides FFmpeg
│   ├── project.ts      dossiers de projet, manifestes, cache, codeOf
│   ├── style.ts        StyleSchema (zod), chargement et fusion des overrides
│   ├── words.ts        normalisation, lexiques français (hésitations, reprises, mots vides)
│   ├── align.ts        alignement whisper / Parakeet (LCS sur mots normalisés)
│   ├── frames.ts       lecture d'images en niveaux de gris basse résolution
│   ├── sfx.ts          catalogue mesuré des bruitages (attaque, crête, niveau)
│   └── markup.ts       aides partagées par les générateurs HTML
└── steps/
    ├── ingest.ts       normalisation du rush
    ├── transcribe.ts   Parakeet, whisper.cpp, hybride
    ├── cutplan.ts  ◆   plan de coupe : silences, prises, hésitations, segments (pur)
    ├── cut.ts          proposition, corrections, application (rendu de cut.mp4)
    ├── matte.ts        survol 1 i/s, détourage des fenêtres, stabilité, subject.webm
    ├── placement.ts    taille et hauteur d'un mot derrière sur le vrai détourage
    ├── beats.ts    ◆   proposition du motion design (pur) et BeatsSchema
    ├── captions.ts     groupes et mots clés des sous-titres
    ├── contextual.ts   graphiques tirés de la phrase (question, URL, A/B, définition, CTA, titre)
    ├── effects.ts      choix des effets sous budget de densité
    ├── compose.ts      beats → compositions, lint, check
    ├── html.ts     ◆   génération de la page HyperFrames (pure) : deux piles de caméra, timeline GSAP
    ├── stage.ts        scènes de typographie cinétique
    ├── look.ts         chaîne d'étalonnage FFmpeg commune à toutes les couches
    ├── audio.ts        débruitage, compression, musique, ducking, bruitages, loudnorm
    ├── render.ts       rendu HyperFrames, mux du son, métadonnées, reçu
    └── qa.ts           planches contact, mesures, avertissements
```

◆ : modules purs, couverts par des tests unitaires.

## Le flux de données

```
rush ─ingest─▶ source.mp4, audio16k.wav
     ─transcribe─▶ words.json ──────────────┐
     ─cut (cutplan.ts)─▶ cutplan.json ◀──── relecture (remove / restore)
     ─cut (apply)─▶ cut.mp4, words.json recalés
     ─matte─▶ matte.json (boîte, tête), puis fenêtres à pleine cadence
     ─compose (beats.ts…)─▶ beats.json ◀─── relecture (studio_beats set)
     ─compose (html.ts…)─▶ 16x9/, 9x16/ (HTML + GSAP), couches étalonnées
     ─audio─▶ mix.wav
     ─render─▶ <projet>_<format>.mp4 + receipt.json
     ─qa─▶ sheet_<format>.png, qa.json ◀─── relecture (planches)
```

## Le cache

Chaque étape écrit un `manifest.json` avec l'empreinte de ses entrées et de ses paramètres.

- **cut, compose, audio, render** ajoutent l'empreinte de **leur propre code source** (`codeOf`) : modifier le code
  les relance automatiquement.
- **ingest, transcribe, matte** ne le font pas, volontairement, car elles coûtent des dizaines de minutes. Si vous
  changez leur sortie, **augmentez leur `version` à la main** dans le module (`ingest.ts`, `transcribe.ts`,
  `matte.ts`).
- Les fenêtres de détourage sont indexées sur la vidéo coupée dont elles viennent.

## Le contrat HyperFrames

Les points qui ont déjà causé des bugs (le détail est dans [CLAUDE.md](../CLAUDE.md#hyperframes-contract-the-parts-that-bit-us)) :

- une seule timeline GSAP en pause, enregistrée sous `window.__timelines["main"]` ; ni `Date.now()`, ni hasard
  non graine ;
- les éléments minutés portent `class="clip"`, `data-start` et `data-duration` ; ne jamais animer leur
  `visibility` ;
- pas de `fromTo` répété sur une même cible : un `set` de base, puis des `to` ;
- le sujet détouré ne doit jamais être à l'intérieur de l'élément de la vidéo, sinon le mot derrière passe devant
  le visage (décision 6) ;
- étalonnage, grain et effets de pixels de la vidéo passent par FFmpeg, jamais par des filtres CSS (décisions 8, 14
  et 20) ;
- GSAP est copié depuis `node_modules` dans chaque projet, jamais chargé depuis un CDN.

## Les tests

```bash
npm run typecheck && npm test
```

| Tests | Besoin |
|---|---|
| `cutplan`, `beats`, `html`, `captions`, `contextual`, `effects`, `placement`, `align`, `silences`, `recipes`, `reference`, `sfx`, `tickets`, `assembly`, `dashboard` | aucun média |
| `mcp.test.ts` | `npm run build` d'abord (il lance `dist/mcp.js`) |
| `npm run e2e -- rushs/test-synth.mp4` | un rush ; pilote tout le pipeline par MCP, comme un agent |

Après une modification de `html.ts`, `matte.ts`, `audio.ts` ou `render.ts`, rendez un rush court
(`scripts/make-fixture.sh`) et **regardez** la planche contact, ainsi qu'une image pleine résolution d'un mot
derrière (recadrez sur la tête).

## Où ajouter quoi

| Vous voulez… | Où | À ne pas oublier |
|---|---|---|
| une clé de style | `src/lib/style.ts` (avec un commentaire de doc) | `npm run schema`, la [référence des styles](reference/style.md) |
| un style | `styles/<nom>.yaml` | une planche contact des deux formats dans la PR |
| un type de graphique | `src/steps/contextual.ts` ou `beats.ts`, le rendu dans `html.ts` | une heuristique plus un champ éditable dans `beats.json`, des tests |
| un effet | `src/steps/effects.ts`, le rendu dans `html.ts` ou cuit par FFmpeg | les couches ne se chevauchent pas, le budget par 10 s |
| un outil MCP | `src/mcp.ts`, en appelant une fonction de `pipeline.ts` ou d'une étape | la même chose en CLI, `skills/studio/SKILL.md`, la [référence MCP](reference/outils-mcp.md) |
| une langue | `src/lib/words.ts` (lexiques) | tests sur `cutplan` |
| une dépendance ou un modèle | `package.json` | une licence compatible avec la redistribution non commerciale, `THIRD_PARTY.md` ; pas de code GPL lié dans le processus, pas de poids CC BY-NC |

## Pour aller plus loin

- [CLAUDE.md](../CLAUDE.md) : les 22 décisions et leurs raisons, le contrat HyperFrames, les règles de travail.
- [CONTRIBUTING.md](../CONTRIBUTING.md) : la checklist avant une PR et la licence des contributions (signature
  `git commit -s`).
- [GLOSSARY.md](../GLOSSARY.md) : le vocabulaire du domaine.
- [THIRD_PARTY.md](../THIRD_PARTY.md) : chaque composant tiers et sa licence.
