# 7. Assembler plusieurs rushs

> **Dans ce chapitre** : faire **une** vidéo à partir de plusieurs fichiers (une intro face caméra, un
> enregistrement d'écran, une explication), réduire le visage en bulle ou en carte, choisir les transitions, et
> l'ordre des opérations.

## Le principe

Chaque rush devient une **partie**, avec sa propre coupe, relue comme un projet seul. Les parties sont ensuite
ajustées à un même cadre, posées sur un fond flou, et jointes par des transitions. Le projet assemblé reprend
ensuite le pipeline normal (motion design, composition, son, rendu, QA) comme s'il s'agissait d'un seul rush.

```
 intro.mp4 ──▶ projet « intro »  ── coupe relue ──┐
 demo.mp4  ──▶ projet « demo »   ── coupe relue ──┼──▶ assemblage « mon-short » ──▶ beats ──▶ produce
 expli.mp4 ──▶ projet « expli »  ── coupe relue ──┘     (03-cut/ synthétique, assembly.json)
```

## La spécification

Un fichier YAML (CLI) ou un objet JSON (MCP) :

```yaml
name: mon-short            # le projet de sortie : minuscules, chiffres, tirets
style: tech-explainer
parts:
  - source: rushs/intro.mp4          # un rush : le projet est créé
  - source: rushs/demo.mp4
    kind: screen                     # enregistrement d'écran : pas de personne à détourer
  - project: expli                   # ou un projet existant
    reduce:
      mode: bubble                   # le visage en bulle dans un coin…
      broll: demo                    # …au-dessus de la démo (une partie ou un fichier)
      from: 8                        # à partir de la 8e seconde de la démo
transitions: [smoothleft]            # chaque jonction suit la même direction
```

| Champ | Sens | Défaut |
|---|---|---|
| `name` | nom du projet assemblé | obligatoire |
| `style` | style du montage final | obligatoire |
| `parts[].project` / `source` | un projet existant, ou un rush à partir duquel en créer un | l'un des deux |
| `parts[].name` | nom du projet créé depuis `source` | tiré du nom de fichier |
| `parts[].kind` | `face` ou `screen` | détecté au survol du détourage |
| `parts[].reduce.mode` | `bubble` (coin, au-dessus d'un B-roll) ou `card` (carte arrondie, place pour un graphique) | `bubble` |
| `parts[].reduce.broll` | ce qui passe en plein cadre derrière : une partie ou un fichier | le fond (`frame.stage`) |
| `parts[].reduce.from` | secondes de départ dans le B-roll | 0 |
| `parts[].reduce.start` / `end` | fenêtre de réduction dans la partie (timeline coupée) | toute la partie |
| `transitions` | transition à chaque jonction, dans l'ordre, répétées en boucle | `[smoothleft]` |
| `transitionDuration` | durée d'une transition, en secondes (0,1 à 1,5) | 0,45 |
| `overrides` | réglages de style du montage final | — |
| `like` | une vidéo de référence ([chapitre 6](06-styles-recettes-references.md#les-références--monter-comme-une-vidéo-que-vous-aimez)) | — |

## Les transitions

Les transitions sont des `xfade` FFmpeg : `smoothleft`, `zoomin`, `slideup`, `circleopen`, `hblur`…, ou `cut` pour
une coupe franche.

Choisissez **un courant et deux ou trois sortes au plus**. Un film qui part à gauche, puis en haut, puis à droite
se lit comme une erreur :

- `smoothleft` pour une jonction ordinaire ;
- `zoomin` seulement quand la partie suivante va plus loin dans la même idée ;
- `cut` pour une rupture franche.

Les fondus (`fade`, `fadeblack`, `fadewhite`, `dissolve`) sont déconseillés : une jonction doit porter le mouvement
d'un côté à l'autre de la coupe.

## Le déroulé

### Avec un agent

> J'ai trois rushs pour une démo : /home/vous/rushs/intro.mp4, demo.mp4 (l'écran) et expli.mp4. Pendant
> l'explication, mets mon visage en bulle au-dessus de la démo.

1. L'agent écrit la spécification et appelle `studio_assemble { spec }`.
2. Le job prépare chaque partie (ingestion, transcription, plan de coupe), puis **s'arrête** en listant les parties
   dont la coupe n'est pas relue.
3. L'agent relit et applique la coupe de **chaque partie** : `studio_cut_review` puis `studio_cut_apply`, avec
   `project` égal au nom de la partie.
4. Il rappelle `studio_assemble { spec }`. L'assemblage se construit.
5. Il continue sur le projet assemblé : `studio_beats`, puis `studio_produce`, puis `studio_qa`, avec
   `project: "mon-short"`.

La recette `demo-produit` décrit exactement cette structure.

### En ligne de commande

```bash
node dist/cli.js assemble mon-short.yaml                # prépare les parties et s'arrête aux coupes
node dist/cli.js cut intro --apply                      # après relecture de work/intro/03-cut/cutplan.md
node dist/cli.js cut demo --apply
node dist/cli.js cut expli --apply
node dist/cli.js assemble mon-short.yaml                # construit l'assemblage et produit
```

`--approve-cut` approuve toutes les coupes sans relecture (pour un essai).

## Bon à savoir

- **L'ordre des parties suit le discours.** Si l'explication dit « comme je le montrais tout à l'heure », elle
  vient après la démo.
- **Une marque mal entendue se corrige dans la partie**, avec `studio_fix_words` sur le projet de la partie.
  L'assemblage reprend la correction quand il est reconstruit.
- **Pas de mots derrière** sur un enregistrement d'écran ni dans un cadre réduit : il n'y a pas de personne en
  plein cadre à faire passer devant.
- **Le téléphone 3D** : avec `frame.device: true`, les enregistrements d'écran flottent dans un téléphone en
  perspective CSS au lieu d'être posés à plat.
- **Vérifiez la bulle sur la planche contact.** Elle ne doit rien cacher d'important de l'écran.
- **Un assemblage est un long montage.** Pensez aux [tickets](08-longs-montages-tickets.md).

---

Précédent : [6. Styles, recettes et références](06-styles-recettes-references.md) · Suivant : [8. Longs montages : les tickets](08-longs-montages-tickets.md)
