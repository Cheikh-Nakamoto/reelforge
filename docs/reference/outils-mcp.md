# Référence : outils et prompts MCP

Le serveur `studio` (`dist/mcp.js`, transport stdio) expose 22 outils et des prompts. Cette page les décrit tous,
dans l'ordre d'un montage. La source fait foi : [`src/mcp.ts`](../../src/mcp.ts).

## Conventions

- **Job** : l'outil lance un calcul en arrière-plan et répond aussitôt avec `{ job, label, status, log, … }`.
  Interrogez `studio_status { project }` jusqu'à `status: "done"` (ou `"error"`). Un seul job tourne à la fois par
  projet.
- **Synchrone** : l'outil travaille pendant l'appel et renvoie le résultat.
- **Erreurs** : une erreur revient comme un résultat d'outil lisible, `isError: true` et le texte
  `Erreur : <message>`, jamais comme une panne du protocole. L'agent peut la lire et corriger.
- **Journal** : chaque appel, sauf les outils de consultation listés plus bas, est ajouté à
  `work/<projet>/events.jsonl` avec ses arguments ([tableau de bord](../09-tableau-de-bord.md)).
  Consultation non journalisée : `studio_status`, `studio_list_styles`, `studio_list_projects`, `studio_doctor`,
  `studio_recipes`, `studio_questionnaire`.
- `project` est toujours le nom d'un projet : tiré du nom de fichier du rush, en minuscules avec des tirets.
- `formats` vaut `["16x9"]`, `["9x16"]` ou les deux (défaut : les formats du projet).

## Vue d'ensemble

