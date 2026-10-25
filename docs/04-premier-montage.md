# 4. Votre premier montage

> **Dans ce chapitre** : une session complète, de la demande à la vidéo finale, telle que vous la vivrez avec un
> agent. Ensuite, la même chose en ligne de commande. Les deux portes de revue sont expliquées au moment où elles
> arrivent.
>
> **Avant de commencer** : studio est installé ([chapitre 2](02-installer.md)) et branché sur votre client
> ([chapitre 3](03-connecter-un-client.md)).

## Préparer le rush

Quelques réflexes au tournage rendent le montage bien meilleur :

- **Parlez, recommencez, ne coupez pas.** Une phrase ratée ? Dites « je recommence » et reprenez : studio repère la
  reprise annoncée et garde la dernière prise complète.
- **Un fond calme et un cadrage stable** donnent un détourage net, donc de beaux mots derrière vous.
- **Rien dans les mains** si vous voulez des mots derrière : un téléphone ou un micro tenu serait découpé hors de
  vous.
- **Un son propre** : le débruitage aide, mais un micro proche reste le meilleur filtre.
- **Formats acceptés** : mp4, mov, mkv. Vertical ou horizontal, studio sort les deux formats.

Rangez le fichier où vous voulez et notez son chemin absolu. Dans cet exemple : `/home/vous/videos/budget.mp4`.

## La session, pas à pas

Ce qui suit est une session type avec un agent qui a le skill `studio`. Les phrases de l'agent sont des exemples :
la vôtre sera formulée autrement, mais les étapes sont les mêmes.

### 1. Vous demandez

> Monte /home/vous/videos/budget.mp4 pour TikTok, quelque chose de dynamique.

Vous pouvez nommer un style (`cinematic`, `tech-explainer`, `reel-dynamique`) ou une recette, ou ne rien préciser :
l'agent en propose un. Si vous hésitez, demandez le questionnaire (prompt `questionnaire`, ou « pose-moi le
questionnaire studio ») : sept questions à choix multiples qui choisissent et ajustent une recette. Voir
[Styles et recettes](06-styles-recettes-references.md).

### 2. L'agent ouvre le tableau de bord

L'agent appelle `studio_dashboard` et vous donne une adresse locale, en général `http://127.0.0.1:4600`.
Ouvrez-la : vous y suivrez chaque étape, le plan de coupe, puis le rendu sur une timeline, et le journal de chaque
outil que l'agent appelle. Voir [le tableau de bord](09-tableau-de-bord.md).

### 3. Création du projet (1 à 3 minutes, plus longtemps la première fois)

L'agent appelle `studio_create_project { source, style }`. Un job d'arrière-plan :

1. **ingère** le rush : rotation appliquée, cadence d'images constante, son extrait à 16 kHz ;
2. **transcrit** chaque mot avec son horodatage ;
3. **propose un plan de coupe**.

L'agent interroge `studio_status` toutes les 20 secondes environ jusqu'à `done`. La toute première fois, comptez
quelques minutes de plus : whisper.cpp se compile et le modèle se télécharge.

### 4. Première porte : le plan de coupe

L'agent lit le plan (`studio_cut_review`) comme un monteur. Voici à quoi il ressemble :

```markdown
Durée source **29.6 s** → montée **17.0 s** (12.7 s retirées, 14 plans).

Aujourd'hui, je vais vous montrer comment monter une vidéo. Hut. La première chose, c'est le son.
~~Le~~ ~~budget~~ ~~est~~ ~~de~~ ~~30.~~ ~~Non~~ ~~à~~ ~~temps,~~ ~~je~~ ~~recommence.~~ Le budget est de 50 euros par mois.

| Début   | Fin     | Raison           | Mots (ids)                        |
|---------|---------|------------------|-----------------------------------|
| 0:08.06 | 0:10.22 | prise ratée      | Le budget est de 30. (w16…w20)    |
| 0:10.54 | 0:13.10 | reprise annoncée | Non à temps, je recommence. (w21…w25) |
```

Ce que l'agent vérifie, et corrige :

- la **dernière** prise complète d'une phrase répétée est gardée ;
- un « Hut. » ou un « Heu » que la transcription a pris pour un mot est retiré (`remove: ["w9"]`) ;
- une phrase prise à tort pour une reprise, ou une pause qui porte du sens, est restaurée (`restore: [...]`) ;
- les noms propres et les marques mal entendus sont notés pour être corrigés.

Il vous résume ensuite le plan en deux lignes (« 29,6 s → 17 s ; retiré : une prise ratée, la reprise annoncée,
deux hésitations ») et attend votre accord. **C'est le moment de dire** si une phrase doit rester ou partir.

Puis il applique : `studio_cut_apply` rend `cut.mp4` à l'image près, avec des fondus audio de 12 ms à chaque coupe
pour éviter les clics.

### 5. Le motion design (2 à 10 minutes)

