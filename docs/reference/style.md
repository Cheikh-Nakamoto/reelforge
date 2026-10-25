# Référence : clés de style

Un style est un fichier YAML dans `styles/`, validé par `StyleSchema` ([`src/lib/style.ts`](../../src/lib/style.ts)).
Le schéma JSON `styles/style.schema.json` en est tiré (`npm run schema`) et donne l'autocomplétion dans les éditeurs.
Les mêmes clés servent dans les `overrides` d'une recette, du questionnaire, d'un assemblage ou d'un projet.

Toute clé absente prend la valeur par défaut indiquée ici. Les tailles en pixels s'entendent pour un petit côté de
1080 px.

## En-tête

| Clé | Type | Défaut | Sens |
|---|---|---|---|
| `name` | chaîne | obligatoire | nom du style, identique au nom de fichier |
| `description` | chaîne | `""` | une phrase, affichée par `studio styles` |

## `fonts`

Familles embarquées par HyperFrames, appelées par leur nom : Inter, Montserrat, Oswald, League Gothic,
Archivo Black, Playfair Display, JetBrains Mono, Poppins… Toute autre police demande un `@font-face` vers un
fichier local.

| Clé | Défaut | Sens |
|---|---|---|
| `caption` | `Montserrat` | police des sous-titres |
| `captionWeight` | `800` | graisse des sous-titres |
| `behind` | `League Gothic` | police des mots derrière |
| `behindWeight` | `400` | graisse des mots derrière |
| `graphic` | `Inter` | police des graphiques |

## `colors`

Couleurs CSS (`#rrggbb`, `rgba(…)`).

| Clé | Défaut | Sens |
|---|---|---|
| `text` | `#ffffff` | texte des sous-titres |
| `accent` | `#ffd400` | couleur d'accent : mot prononcé, mot clé, pastille, graphiques |
| `stroke` | `rgba(0,0,0,0.55)` | contour du texte |
| `behind` | `#ffffff` | mots derrière |
| `panel` | `rgba(10,10,10,0.78)` | fonds des panneaux et des boîtes |

## `rhythm` : la coupe

| Clé | Défaut | Sens |
|---|---|---|
| `silenceDb` | `auto` | seuil de silence en dB, ou `auto` : mesuré sur le bruit de fond du rush (recommandé) |
| `minPause` | `0.35` | les pauses plus longues (s) sont resserrées |
| `keep` | `0.12` | respiration gardée de chaque côté d'une pause resserrée (s) |
| `removeFillers` | `true` | retirer les hésitations (« euh », « bah »…) |
| `removeRetakes` | `true` | retirer les prises ratées et les reprises annoncées |

## `captions` : les sous-titres

| Clé | Défaut | Sens |
|---|---|---|
| `enabled` | `true` | afficher les sous-titres |
| `maxWords` | `3` | mots par groupe (1–8) |
| `maxChars` | `18` | un groupe se ferme avant ce nombre de caractères : une ligne, lue d'un coup d'œil |
| `breakPause` | `0.15` | une pause au moins aussi longue (s) ouvre un nouveau groupe |
| `uppercase` | `false` | capitales |
| `look` | `bold` | `bold` (blanc épais, contour noir, le mot dit passe en accent), `pill` (le mot dit sur une pastille), `editorial` (mot clé en serif italique, plus grand), `minimal` (blanc, contour fin, sans couleur) |
| `animation` | `pop` | `pop` (le groupe surgit), `slam` (chaque mot éclate quand il est dit), `rise` (chaque mot monte), `karaoke` (mots grisés allumés quand ils sont dits) |
| `size` | `80` | taille en px ; +15 % en portrait |
| `stack` | `true` | le mot clé sur sa propre ligne quand il ouvre ou ferme le groupe |
| `keyFont` | police des sous-titres | police du mot clé |
| `keyItalic` | `false` | mot clé en italique (look éditorial) |
| `highlightActive` | `true` | marquer le mot en train d'être dit |
| `box` | `false` | fond plein derrière chaque groupe (`colors.panel`), lisible sur n'importe quelle image |
| `position` | `low` | `low` (poitrine, tiers inférieur) ou `mid` (centre, style reel) |
| `emphasis` | `1.3` | facteur de taille du mot clé de chaque groupe (1–1,8 ; 1 = désactivé) |
| `emojis` | `false` | un emoji contextuel au-dessus d'un groupe quand un mot l'appelle (💰 prix, ⏱️ minutes, 🌐 site…) |

## `behind` : les mots derrière le sujet

| Clé | Défaut | Sens |
|---|---|---|
| `enabled` | `true` | activer les mots derrière |
| `max` | `2` | nombre maximal par vidéo (0–3) |
| `hold` | `1.6` | durée à l'écran (s) |
| `minGap` | `5` | écart minimal entre deux mots derrière (s) |
| `animation` | `slam` | `slam`, `rise`, `track` (lettres qui se resserrent), `flip` |
| `size` | `0.34` | hauteur de capitale maximale, en part de la hauteur du cadre (le placement peut réduire) |
| `hideCaptions` | `false` | masquer les sous-titres pendant un mot derrière : le grand mot devient le sous-titre |
| `coverage` | `0.4` | part du mot que le sujet doit cacher, mesurée sur le détourage (0,1–0,7 ; 0,3–0,5 se lit le mieux) |

## `mograph` : les graphiques

