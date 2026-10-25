# 6. Styles, recettes et références

> **Dans ce chapitre** : les trois façons de décider à quoi ressemble une vidéo, de la plus simple à la plus fine.
> Un **style** fixe le rendu. Une **recette** ajoute un brief pour l'agent et des réglages propres. Une
> **référence** mesure une vidéo que vous aimez pour en reproduire l'énergie. Et comment créer votre propre style.

```
           style (styles/*.yaml)
             + overrides de la recette ou du questionnaire
             + overrides mesurés sur une référence (--like)
             + overrides propres au projet (project.json)
           = le style effectif du projet, validé avant chaque étape
```

Les fichiers de style partagés ne sont **jamais** modifiés pour une vidéo : tout réglage propre à un projet est
rangé dans `work/<projet>/project.json` et fusionné par-dessus.

## Les styles

Trois styles sont livrés dans `styles/` :

| Style | Pour | Rendu |
|---|---|---|
| `cinematic` | storytelling, témoignage, contenu premium | rythme posé, sous-titres éditoriaux qui montent mot par mot (mot clé en serif italique), un mot espacé derrière le sujet, étalonnage contrasté, grain, letterbox 2.39 en 16:9 |
| `tech-explainer` | tutoriel, démo produit, explication | sous-titres en pastille (le mot dit passe sur une pastille de couleur), panneaux et compteurs en monospace, callouts sur les étapes et les pièges, étalonnage propre, léger zoom aux coupes |
| `reel-dynamique` | TikTok, Reels, Shorts nerveux | coupes serrées, zoom alterné à chaque coupe, sous-titres de deux mots en capitales qui claquent au centre, jusqu'à trois mots géants derrière le sujet, bruitages marqués |

`studio_list_styles` (CLI : `studio styles`) les liste avec leurs réglages. Si vous ne nommez pas de style, l'agent
en propose un d'après le contenu et continue sauf objection de votre part.

### Les quatre looks de sous-titres

| `captions.look` | Rendu | Références |
|---|---|---|
| `bold` | blanc épais, contour noir, le mot prononcé passe en couleur d'accent et rebondit | Hormozi, MrBeast |
| `pill` | le mot prononcé saute sur une pastille de couleur | la tendance des Reels en 2026 |
| `editorial` | sobre, le mot clé en serif italique plus grand | documentaire, premium |
| `minimal` | blanc épais, contour fin, sans couleur | « minimalisme dynamique » |

Et quatre animations (`captions.animation`) : `pop` (le groupe surgit), `slam` (chaque mot éclate quand il est dit),
`rise` (chaque mot monte quand il est dit), `karaoke` (tous les mots affichés en grisé, allumés quand ils sont
dits).

## Créer votre style

1. Copiez le style le plus proche :

   ```bash
   cp styles/tech-explainer.yaml styles/mon-style.yaml
   ```

2. Changez `name: mon-style`, puis les clés voulues. La première ligne du fichier
   (`# yaml-language-server: $schema=./style.schema.json`) donne l'autocomplétion et la validation dans VS Code
   et les éditeurs compatibles. Toutes les clés sont décrites dans la [référence des styles](reference/style.md).

3. Vérifiez qu'il est valide :

   ```bash
   node dist/cli.js styles
   node dist/cli.js doctor      # la ligne « styles » signale un YAML invalide
   ```

4. Essayez-le sur un rush **court** avant un vrai projet, et regardez la planche contact.

Exemple : un style chaud pour des vlogs, à partir de `cinematic`.

```yaml
# yaml-language-server: $schema=./style.schema.json
name: vlog-chaud
description: Vlog posé, couleurs chaudes, sous-titres éditoriaux.
colors:
  accent: "#ffb347"
rhythm:
  minPause: 0.5
  keep: 0.18
captions:
  look: editorial
  animation: rise
  keyFont: Playfair Display
  keyItalic: true
look:
  grade: warm-daylight
  grain: 0.15
  vignette: 0.2
audio:
  musicDb: -24
```

Les clés absentes prennent leur valeur par défaut, pas celle du style que vous avez copié : copiez le fichier
entier si vous voulez partir d'un style complet.

**Polices** : utilisez celles que HyperFrames embarque (Inter, Montserrat, Oswald, League Gothic, Archivo Black,
Playfair Display, JetBrains Mono, Poppins…). Une autre police demande un `@font-face` vers un fichier local.

## Les recettes

Une recette est **un montage validé, gardé pour les suivants**. C'est un fichier `recipes/<nom>.yaml` qui contient :

- un **brief** pour l'agent (`prompt`), avec ce qu'il faut soigner pour ce genre de vidéo ;
- un **style** et des **overrides** ;
- des **formats** ;
- une **structure** attendue, pour les vidéos à plusieurs rushs.

Trois recettes sont livrées :

| Recette | Style | Formats | Pour |
|---|---|---|---|
| `demo-produit` | tech-explainer | 9:16 | montrer un site, une appli, une méthode ; visage en bulle au-dessus de l'écran |
| `reel-viral` | reel-dynamique | 9:16 | court et nerveux, pour TikTok, Reels, Shorts |
| `storytelling` | cinematic | 16:9 + 9:16 | raconter, rythme posé, image soignée |

