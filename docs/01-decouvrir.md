# 1. Découvrir studio

> **Dans ce chapitre** : ce que studio fait de votre rush, le rôle de l'agent, le vocabulaire utilisé partout dans
> la documentation, et les limites à connaître avant de commencer.

## Ce que studio fait de votre rush

Vous filmez une prise face caméra, au téléphone ou à la webcam, sans vous soucier des hésitations. studio
s'occupe du reste.

| Votre rush brut | Ce que studio en fait |
|---|---|
| des silences, des « euh », des « bah » | coupés, les pauses ramenées à une respiration |
| une phrase ratée puis reprise (« non attends, je recommence ») | la prise ratée retirée, la dernière bonne gardée |
| aucun texte à l'écran | des sous-titres courts (2–3 mots), lisibles, animés au rythme de la voix |
| un plan fixe | des zooms alternés sur les coupes, une lente poussée de caméra, des effets dosés |
| des chiffres, une URL, une question | un compteur qui défile, une barre d'adresse qui se tape, une carte question… |
| un mot important | posé en grand **derrière vous** : votre tête passe devant les lettres |
| un son de téléphone | débruité, compressé, normalisé à −16 LUFS, avec bruitages et musique en ducking |
| un format | deux exports, 16:9 (YouTube) et 9:16 (TikTok, Reels, Shorts) |

Tout tourne sur votre machine : FFmpeg pour l'image et le son, Parakeet et whisper.cpp pour la transcription,
U²-Net pour détourer la personne, et [HyperFrames](https://github.com/heygen-com/hyperframes) (HTML et GSAP
rendus par un Chrome sans interface) pour la composition. Aucune image ni aucun son ne quitte votre ordinateur, et
la télémétrie de chaque outil est coupée.

## Qui fait quoi : studio et l'agent

studio ne contient **aucun modèle de langage**. Chaque décision a une heuristique par défaut, déterministe et
testée. Par exemple : « un mot répété en début de phrase est un bégaiement », « une phrase recommencée est une
prise ratée ». Chaque proposition est écrite dans un fichier lisible.

L'agent, le LLM de votre client MCP, joue le **monteur** :

```
           studio (local, déterministe)                     l'agent (votre client MCP)
 ┌───────────────────────────────────────────┐   ┌─────────────────────────────────────────┐
 │ ingère, transcrit, mesure les silences     │   │                                         │
 │ propose un plan de coupe (cutplan.md) ─────┼──▶│ relit : garde la bonne prise,           │
 │                                            │◀──┼─ retire un « Heu » mal entendu…         │
 │ applique la coupe, détoure la personne     │   │                                         │
 │ propose un motion design (beats.json) ─────┼──▶│ relit : mots derrière, graphiques,      │
 │                                            │◀──┼─ effets, emojis, fautes de transcription│
 │ compose, mixe, rend, fait la QA ───────────┼──▶│ regarde les planches contact,           │
 │                                            │◀──┼─ corrige, relance (3 tours au plus)     │
 └───────────────────────────────────────────┘   └─────────────────────────────────────────┘
```

Cette séparation a deux avantages. Le même rush donne toujours la même proposition, donc vous pouvez reproduire
et déboguer un montage. Et le choix éditorial reste lisible : vous pouvez ouvrir `cutplan.md` ou `beats.json` et
voir exactement ce qui sera coupé ou animé, et pourquoi.

## Deux portes de revue

Le montage s'arrête deux fois pour qu'un humain, ou l'agent avec vous, valide :

1. **Le plan de coupe.** Avant de couper quoi que ce soit, studio montre la transcription avec les mots retirés
   barrés. Rien n'est rendu tant que ce plan n'est pas approuvé.
2. **Les planches contact.** Après le rendu, studio produit une image par export, avec une vignette par seconde
   et l'horodatage, plus la mesure du volume. L'agent les regarde : sous-titres lisibles et hors du visage, mots
   derrière bien cachés par la tête, rien de coupé au bord du cadre.

Entre les deux, l'agent relit le **motion design**. Ce n'est pas une porte obligatoire, mais c'est là que se joue
la qualité du montage.

