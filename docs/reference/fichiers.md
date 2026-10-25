# Référence : fichiers d'un projet

Chaque projet vit dans `work/<projet>/`, ou dans `$STUDIO_WORK_DIR/<projet>/` si la variable est définie. Le dossier
est ignoré par git. Vous pouvez tout y lire ; seuls quelques fichiers sont faits pour être modifiés à la main,
signalés ✎ ci-dessous.

## Arborescence

```
work/<projet>/
├── project.json             ✎ nom, rush source, style, overrides, recette, formats, référence
├── events.jsonl               journal : appels d'outils, commandes, lignes de journal
├── 01-ingest/
│   ├── source.mp4             rush normalisé : rotation appliquée, 30 i/s constants, grand côté ≤ 1920, AAC 48 kHz
│   ├── audio16k.wav           mono 16 kHz pour l'analyse
│   └── probe.json             ffprobe de source.mp4
├── 02-transcribe/
│   ├── words.json             [{ id, text, start, end }] sur la timeline du rush
│   └── transcript.json        sortie brute des moteurs
├── 03-cut/
│   ├── cutplan.md             le plan de coupe, lisible
│   ├── cutplan.json           le même plan, pour les outils
│   ├── cut.mp4                vidéo coupée (après approbation)
│   ├── words.json             mots recalés sur la timeline coupée
│   └── assembly.json          (assemblages) disposition des parties
├── 04-matte/
│   ├── matte.json             boîte du sujet, hauteur de tête, fenêtres, plages instables
│   ├── matte-preview.png      sujet détouré sur magenta
│   ├── subject.webm           sujet détouré pleine longueur, avec alpha
│   └── windows/               détourages à pleine cadence des fenêtres de mots derrière
├── 05-compose/
│   ├── beats.json           ✎ le plan de motion design
│   ├── compose.json           résultats de hyperframes lint et check
│   ├── 16x9/  9x16/           projets HyperFrames complets (index.html, assets/)
│   └── graded.mp4 …           couches étalonnées par FFmpeg
├── 06-audio/
│   ├── voice.wav              voix traitée
│   ├── mix.wav                mixage final
│   └── audio.json             mesures (LUFS, crête)
├── 07-render/
│   ├── <projet>_16x9.mp4      exports
│   ├── <projet>_9x16.mp4
│   └── receipt.json           reçu : versions, modèles, style, paramètres
├── 08-qa/
│   ├── sheet_<format>.png     planches contact
│   ├── qa.json                fichiers, mesures, avertissements
│   └── qa.md                  le même rapport, lisible
└── tickets/                 ✎ (par les outils) tickets du projet
```

Chaque dossier d'étape contient aussi un `manifest.json` : l'empreinte des entrées, des paramètres et, pour les
étapes de montage, du code. C'est la clé de cache.

## `project.json`

```json
{
  "name": "budget",
  "source": "/home/vous/videos/budget.mp4",
  "style": "reel-dynamique",
  "createdAt": "2026-10-25T09:12:00.000Z",
  "overrides": { "captions": { "look": "pill" } },
  "recipe": "reel-viral",
  "formats": ["9x16"],
  "reference": { "file": "/home/vous/videos/reel.mp4", "report": "…" },
  "assembly": false
}
```

`overrides` a la structure d'un [style](style.md) et passe par-dessus le style au chargement. Une faute dans un
override échoue comme une faute dans le YAML du style.

## `words.json`

```json
[
  { "id": "w0", "text": "Aujourd'hui,", "start": 0, "end": 0.78 },
  { "id": "w1", "text": "je", "start": 0.8, "end": 0.853 }
]
```

Les identifiants `wN` sont stables : ce sont eux que l'on passe à `remove` et `restore`.

## `cutplan.md`

```markdown
# Plan de coupe

Durée source **29.6 s** → montée **17.0 s** (12.7 s retirées, 14 plans). Statut : **appliqué**.

## Texte
Les mots ~~barrés~~ sont retirés. `‖` marque une coupe de silence.
…

## Coupes
| Début | Fin | Raison | Mots (ids) |
|---|---|---|---|
| 0:08.06 | 0:10.22 | prise ratée | Le budget est de 30. (w16…w20) |

## Plans conservés
0:00.00→0:00.81 · 0:00.97→0:02.92 · …
```

Les raisons possibles : hésitation, bégaiement, prise ratée, reprise annoncée, retiré à la main. Les pauses
resserrées n'ont pas de ligne dans le tableau : elles apparaissent comme `‖` dans le texte et entre les plans
conservés.

## `beats.json`

Toutes les heures sont en secondes **sur la timeline coupée**. Ce fichier se modifie par `studio_beats set` (validé
par `BeatsSchema`, [`src/steps/beats.ts`](../../src/steps/beats.ts)), ou à la main avant `studio step <projet>
compose`.

