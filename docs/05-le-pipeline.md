# 5. Le pipeline, étape par étape

> **Dans ce chapitre** : les huit étapes, dans l'ordre. Pour chacune : ce qu'elle fait, ce qu'elle produit, combien
> de temps elle prend, ce qui peut mal tourner, et l'outil MCP ou la commande qui la pilote. Puis le cache, qui
> rend chaque relance rapide.

```
rush.mp4 ─▶ 1 ingest ─▶ 2 transcribe ─▶ 3 cut ─▶ 4 matte ─▶ 5 compose ─▶ 6 audio ─▶ 7 render ─▶ 8 qa
            FFmpeg      Parakeet +      plan     U²-Net     HyperFrames   FFmpeg     Chrome       planches
                        whisper.cpp     ▲ porte             + GSAP        −16 LUFS   headless     ▲ porte
                                        │ de revue                                               │ de revue
```

Chaque étape écrit dans son dossier `work/<projet>/NN-étape/`, avec un `manifest.json` qui lui sert de clé de
cache. Les durées ci-dessous ont été mesurées sur un portable à 4 cœurs sans GPU (i5-7200U), pour un rush de 30 s
monté à environ 18 s.

---

## 1. ingest : normaliser le rush

**Ce qu'elle fait.** Elle rend le rush prévisible pour la suite :

- la **rotation** est appliquée à l'image : une vidéo de téléphone tournée en métadonnées devient vraiment
  verticale ;
- la **cadence d'images** devient constante : les téléphones enregistrent souvent à cadence variable, ce qui
  décalerait image et son au montage ;
- le **grand côté est plafonné** : un rush 4K est réduit, car détourer en 4K coûterait quatre fois plus de calcul
  pour aucun gain visible ;
- le son passe en AAC 48 kHz, et une copie **WAV mono 16 kHz** est extraite pour l'analyse.

**Produit** : `01-ingest/source.mp4`, `audio16k.wav`, `probe.json`. **Durée** : environ 60 s.

**Peut mal tourner** : un fichier illisible ou sans piste son. Lancez `ffprobe votre-rush.mp4` pour voir ce qu'il
contient.

## 2. transcribe : la transcription mot à mot

**Ce qu'elle fait.** Elle produit chaque mot avec son début et sa fin, à quelques centièmes de seconde près. Trois
moteurs sont disponibles :

| Moteur | Comment | Quand |
|---|---|---|
| `hybrid` (défaut) | les **mots** de whisper large-v3-turbo, les **horodatages** de Parakeet | toujours, sauf raison contraire |
| `parakeet` | Parakeet TDT 0.6B v3 seul | rapide, mais perd des mots sur un son bruité |
| `whisper` | whisper.cpp seul (`language`, `model` réglables) | une langue que Parakeet reconnaît mal |

**Pourquoi l'hybride ?** Sur un rush de synthèse bien propre, Parakeet était le meilleur : bords de mots à 0,2 s
près, contre jusqu'à 0,7 s pour whisper. Sur le premier vrai rush de téléphone, bruité, il n'a gardé que 38 mots
sur 76 et il est passé à l'anglais en pleine phrase, alors que whisper avait tous les mots. studio aligne donc les
deux transcriptions (plus longue sous-suite commune sur les mots normalisés). Les mots appariés prennent les temps
de Parakeet, et les autres sont répartis entre ces ancres (`src/lib/align.ts`).

**Produit** : `02-transcribe/words.json`, une liste de `{ id, text, start, end }` où les identifiants valent `w0`,
`w1`… **Durée** : environ 25 s, plus la compilation de whisper.cpp au tout premier usage.

**Peut mal tourner** :

- **Une marque, une URL ou un nom mal entendus.** On les corrige une fois pour toutes dans la transcription :
  `studio_fix_words { project, replace: { "khemrafa.clic": "xewxew.click" } }` (CLI :
  `studio fix <projet> "khemrafa.clic=xewxew.click"`). Les sous-titres et les graphiques, comme la barre d'URL,
  reprennent la bonne orthographe.
- **Une hésitation entendue comme un mot** (« Hut. », « Heu ») : elle se retire à la relecture du plan de coupe.