| Clé | Défaut | Sens |
|---|---|---|
| `enabled` | `true` | activer les graphiques |
| `minGap` | `3` | écart minimal entre deux graphiques (s) |
| `triggers` | `[]` | lexique : `{ words: [...], kind: callout\|underline\|badge\|list, label? }` ; mots en minuscules, accents ignorés |
| `numbers` | `true` | un nombre dit déclenche un compteur |
| `contextual` | `true` | graphiques tirés de la phrase : carte question, barre d'URL, A contre B, définition, appel à l'action en fin de vidéo |
| `hook` | `false` | un titre sur les premières secondes, tiré des mots forts de la première phrase |

Exemple de lexique :

```yaml
mograph:
  triggers:
    - { words: [attention, piège, erreur], kind: callout, label: "⚠ Piège" }
    - { words: [étape, ensuite, enfin], kind: list }
```

## `motion` : la caméra et le mouvement

| Clé | Défaut | Sens |
|---|---|---|
| `punchIn` | `1.06` | léger zoom sur les mots derrière et les graphiques (1–1,3 ; 1 = aucun) |
| `jumpZoom` | `1` | cadrage alterné à chaque coupe, un plan large puis un serré (1–1,3) : masque le saut d'une coupe face caméra |
| `depth` | `0` | profondeur du motion design (0 plat, 1 fort) : entrées en rotation 3D, titres et mots derrière extrudés |
| `blur` | `false` | flou de mouvement façon After Effects sur ce qui bouge vite ; allonge le rendu |
| `drift` | `1` | lente poussée sur chaque plan, alternativement avant et arrière (1–1,12 ; 1 = désactivé) |
| `ease` | `power3.out` | courbe d'animation GSAP par défaut |

## `scenes` : la typographie plein écran

| Clé | Défaut | Sens |
|---|---|---|
| `max` | `0` | nombre de phrases fortes passées en typographie cinétique plein écran (0–5 ; 0 = désactivé) |
| `minGap` | `8` | écart minimal entre deux scènes (s) |
| `background` | `gradient` | `gradient` (dégradé animé aux couleurs du style) ou `dark` |

## `frame` : les cadres réduits

| Clé | Défaut | Sens |
|---|---|---|
| `reduceOn` | `none` | `mographs` réduit la vidéo en carte pendant les compteurs, listes et callouts ; `none` jamais |
| `cardScale` | `0.74` | largeur de la carte, en part du cadre (0,4–0,95) |
| `bubbleScale` | `0.36` | largeur de la bulle, en part du cadre (0,2–0,5) |
| `radius` | `44` | rayon des coins en px (0–120) |
| `device` | `false` | enregistrements d'écran dans un téléphone 3D flottant |
| `stage` | `#0d1117` | couleur de fond derrière un cadre réduit sans B-roll |

## `effects` : les effets

| Clé | Défaut | Sens |
|---|---|---|
| `maxPer10s` | `2` | effets au plus sur n'importe quelle fenêtre de 10 s (0–6), colour pop exclu ; au-delà de 3, l'œil ne suit plus |
| `strongWord` | `none` | sur les mots forts : `zoomPunch`, `shake`, `both`, `none` |
| `cuts` | `none` | sur les coupes : `flash`, `whip`, `glitch`, `mix` (les trois tour à tour), `none` |
| `cutEvery` | `3` | seule une coupe utilisable sur N reçoit l'effet (1–10) |
| `lightLeaks` | `0` | light leaks chauds répartis sur la vidéo (0–5) |
| `colorPop` | `false` | le monde passe en noir et blanc pendant un mot derrière, le sujet garde ses couleurs |
| `rgbSplit` | `false` | séparation RVB sur chaque zoom punch et secousse (cuite par FFmpeg) |
| `ladder` | `0` | escaliers de zooms (paliers francs) en ouverture des N plus longs plans (0–4) |
| `keywords` | `[]` | mots dits qui déclenchent un effet : `{ words: [...], kind: shake\|zoomPunch\|flash\|glitch\|rgbSplit\|strobe }` |
| `intensity` | `1` | amplitude des secousses, taille des punchs, force des flashs (0,2–2) |

Deux effets qui pilotent la même couche ne se chevauchent jamais : caméra (secousse, zoom punch, whip, escalier),
surimpression (flash, stroboscope), effets cuits (glitch, RGB split).

## `look` : l'étalonnage

Cuit par FFmpeg, avec la même chaîne sur la vidéo, le sujet détouré et le fond flou.

| Clé | Défaut | Sens |
|---|---|---|
| `grade` | `none` | `deep-contrast`, `clean-studio`, `bright-pop`, `muted-editorial`, `warm-daylight`, `mono-clean`, `none` |
| `gradeIntensity` | `0.8` | force de l'étalonnage (0–1) |
| `vignette` | `0` | vignettage (0–1) |
| `grain` | `0` | grain déterministe (0–1) |
| `letterbox` | `0` | bandes noires à ce rapport sur les exports paysage (par exemple `2.39`) ; 0 = aucune |

## `audio` : le son

| Clé | Défaut | Sens |
|---|---|---|
| `denoise` | `true` | débruitage de la voix |
| `lufs` | `-16` | volume intégré visé |
| `music` | `auto` | `auto` (premier morceau de `assets/music/`), un nom de fichier, ou `none` |
| `musicDb` | `-22` | niveau de la musique (dB) |
| `duckDb` | `10` | atténuation supplémentaire de la musique pendant la voix (dB) |
| `sfx` | `true` | bruitages |
| `sfxDb` | `-14` | niveau des bruitages (dB) |