L'agent lance `studio_beats { action: "propose" }`. studio repère les candidats aux mots derrière, détoure la
personne image par image autour de chacun, rejette les fenêtres où le détourage scintille, puis propose :

- les **groupes de sous-titres** (2–3 mots) et le mot clé de chacun ;
- **1 à 3 mots derrière** vous : un chiffre, le nom clé, la chute ;
- les **graphiques** : compteur pour « 50 euros par mois », carte question, barre d'URL, A contre B, définition,
  bouton d'abonnement en fin de vidéo, titre d'ouverture ;
- les **effets** (zoom punch, secousse, flash, whip…), chacun avec sa raison, sous un budget par 10 secondes ;
- les **bruitages** calés sur leur cause.

L'agent relit tout (`studio_beats { action: "show" }`). Il retire un effet tombé sur une phrase grave, corrige le
libellé d'un compteur, ne remet jamais un mot derrière sur une plage marquée instable, puis renvoie le plan corrigé
(`studio_beats { action: "set" }`). Si une marque est mal transcrite partout (« khemrafa.clic » pour
xewxew.click), il la corrige une fois dans la transcription (`studio_fix_words`) et repropose.

### 6. Production (5 à 15 minutes)

`studio_produce` enchaîne en arrière-plan : composition HyperFrames, contrôles automatiques (`lint`, `check`),
mixage audio, rendu de chaque format, QA. C'est l'étape longue : environ 3 minutes de rendu par format pour 20 s de
vidéo sur 4 cœurs, plus pour un style chargé en effets.

### 7. Deuxième porte : les planches contact

L'agent appelle `studio_qa` et **regarde** une planche par export : une vignette par seconde, avec l'horodatage. Il
vérifie :

- les mots derrière sont **partiellement cachés par la tête** (la tête devant les lettres) ;
- les sous-titres sont lisibles, hors du visage, et rien n'est coupé au bord ;
- les graphiques ne couvrent pas le visage et les compteurs affichent la bonne valeur ;
- le volume est proche de **−16 LUFS** et la crête vraie sous **−1 dBTP** ;
- la liste des avertissements.

S'il trouve un défaut, il corrige les beats ou le style, puis relance `compose`, `render` et `qa` avec
`studio_step`. Il fait **trois tours de correction au plus**, puis il vous dit ce qui reste.

### 8. Livraison

L'agent vous donne :

```
work/budget/07-render/budget_9x16.mp4    17,0 s   −15,8 LUFS
work/budget/07-render/budget_16x9.mp4    17,0 s
```

…avec ce qui a été coupé, les mots derrière et les graphiques utilisés, et les avertissements qu'il n'a pas pu
lever. Le fichier `receipt.json` à côté des vidéos garde la trace de chaque version, modèle et réglage.

**Un montage vous plaît ?** Dites-le (« garde ce style ») : l'agent propose de l'enregistrer comme recette
(`studio_recipe_save`), avec un brief tiré de ce que vous avez aimé et corrigé. La prochaine vidéo du même genre
partira de là.

## Le même montage en ligne de commande

Chaque étape a son équivalent en CLI, pratique pour les scripts ou pour comprendre ce qui se passe :

```bash
cd /chemin/absolu/vers/studio

# 1–3. Ingestion, transcription, plan de coupe : s'arrête à la première porte
node dist/cli.js run /home/vous/videos/budget.mp4 --style reel-dynamique

# 4. Lire le plan, le corriger, l'appliquer
cat work/budget/03-cut/cutplan.md
node dist/cli.js cut budget --remove w9 --restore w31
node dist/cli.js cut budget --apply

# corriger une marque mal entendue, si besoin
node dist/cli.js fix budget "khemrafa.clic=xewxew.click"

# 5–7. Relancer run : il reprend où il s'était arrêté, jusqu'aux exports et à la QA
node dist/cli.js run /home/vous/videos/budget.mp4 --style reel-dynamique

# regarder le résultat
xdg-open work/budget/08-qa/sheet_9x16.png        # macOS : open
cat work/budget/08-qa/qa.md
```

Pour modifier le motion design à la main, éditez `work/budget/05-compose/beats.json` (format dans
[Fichiers d'un projet](reference/fichiers.md#beatsjson)), puis :

```bash
node dist/cli.js step budget compose
node dist/cli.js step budget render
node dist/cli.js step budget qa
```

Chaque étape est en cache : relancer `run` ne refait que ce qui a changé.

## Et après ?

- Comprendre ce que fait chaque étape et pourquoi : [5. Le pipeline](05-le-pipeline.md).
- Changer le rendu (sous-titres, couleurs, effets, rythme) : [6. Styles, recettes et références](06-styles-recettes-references.md).
- Une intro, une démo à l'écran et une explication dans une même vidéo : [7. Assembler plusieurs rushs](07-assembler-plusieurs-rushs.md).

---

Précédent : [3. Connecter un client MCP](03-connecter-un-client.md) · Suivant : [5. Le pipeline](05-le-pipeline.md)