**MCP** : moteur choisi avec `engine` dans `studio_create_project`. **CLI** : `--engine hybrid|parakeet|whisper`.

## 3. cut : le plan de coupe (première porte de revue)

**Ce qu'elle fait.** Elle décide quoi retirer, puis le pipeline **s'arrête** tant que le plan n'est pas approuvé.

Ce qui est retiré :

| Raison | Exemple | Réglage du style |
|---|---|---|
| hésitation | « euh », « bah », « ben » | `rhythm.removeFillers` |
| bégaiement | « le le budget » | — |
| prise ratée | une phrase recommencée : la dernière prise complète est gardée | `rhythm.removeRetakes` |
| reprise annoncée | « non attends, je recommence » | `rhythm.removeRetakes` |
| pause longue | ramenée à une respiration | `rhythm.minPause`, `rhythm.keep` |

**Les coupes tombent dans les silences mesurés, pas sur les horodatages des mots.** Les horodatages de la
transcription dérivent de quelques dixièmes de seconde : couper dessus mangerait des syllabes. studio mesure donc
les silences du rush lui-même, contre **son propre bruit de fond**. Le seuil est placé au tiers entre le 10e et le
90e centile du volume, mesuré par fenêtres de 50 ms. Un seuil fixe à −35 dB ne trouvait aucune pause sur de vrais
rushs de téléphone. Chaque bord de coupe est ensuite aimanté à la pause la plus proche.

**Produit** : `03-cut/cutplan.md` (lisible), `cutplan.json` (le même plan, pour les outils) ; après application,
`cut.mp4` et `words.json` recalé sur la vidéo coupée. **Durée** : environ 50 s pour le rendu de `cut.mp4`.

**Relire** :

| | MCP | CLI |
|---|---|---|
| voir le plan | `studio_cut_review { project, words: true }` | `cat work/<projet>/03-cut/cutplan.md` |
| retirer des mots | `studio_cut_review { project, remove: ["w9"] }` | `studio cut <projet> --remove w9` |
| garder des mots | `studio_cut_review { project, restore: ["w31"] }` | `studio cut <projet> --restore w31` |
| resserrer les pauses | `studio_cut_review { project, minPause: 0.25, keep: 0.08 }` | réglage `rhythm` du style |
| approuver | `studio_cut_apply { project }` | `studio cut <projet> --apply` |

Les corrections s'accumulent : chaque appel repart du plan corrigé. `--approve-cut` sur `studio run` approuve sans
relecture, ce qui est utile pour un essai mais déconseillé pour un vrai montage.

## 4. matte : détourer la personne

**Ce qu'elle fait.** Elle produit le masque de la personne, qui permet de poser des mots **derrière** elle. Le
détourage U²-Net coûte environ 2,3 s de calcul par image 1080×1920 sur 4 cœurs, soit environ 35 minutes pour
30 s de vidéo à pleine cadence. studio ne détoure donc **que là où ça se voit** :

1. un **survol à 1 image par seconde** repère la boîte du sujet et la hauteur de la tête, et reconnaît un
   enregistrement d'écran (pas de personne à détourer) ;
2. au motion design, seules les **fenêtres des mots derrière** sont détourées à pleine cadence ;
3. chaque fenêtre est notée sur sa **stabilité** : le masque oscille-t-il d'une image à l'autre ? le sujet est-il
   perdu ? Une fenêtre instable fait remplacer le mot par un autre candidat, ou le fait abandonner ;
4. une seule vidéo transparente pleine longueur, `subject.webm`, est assemblée pour que le sujet détouré reste
   calé à l'image près sur la vidéo.

**Produit** : `04-matte/matte.json` (boîte du sujet, fenêtres, plages instables), `matte-preview.png` (le sujet sur
fond magenta, pour vérifier), `subject.webm`, `windows/`. **Durée** : survol environ 50 s, puis 2 à 3 minutes par
mot derrière.

**Peut mal tourner** : mouvement rapide, fond chargé, objet tenu en main, deuxième personne dans le champ. studio ne
force jamais une fenêtre instable : il la signale dans les `notes` des beats et dans la QA.

## 5. compose : le motion design et la composition

C'est le cœur créatif. L'étape se fait en deux temps : **proposer** les beats, relus par l'agent, puis **composer**
les pages HyperFrames.