**Utiliser une recette** :

- **avec un agent** : « monte rushs/demo.mp4 avec la recette demo-produit ». Dans Claude Code, chaque recette est
  aussi une commande : `/mcp__studio__demo-produit`. D'autres clients affichent les prompts MCP dans leur propre
  menu ;
- **en CLI** : `node dist/cli.js run rushs/demo.mp4 --recipe demo-produit`.

**Enregistrer une recette** : quand un montage vous plaît, dites-le à l'agent. Il appelle
`studio_recipe_save { project, name, prompt }` avec un brief écrit d'après ce que vous avez aimé et ce que vous avez
fait corriger. En CLI :

```bash
node dist/cli.js recipe-save mon-projet ma-recette --title "Ma démo" --description "Démo d'appli en 9:16"
```

Elle apparaît aussitôt dans `studio_recipes`. Elle devient un prompt MCP au **prochain démarrage du serveur**,
c'est-à-dire au redémarrage de votre client.

## Le questionnaire

Vous ne savez pas quoi choisir ? Le questionnaire (`recipes/questionnaire.yaml`) pose sept questions à choix
multiples et en déduit une recette ajustée :

| Question | Effet |
|---|---|
| type de vidéo | choisit la recette (démo, reel, storytelling, annonce) |
| plateforme | choisit les formats (9:16, 16:9, les deux) |
| ton (énergique, posé, professionnel) | densité et intensité des effets, emojis |
| sous-titres (gras, pastille, éditorial, minimal, aucun) | look et animation des sous-titres |
| rythme de coupe (serré, naturel, laisser respirer) | `rhythm.minPause` et `rhythm.keep` |
| ce que vous avez filmé | face caméra, écran, plusieurs rushs (assemblage) |
| extras | mots derrière, profondeur 3D, effets CapCut |

**Avec un agent** : prompt `questionnaire` (Claude Code : `/mcp__studio__questionnaire`) ou « pose-moi le
questionnaire studio ». L'agent pose toutes les questions en une fois, vous montre le résultat
(`studio_recipe_preview`), puis lance le montage. **En CLI** :

```bash
node dist/cli.js run rushs/demo.mp4 --answers '{"type":"Reel viral","ton":"Énergique","plateforme":"Les deux"}'
```

Les clés sont les `id` des questions, les valeurs les `label` des options (une liste pour les questions à choix
multiple). Pour ajouter une question ou une option, éditez `recipes/questionnaire.yaml` : chaque option peut fixer
`recipe`, `formats` et des `overrides` de style.

## Les références : monter comme une vidéo que vous aimez

Vous avez vu un reel dont le rythme vous plaît ? studio le **mesure**, sur votre machine, sans modèle et sans rien
envoyer :

```bash
node dist/cli.js reference rushs/reel-que-j-aime.mp4
```

Il lit l'image en vignettes grises de 96 px et détecte :

| Mesure | Comment |
|---|---|
| coupes par seconde | une différence qu'aucun mouvement n'explique, ou un pic d'une image 2 à 5 fois au-dessus du niveau local |
| flashs blancs, stroboscopes | un saut de luminosité qui revient |
| zoom punchs, escaliers de zooms | une différence soudaine qu'un changement d'échelle d'au moins 4 % explique |
| secousses, whip pans | un mouvement global rapide, une transition sur plusieurs images |
| look | luminosité, saturation, contraste, letterbox |

Il en déduit des **overrides de style** qui reproduisent cette énergie, avec la raison de chacun, et une image par
plan. Il ne lit pas les sous-titres (pas d'OCR) : regardez ces images pour choisir le look de sous-titres
vous-même.

```bash
# monter un rush avec l'énergie de la référence
node dist/cli.js run rushs/demo.mp4 --style reel-dynamique --like rushs/reel-que-j-aime.mp4

# ou en faire une recette
node dist/cli.js reference rushs/reel-que-j-aime.mp4 --save-recipe comme-ce-reel --style reel-dynamique
```

**Avec un agent** : « monte rushs/demo.mp4 comme rushs/reel-que-j-aime.mp4 ». L'agent appelle `studio_reference`,
regarde les images, choisit le look de sous-titres, puis crée le projet avec `like`. À la QA, des avertissements
« Énergie » comparent les coupes et les effets par 10 s du rendu à ceux de la référence.

Limite connue : un basculement plein cadre, comme un colour pop en noir et blanc ou un titre géant, est compté comme
une coupe.

## Régler un seul projet

Pour changer un réglage sur une vidéo sans toucher au style partagé, éditez le champ `overrides` de
`work/<projet>/project.json`. Il a la même structure qu'un fichier de style :

```json
{
  "name": "budget",
  "style": "reel-dynamique",
  "overrides": {
    "captions": { "look": "pill" },
    "effects": { "maxPer10s": 1 }
  }
}
```

Relancez ensuite les étapes concernées : `compose`, `audio`, `render`, `qa` pour un réglage visuel ou sonore ;
`studio cut` puis la suite pour un réglage de `rhythm`. L'agent peut faire cette modification pour vous.

---

Précédent : [5. Le pipeline](05-le-pipeline.md) · Suivant : [7. Assembler plusieurs rushs](07-assembler-plusieurs-rushs.md)