## Deux façons de piloter studio

| | Avec un agent (MCP) | En ligne de commande (CLI) |
|---|---|---|
| pour qui | tout le monde | scripts, automatisation, débogage |
| comment | vous demandez « monte rushs/ma-video.mp4 en style reel-dynamique » | `node dist/cli.js run rushs/ma-video.mp4 --style reel-dynamique` |
| relecture | l'agent relit et corrige, vous validez | vous lisez `cutplan.md` et vous corrigez avec `studio cut` |
| programme | `dist/mcp.js` (serveur MCP, transport stdio) | `dist/cli.js` |

Les deux appellent exactement les mêmes fonctions et écrivent dans le même dossier `work/`. Vous pouvez commencer
un projet par l'agent et le finir en ligne de commande, ou l'inverse.

## Le vocabulaire

Ces mots reviennent dans toute la documentation, dans les outils et dans les fichiers.

| Terme | Sens |
|---|---|
| **rush** | une vidéo source telle qu'elle sort de la caméra ou de l'enregistreur d'écran |
| **projet** | le travail sur un rush (ou un assemblage), rangé dans `work/<projet>/` ; son nom vient du nom du fichier |
| **étape** | un des huit stades du pipeline : ingest, transcribe, cut, matte, compose, audio, render, qa |
| **plan de coupe** | la liste des mots gardés et retirés, avec la raison de chaque coupe (`cutplan.md`) |
| **plan** (au sens montage) | un morceau continu de rush conservé entre deux coupes |
| **beats** | le plan de motion design (`beats.json`) : sous-titres, mots derrière, graphiques, effets, bruitages |
| **mot derrière** | un grand mot posé entre le fond et la personne détourée ; la tête passe devant |
| **matte** | le détourage de la personne (son masque alpha) |
| **style** | un fichier `styles/*.yaml` qui fixe polices, couleurs, rythme, sous-titres, effets, étalonnage, son |
| **overrides** | des réglages de style propres à un projet, posés par-dessus le style sans le modifier |
| **recette** | un montage validé gardé pour les suivants : brief pour l'agent, style, overrides, formats |
| **référence** | une vidéo que vous aimez, mesurée pour en reproduire l'énergie (`--like`) |
| **assemblage** | plusieurs rushs (parties) joints en une seule vidéo |
| **partie** | un rush à l'intérieur d'un assemblage, avec sa propre coupe relue |
| **porte de revue** | un point où le montage attend une validation humaine |
| **ticket** | une unité de travail calibrée pour une session d'agent neuve, pour les longs montages |
| **job** | un calcul lancé en arrière-plan par le serveur MCP ; l'agent le suit avec `studio_status` |

## Ce que studio ne fait pas (encore)

Mieux vaut le savoir avant de filmer :

- **Le détourage reconnaît les personnes, pas les objets.** Un téléphone ou un micro tenu en main est découpé hors
  du sujet, et le mot derrière passe devant lui. Une autre personne dans le champ est détourée aussi.
- **Mouvement rapide et fond chargé font scintiller le détourage.** studio retire alors le mot derrière plutôt que
  de livrer un scintillement, et le signale dans la QA.
- **Les lexiques sont en français.** La transcription fonctionne dans les autres langues que Parakeet couvre, mais
  la détection des hésitations, des reprises et des mots vides (`src/lib/words.ts`) est écrite pour le français.
- **Les marques et les URL sont souvent mal entendues.** On les corrige une fois pour toutes
  (`studio_fix_words`), voir [le pipeline](05-le-pipeline.md#2-transcribe--la-transcription-mot-à-mot).
- **Pas de GPU requis, donc des rendus longs.** Comptez 12 à 20 minutes pour les deux formats d'un rush de 30 s sur
  un portable 4 cœurs. Le projet choisit la qualité plutôt que la vitesse : un effet n'est jamais simplifié pour
  gagner du temps de calcul.
- **Linux et macOS uniquement.** Sous Windows, passez par WSL2, voir [Installer](02-installer.md#windows-wsl2).

---

Suivant : [2. Installer](02-installer.md)