### Les beats (`beats.json`)

Le plan de motion design, en secondes sur la timeline coupée :

| Élément | Ce que c'est | Comment studio le choisit |
|---|---|---|
| **sous-titres** | 2–3 mots par groupe, sur une ligne, coupure franche entre groupes | pauses, virgules, fins de proposition, jamais d'article en fin de groupe ; un mot clé par groupe au plus, une fois par 1,2 s |
| **mots derrière** | 1 à 3 grands mots entre le fond et la personne | mots forts, appuyés, tenus, en fin de proposition, chiffres ; placés sur le vrai masque pour que la tête cache environ 40 % des lettres |
| **graphiques** | compteur, callout, soulignement, badge, liste ; et, selon le contexte, carte question, barre d'URL, A contre B, définition, appel à l'action, titre d'ouverture | un chiffre dit fait défiler un compteur, une URL se tape, « X au lieu de Y » devient A contre B, « c'est-à-dire » une définition, « abonnez-vous » en fin de vidéo un bouton |
| **scènes** | une phrase forte en typographie plein écran, chaque mot claquant au moment où il est dit | les phrases courtes les plus fortes (`scenes.max`) |
| **effets** | zoom punch, secousse, flash blanc, whip pan, stroboscope, escalier de zooms, light leak, colour pop, glitch, RGB split | mots forts, mots-clés dits (« boom », « stop »), coupes ; sous un budget par 10 s ; jamais deux effets sur une même couche en même temps |
| **bruitages** | whoosh, pop, hit, click, glitch | calés sur leur cause : l'attaque du son, ou la crête d'un whoosh, tombe sur l'image |
| **cadres** | la vidéo réduite en carte (place pour un graphique) ou en bulle (au-dessus d'un écran) | `frame.reduceOn`, ou les assemblages |
| **notes** | les fenêtres de détourage instables, et ce qui a été écarté | — |

Quelques règles apprises sur de vrais rushs : pas de titre d'ouverture tiré d'une salutation, pas de carte pour une
question rhétorique (« …, vous voyez ? »), pas de callout sur un mot nié (« pas de problème »), jamais deux fois le
même emoji.

**Relire** : `studio_beats { project, action: "propose" }` (un job, car il détoure), puis `"show"`, puis `"set"`
avec l'objet entier corrigé. Le format complet est dans [Fichiers d'un projet](reference/fichiers.md#beatsjson).

### La composition

studio génère ensuite une page HTML par format (`05-compose/16x9/`, `9x16/`), animée par **une** timeline GSAP en
pause que HyperFrames fait avancer image par image. Points notables :

- **deux piles de caméra** : la vidéo d'un côté (z 1), les mots derrière (z 2), le sujet détouré par-dessus (z 3).
  Chaque mouvement de caméra (zoom, punch, secousse, poussée lente) s'applique aux deux piles à la fois, pour que
  le sujet détouré reste exactement sur la vidéo ;
- **l'étalonnage, le grain et les effets de pixels sont « cuits » par FFmpeg**, avec la même chaîne de filtres sur
  la vidéo, le sujet détouré et le fond flou. Un filtre CSS sur une seule couche décalerait le détouré de la
  vidéo ;
- `hyperframes lint` et `hyperframes check` mesurent la mise en page, le contraste et les chevauchements.

**Produit** : `05-compose/beats.json`, `16x9/` et `9x16/` (projets HyperFrames complets, ouvrables avec
`npx hyperframes preview`), `compose.json` (résultats de lint et check). **Durée** : de quelques secondes à une
minute, plus le détourage des fenêtres.

## 6. audio : le mixage

**Ce qu'elle fait.** La composition est muette : tout le son est mixé à part par FFmpeg, pour un volume exact et
mesurable.

1. **débruitage** FFT de la voix (`audio.denoise`) ;
2. **compression** ;
3. **musique** depuis `assets/music/` (`audio.music`, niveau `musicDb`), baissée de `duckDb` dB quand vous parlez
   (ducking par sidechain) ;
4. **bruitages** de la bibliothèque, ou synthétisés si elle est absente, chaque catégorie à son niveau médian
   (`audio.sfxDb`) ;
5. **loudnorm en deux passes** à **−16 LUFS** (`audio.lufs`), la cible des plateformes sociales.

**Produit** : `06-audio/voice.wav`, `mix.wav`, `audio.json`. **Durée** : environ 10 s.

## 7. render : les exports

**Ce qu'elle fait.** HyperFrames ouvre chaque composition dans un Chrome sans interface, capture chaque image,
encode la vidéo, puis studio y joint le mixage.

| Qualité | Usage |
|---|---|
| `draft` | essai rapide, pour vérifier la mise en page |
| `standard` (défaut) | livraison |
| `high` | export final exigeant, plus lent |

Chaque export porte une métadonnée `comment` qui nomme studio et sa licence (pas de filigrane visible), et
`receipt.json` consigne les versions, les modèles, l'empreinte du style et les paramètres de chaque étape.

**Produit** : `07-render/<projet>_16x9.mp4`, `<projet>_9x16.mp4`, `receipt.json`. **Durée** : 2 à 4 minutes par
format pour 17–20 s de vidéo. Le flou de mouvement (`motion.blur`), la profondeur 3D et les scènes allongent le
rendu : le projet l'accepte, la qualité passe avant le temps de calcul.

**Workers** : `--workers N` (CLI) ou `STUDIO_RENDER_WORKERS=N` (serveur MCP). Les images sont identiques quel que
soit le réglage ; seule la vitesse change.

## 8. qa : la vérification (deuxième porte de revue)

**Ce qu'elle fait.** Elle mesure et montre le résultat :

- **une planche contact par export** : une vignette par seconde, horodatée ;
- **volume** intégré (LUFS), **crête vraie** (dBTP) et plage dynamique (LRA), mesurés par `ebur128` ;
- **durée** de chaque export comparée au montage ;
- **avertissements** : volume à plus de 1 LU de la cible, crête au-dessus de −1 dBTP, durée qui ne colle pas,
  fenêtres de détourage instables, échec de `lint` ou de `check`, et, avec une référence, l'écart d'énergie (coupes
  et effets par 10 s).

**Produit** : `08-qa/sheet_<format>.png`, `qa.json`, `qa.md`. **Durée** : quelques secondes.

**Relire** : `studio_qa { project, mattePreview: true }` renvoie les planches **en images** à l'agent. Ce qu'il doit
y chercher est détaillé dans [Premier montage](04-premier-montage.md#7-deuxième-porte--les-planches-contact). Pour
corriger : `studio_beats set` ou un override de style, puis `studio_step` sur `compose`, `render` et `qa`. Trois
tours au plus.

---

## Le cache : relancer ne coûte presque rien

Chaque étape enregistre dans son `manifest.json` l'empreinte de ses entrées et de ses paramètres. Une relance
réutilise tout ce qui n'a pas changé.

| Étapes | Recalculée quand… |
|---|---|
| cut, compose, audio, render | leurs entrées, leurs paramètres **ou leur propre code** changent |
| ingest, transcribe, matte | leurs entrées ou leurs paramètres changent ; leur code est versionné à la main |

Les étapes à modèle (dizaines de minutes) ne se relancent pas à chaque modification du code. Un contributeur qui
change leur sortie augmente leur `version` à la main ([Architecture](architecture.md#le-cache)).

Pour forcer un recalcul : `studio_step { step, force: true }` ou `studio step <projet> <étape> --force`.

## Qui pilote quoi

| Étape | Outil MCP | Commande CLI |
|---|---|---|
| 1–3 | `studio_create_project` | `studio run <rush> --style …` |
| 3 (revue) | `studio_cut_review`, `studio_fix_words`, `studio_cut_apply` | `studio cut`, `studio fix` |
| 4–5 (beats) | `studio_beats propose / show / set` | `studio step <projet> beats` |
| 4–8 d'un coup | `studio_produce` | `studio run <rush> --style …` (relancé) |
| 5–8 une par une | `studio_step { step }` | `studio step <projet> compose\|audio\|render\|qa` |
| 8 (revue) | `studio_qa` | `work/<projet>/08-qa/` |
| état | `studio_status` | `studio status <projet>` |

---

Précédent : [4. Premier montage](04-premier-montage.md) · Suivant : [6. Styles, recettes et références](06-styles-recettes-references.md)