| Outil | Rôle | Mode |
|---|---|---|
| [`studio_doctor`](#studio_doctor) | vérifier la chaîne d'outils locale | synchrone |
| [`studio_dashboard`](#studio_dashboard) | démarrer le tableau de bord, renvoyer son URL | synchrone |
| [`studio_list_styles`](#studio_list_styles) | lister les styles | synchrone |
| [`studio_list_projects`](#studio_list_projects) | lister les projets | synchrone |
| [`studio_questionnaire`](#studio_questionnaire) | les questions du questionnaire | synchrone |
| [`studio_recipes`](#studio_recipes) | lister les recettes | synchrone |
| [`studio_recipe_preview`](#studio_recipe_preview) | ce que donnent une recette ou des réponses | synchrone |
| [`studio_reference`](#studio_reference) | mesurer une vidéo de référence | job, puis synchrone |
| [`studio_create_project`](#studio_create_project) | ingestion, transcription, plan de coupe | job |
| [`studio_status`](#studio_status) | état d'un projet et de ses jobs | synchrone |
| [`studio_cut_review`](#studio_cut_review) | lire et corriger le plan de coupe | synchrone |
| [`studio_fix_words`](#studio_fix_words) | corriger des mots mal entendus | synchrone |
| [`studio_cut_apply`](#studio_cut_apply) | approuver la coupe, rendre `cut.mp4` | synchrone (long) |
| [`studio_beats`](#studio_beats) | proposer, lire, remplacer le motion design | job (`propose`) / synchrone |
| [`studio_produce`](#studio_produce) | détourage → beats → compose → audio → rendu → QA | job |
| [`studio_step`](#studio_step) | relancer une étape tardive | job |
| [`studio_qa`](#studio_qa) | planches contact et mesures | synchrone |
| [`studio_assemble`](#studio_assemble) | plusieurs rushs en une vidéo | job |
| [`studio_recipe_save`](#studio_recipe_save) | garder un montage comme recette | synchrone |
| [`studio_tickets`](#studio_tickets) | proposer, lire, remplacer les tickets | synchrone |
| [`studio_ticket_next`](#studio_ticket_next) | le prochain ticket prêt | synchrone |
| [`studio_ticket_close`](#studio_ticket_close) | fermer un ticket | synchrone |

---

## Mise en route

### `studio_doctor`

Vérifie Node, FFmpeg, Parakeet, whisper.cpp, les poids de détourage, Chrome, les bruitages, la police emoji et les
styles, et donne la commande qui répare chaque manque. Sans paramètre. Renvoie le texte de
[`studio doctor`](cli.md#doctor).

### `studio_dashboard`

Démarre le tableau de bord (une seule fois par serveur) et renvoie son URL.

| Paramètre | Type | Défaut |
|---|---|---|
| `port` | entier | 4600 |

### `studio_list_styles`

Liste les styles de `styles/*.yaml` : polices, couleurs, rythme, types d'animation. Sans paramètre.

### `studio_list_projects`

Liste les projets de `work/`. Sans paramètre.

## Choisir un montage

### `studio_questionnaire`

Renvoie les questions (type, plateforme, ton, sous-titres, rythme, matière, extras) et leurs options. L'agent les
pose toutes en une fois, puis passe les réponses à `studio_recipe_preview` ou à `studio_create_project`. Sans
paramètre.

### `studio_recipes`

Liste les recettes : `name`, `title`, `description`, `style`, `formats`, `structure`. Sans paramètre.

### `studio_recipe_preview`

Ce qu'une recette ou des réponses au questionnaire donnent : style, overrides, formats et brief à suivre.

| Paramètre | Type | Sens |
|---|---|---|
| `recipe` | chaîne | nom d'une recette |
| `answers` | objet `{ id: label \| [labels] }` | réponses au questionnaire |

### `studio_reference`

Mesure une vidéo de référence : coupes par seconde, flashs, stroboscopes, zoom punchs, escaliers de zooms,
secousses, whip pans, et son look (luminosité, saturation, contraste, letterbox). Analyse de pixels locale, sans
modèle et sans envoi.

| Paramètre | Type | Sens |
|---|---|---|
| `file` | chaîne, obligatoire | chemin de la vidéo |
| `saveRecipe` | `{ name, style, title?, description? }` | en faire aussi une recette ; `name` en minuscules et tirets |

**Premier appel** sur un fichier : lance un job sous le projet `_references`. Interrogez
`studio_status { project: "_references", job }`, puis rappelez `studio_reference`. **Appels suivants** (analyse en
cache) : renvoie les raisons, les mesures (`per10s`, `look`, `events`), les `overrides` qui reproduisent cette
énergie, et une image avec une vignette par plan. Les sous-titres ne sont pas mesurés : choisissez le look en
regardant l'image.

## Le montage

### `studio_create_project`

Crée un projet depuis un rush : ingestion (rotation, cadence constante, normalisation), transcription mot à mot,
plan de coupe, tickets par défaut. **Job.**

| Paramètre | Type | Sens | Défaut |
|---|---|---|---|
| `source` | chaîne, obligatoire | chemin du rush (mp4, mov, mkv) ; **absolu** de préférence | — |
| `style` | chaîne | nom de style ; inutile avec une recette | — |
| `recipe` | chaîne | nom de recette : fixe style, overrides, formats | — |
| `answers` | objet | réponses au questionnaire : choisit et ajuste une recette | — |
| `name` | chaîne | nom du projet | tiré du nom de fichier |
| `engine` | `hybrid` \| `parakeet` \| `whisper` | moteur de transcription | `hybrid` |
| `language` | chaîne (ISO) | whisper seulement : langue parlée | `fr` |
| `model` | chaîne | whisper seulement : modèle whisper.cpp | `large-v3-turbo` |
| `like` | chaîne | vidéo de référence dont l'énergie passe par-dessus le style | — |

Il faut au moins un `style`, une `recipe` ou des `answers`. La réponse contient `project`, le job, et le `brief` de
la recette, que l'agent doit suivre.

### `studio_status`

État du projet : étapes en cache, état du plan de coupe, et les trois derniers jobs avec leurs 25 dernières lignes
de journal.

| Paramètre | Type | Sens |
|---|---|---|
| `project` | chaîne, obligatoire | projet |
| `job` | chaîne | un identifiant de job précis |

### `studio_cut_review`

Affiche le plan de coupe : la transcription avec les mots retirés barrés (hésitations, bégaiements, prises ratées,
pauses resserrées) et les identifiants des mots. Avec des paramètres de correction, il recalcule le plan. Les
corrections s'accumulent.

| Paramètre | Type | Sens |
|---|---|---|
| `project` | chaîne, obligatoire | projet |
| `remove` | `["w12", …]` | mots à couper |
| `restore` | `["w31", …]` | mots à garder malgré les heuristiques |
| `minPause` | nombre (s) | les pauses plus longues sont resserrées |
| `keep` | nombre (s) | respiration gardée de chaque côté d'une pause resserrée |
| `words` | booléen | renvoie aussi la liste `id  début  [✂ ]texte`, pour des corrections précises |

### `studio_fix_words`

Corrige une fois pour toutes des mots mal entendus dans la transcription (marques, URL, noms). Les sous-titres et les
graphiques, comme la barre d'URL, prennent la bonne orthographe. Pour un assemblage, corrigez le projet de la
partie.

| Paramètre | Type | Sens |
|---|---|---|
| `project` | chaîne, obligatoire | projet |
| `replace` | objet, obligatoire | `{ "mal entendu": "correct" }` |

### `studio_cut_apply`

Approuve le plan de coupe et rend `cut.mp4`, à l'image près, avec des fondus audio de 12 ms. **Synchrone et long**
(environ 50 s pour 30 s de rush) : réglez le délai d'outil de votre client à 600 s. Renvoie `cutVideo`, le nombre de
mots, `cached`, et `next: "studio_produce"`.

| Paramètre | Type |
|---|---|
| `project` | chaîne, obligatoire |

### `studio_beats`

Lit ou modifie le plan de motion design (`beats.json`) : groupes de sous-titres, mots derrière, graphiques,
effets, bruitages, en secondes sur la timeline coupée. Format : [Fichiers d'un projet](fichiers.md#beatsjson).

| Paramètre | Type | Sens |
|---|---|---|
| `project` | chaîne, obligatoire | projet |
| `action` | `propose` \| `show` \| `set` | voir ci-dessous |
| `beats` | objet | pour `set` : l'objet complet, tel que `show` le renvoie, corrigé |

- `propose` : **job**. Survol du détourage, puis détourage à pleine cadence des fenêtres candidates, et
  remplacement des instables. Renvoie un résumé.
- `show` : renvoie `beats.json`.
- `set` : valide et remplace `beats.json`. Renvoie un résumé, ou l'erreur de validation.

### `studio_produce`

**Job** qui enchaîne survol du détourage, proposition des beats (seulement s'il n'en existe pas encore),
composition, `lint`/`check`, audio, rendu et QA. Il ne s'arrête nulle part : pour relire les beats d'abord, passez
par `studio_beats`, puis appelez `studio_produce`, qui garde les beats existants.

| Paramètre | Type | Sens | Défaut |
|---|---|---|---|
| `project` | chaîne, obligatoire | projet | — |
| `formats` | `["16x9", "9x16"]` | formats | ceux du projet |
| `quality` | `draft` \| `standard` \| `high` | qualité du rendu | `standard` |
| `repropose` | booléen | recalcule les beats même s'ils existent (**perd les corrections**) | `false` |

### `studio_step`

Relance une étape tardive en arrière-plan, par exemple après avoir modifié les beats ou un style. **Job.**

| Paramètre | Type | Sens |
|---|---|---|
| `project` | chaîne, obligatoire | projet |
| `step` | `compose` \| `audio` \| `render` \| `qa` | étape |
| `formats` | liste | formats |
| `force` | booléen | ignore le cache |

`qa` rend d'abord ce qui manque, puis vérifie.

### `studio_qa`

Renvoie, pour chaque export, la planche contact **en image** (une vignette par seconde, horodatée), avec les
fichiers, le volume, la durée et les avertissements.

| Paramètre | Type | Sens |
|---|---|---|
| `project` | chaîne, obligatoire | projet |
| `mattePreview` | booléen | ajoute l'aperçu du détourage sur fond magenta |

### `studio_assemble`

Monte plusieurs rushs en **une** vidéo. **Job.** Il prépare chaque partie. Tant que la coupe d'une partie n'est pas
relue, il s'arrête et liste les parties concernées : relisez chacune (`studio_cut_review`, `studio_cut_apply`),
puis rappelez-le. Une fois l'assemblage fait, continuez avec `studio_beats` puis `studio_produce` sur
`project = spec.name`.

| Paramètre | Type |
|---|---|
| `spec` | objet, obligatoire : voir [Assembler plusieurs rushs](../07-assembler-plusieurs-rushs.md#la-spécification) |

### `studio_recipe_save`

Enregistre un projet validé comme recette (`recipes/<name>.yaml`) : style, overrides, formats, structure et brief.

| Paramètre | Type | Sens |
|---|---|---|
| `project` | chaîne, obligatoire | projet |
| `name` | chaîne, obligatoire | nom de fichier, minuscules et tirets |
| `title`, `description` | chaînes | affichage |
| `prompt` | chaîne | le brief ; un brouillon est écrit d'après le projet s'il est omis |

## Tickets

Voir [Longs montages : les tickets](../08-longs-montages-tickets.md).

### `studio_tickets`

| Paramètre | Type | Sens |
|---|---|---|
| `project` | chaîne, obligatoire | projet |
| `action` | `propose` \| `show` \| `set` | `propose` réécrit le découpage par défaut en gardant les tickets faits ; `show` renvoie le tableau et chaque ticket ; `set` remplace tous les tickets ouverts |
| `tickets` | liste | pour `set` : chaque ticket en markdown (comme `show`) ou `{ id, title, dependsOn?, checkpoint?, context?, done? }` ; identifiants uniques, dépendances connues, pas de cycle |

### `studio_ticket_next`

Le prochain ticket prêt (ouvert, toutes ses dépendances faites), entier, en markdown. Un `checkpoint` renseigné
signale une porte de revue : demandez à l'utilisateur avant de fermer le ticket. Renvoie `id: null` avec la raison
quand rien n'est prêt.

| Paramètre | Type |
|---|---|
| `project` | chaîne, obligatoire |

### `studio_ticket_close`

| Paramètre | Type | Sens | Défaut |
|---|---|---|---|
| `project` | chaîne, obligatoire | projet | — |
| `id` | chaîne, obligatoire | par exemple `0003` | — |
| `result` | chaîne, obligatoire | 2–3 lignes : ce qui a changé, ce qui a été vérifié, ce qui reste | — |
| `status` | `fait` \| `ouvert` | `ouvert` laisse le ticket ouvert pour la session suivante | `fait` |
| `reprise` | chaîne | avec `ouvert` : où reprendre | `result` |

Renvoie le statut et le ticket suivant.

---

## Prompts

Les prompts apparaissent comme des commandes sélectionnables dans les clients qui les gèrent. Dans Claude Code :
`/mcp__studio__<nom>`.

| Prompt | Arguments | Ce qu'il demande à l'agent |
|---|---|---|
| un par recette (`demo-produit`, `reel-viral`, `storytelling`, et les vôtres) | `rushes` (chemins séparés par des virgules), `notes` facultatif | monter avec cette recette et suivre son brief, puis les trois relectures du skill |
| `questionnaire` | `rushes` | poser le questionnaire en une fois, montrer le résultat, lancer le montage |
| `ticket` | `project`, `id` facultatif | faire le prochain ticket (ou celui nommé) dans une session neuve, et finir en trois lignes : livré, vérifié, reste |
| `tickets` | `project` | piloter la boucle des tickets : un sous-agent neuf par ticket, arrêt et question à chaque checkpoint |

Les prompts de recettes sont enregistrés au démarrage du serveur : une recette ajoutée apparaît au redémarrage du
client.