```json
{
  "duration": 16.933,
  "captions": [
    { "id": "cap0", "start": 0.1, "end": 0.833, "emphasis": 0, "emoji": "🎬",
      "words": [{ "id": "w0", "text": "Aujourd'hui,", "start": 0, "end": 0.78 },
                { "id": "w1", "text": "je", "start": 0.8, "end": 0.853 }] }
  ],
  "behind": [
    { "id": "bh0", "wordId": "w27", "text": "budget", "start": 5.593, "end": 6.893, "score": 0.845 }
  ],
  "mographs": [
    { "id": "mg0", "kind": "counter", "start": 4.1, "end": 6.0, "text": "50", "value": 50, "suffix": " €", "label": "par mois", "wordId": "w29" },
    { "id": "mg1", "kind": "badge", "start": 12.747, "end": 15.047, "text": "rapide", "wordId": "w50" }
  ],
  "scenes": [
    { "id": "sc0", "start": 7.683, "end": 9.773, "emphasis": 3, "words": [ … ] }
  ],
  "fx": [
    { "id": "fx0", "kind": "whip", "at": 3.246, "duration": 0.24, "reason": "coupe" }
  ],
  "sfx": [
    { "id": "sfx0", "kind": "whoosh", "at": 3.316 }
  ],
  "cuts": [0.81, 2.76],
  "frames": [],
  "parts": [],
  "notes": []
}
```

| Champ | Contenu |
|---|---|
| `duration` | durée de la timeline coupée |
| `captions[]` | groupes de sous-titres : `words` (mots avec leurs temps), `emphasis` (index du mot clé dans le groupe), `emoji` |
| `behind[]` | mots derrière : `text`, `start`, `end`, `wordId`, `score` |
| `mographs[]` | graphiques : `kind` parmi `counter`, `callout`, `underline`, `badge`, `list`, `question`, `url`, `compare`, `definition`, `cta`, `hook` ; `text`, `value` et `suffix` (compteur), `label`, `items` (`compare` : [gauche, droite] ; `definition` : [terme, sens] ; `hook` : lignes du titre) |
| `scenes[]` | typographie plein écran : `words`, `emphasis` |
| `fx[]` | effets : `kind` parmi `shake`, `zoomPunch`, `flash`, `whip`, `lightLeak`, `colorPop`, `rgbSplit`, `glitch`, `strobe`, `ladder` ; `at`, `duration`, `reason` |
| `sfx[]` | bruitages : `kind` parmi `whoosh`, `pop`, `hit`, `click`, `glitch` ; `at` = l'instant où le son porte (attaque, ou crête d'un whoosh) |
| `cuts[]` | instants des coupes, pour les changements de cadrage synchronisés |
| `frames[]` | cadres réduits : `mode` (`card` \| `bubble`), `start`, `end`, `broll` `{ src, from }`, `reason` |
| `parts[]` | parties d'un assemblage : `name`, `kind` (`face` \| `screen`), `start`, `end` |
| `notes[]` | fenêtres de détourage instables et choix écartés : **ne remettez jamais** un mot derrière sur une plage signalée ici |

**Règles de relecture** (celles du skill) : 1 à 3 mots derrière, jamais deux à l'écran ensemble ; un mot clé et un
emoji par groupe au plus, jamais d'emoji sur une phrase grave ; un effet et son bruitage tombent sur l'image de leur
cause ; 0,3 à 0,75 s d'immobilité avant une chute ; corrigez le `text` d'un mot, jamais ses temps.

## `qa.json`

```json
{
  "files": [
    { "format": "9x16", "file": ".../synth-motion_9x16.mp4", "sheet": ".../sheet_9x16.png",
      "width": 1080, "height": 1920, "duration": 16.93,
      "loudness": { "integrated": -15.8, "truePeak": -3.7, "lra": 1.2 } }
  ],
  "warnings": [],
  "mattePreview": ".../04-matte/matte-preview.png"
}
```

## `receipt.json`

Le reçu de rendu, pour la traçabilité et la licence :

```json
{
  "studio": "0.1.0",
  "licence": "PolyForm-Noncommercial-1.0.0",
  "hyperframes": "0.8.188",
  "ffmpeg": "ffmpeg version 6.1.1-3ubuntu5 …",
  "source": "/home/vous/videos/budget.mp4",
  "style": { "name": "reel-dynamique", "sha1": "b9c232e0…" },
  "quality": "standard",
  "outputs": [{ "file": ".../budget_9x16.mp4", "sha1": "a0d64a6f…" }],
  "steps": {
    "ingest": { "params": { "fps": 30, "maxSide": 1920 }, "seconds": 72.5, "finishedAt": "…" },
    "transcribe": { "params": { "engine": "hybrid" }, "seconds": 32.7, "finishedAt": "…" }
  }
}
```

## `events.jsonl`

Une ligne JSON par événement : `t` (horodatage ISO), `kind` (`tool`, `log`, `error`), `source` (`mcp`, `cli`),
`tool`, `args`, `message`. Voir [le tableau de bord](../09-tableau-de-bord.md#le-journal).

## Les autres dossiers du dépôt

| Dossier | Contenu |
|---|---|
| `styles/` | styles et leur schéma JSON |
| `recipes/` | recettes et questionnaire |
| `skills/studio/`, `skills/ticket/` | les skills pour les agents |
| `templates/` | page du tableau de bord, snippet de flou de mouvement (Apache-2.0) |
| `assets/sfx/`, `assets/music/` | bruitages (téléchargés), musique (la vôtre) |
| `films/` | films faits à la main sans rush (musique seule), un README par film |
| `rushs/` | vos rushs, si vous voulez les ranger là (ignoré par git) |
