# 10. Dépannage et FAQ

> **Dans ce chapitre** : les problèmes les plus fréquents, classés par moment, avec leur cause et leur solution.
> Puis les questions qu'on pose souvent, licence comprise.
>
> **Premier réflexe, toujours** : `node dist/cli.js doctor`. Ensuite, regardez le journal du projet dans le
> [tableau de bord](09-tableau-de-bord.md) (onglet « Journal ») ou dans `work/<projet>/events.jsonl`.

## Installation

### `npm install` échoue

- **`engine "node" is incompatible`** : Node est trop ancien. Il faut Node 22 ou plus (`node --version`). Voir
  [Installer](02-installer.md#ubuntu-debian-linux-mint).
- **Erreur de compilation TypeScript à la fin** : le script `prepare` compile `dist/`. Relancez `npm run build` pour
  voir l'erreur complète, et vérifiez que vous êtes sur une version publiée du dépôt (`git status`).

### `doctor` signale un ✗

Chaque ✗ est suivi de la commande qui répare (`→ …`). Les cas particuliers :

| Ligne | Normal si… | Sinon |
|---|---|---|
| whisper.cpp | vous n'avez encore lancé aucun projet : il se compile au premier | installez git, cmake et un compilateur C, puis relancez un projet |
| U²-Net | vous n'avez encore détouré aucun projet : il se télécharge au premier | vérifiez votre connexion lors de ce premier détourage |
| Emoji font | vous êtes sur macOS (Apple Color Emoji est déjà là) | `sudo apt install fonts-noto-color-emoji` |
| SFX library | vous acceptez les bruitages synthétisés | `scripts/fetch-sfx.sh` |
| Chrome | — | `npx hyperframes browser ensure`, ou `HYPERFRAMES_BROWSER_PATH` vers un Chrome existant |

### La compilation de whisper.cpp échoue

Il manque un outil de compilation. Ubuntu : `sudo apt install git cmake build-essential` ; macOS :
`xcode-select --install && brew install cmake`. Vous pouvez aussi vous en passer avec le moteur `parakeet`
(`engine: "parakeet"`, ou `--engine parakeet`), au prix de mots perdus sur un son bruité.

## Connexion du client

### Le client ne voit pas studio

Vérifiez, dans l'ordre :

1. **`dist/mcp.js` existe.** Sinon : `npm install` (ou `npm run build`) dans le dossier studio.
2. **Le chemin est absolu** dans la configuration, et sans faute de frappe.
3. **Le serveur démarre seul** : `node /chemin/absolu/vers/studio/dist/mcp.js` ne doit rien afficher et attendre
   (Ctrl-C pour quitter). Une erreur ici est la vraie cause.
4. **`node` est trouvé par le client.** Les applications graphiques (Claude Desktop, Cursor, Antigravity…) ne
   chargent pas toujours votre profil shell, et ne voient donc pas le `node` de nvm. Mettez le chemin complet du
   binaire dans `command` (`which node` vous le donne).
5. **Le client a été redémarré**, ou la liste des serveurs rafraîchie.
6. **Claude Code, dans le dossier studio** : le serveur du projet doit être approuvé. `claude mcp list` montre son
   état ; `claude mcp reset-project-choices` repose la question.

### Les outils échouent au bout d'une minute

C'est le délai d'outil du client (60 s par défaut dans Codex, par exemple). Portez-le à 600 s : voir
[les trois réglages qui comptent](03-connecter-un-client.md#3-un-délai-doutil-dau-moins-10-minutes). Les calculs
longs tournent en arrière-plan, mais `studio_cut_apply` rend la vidéo coupée pendant l'appel.

### L'agent ne regarde pas les planches contact

Votre client ne transmet peut-être pas au modèle les images renvoyées par un outil. Demandez à l'agent d'ouvrir
`work/<projet>/08-qa/sheet_9x16.png` avec son outil de lecture de fichiers, ou ouvrez-la vous-même.

### L'agent appelle les outils dans le désordre, ou relit mal

Le skill n'est pas chargé. Installez-le : voir [Le skill](03-connecter-un-client.md#le-skill-ou-comment-lagent-apprend-à-monter).

## Pendant un montage

### `Unknown project "…"`

Le nom du projet vient du nom de fichier du rush, en minuscules avec des tirets : `Mon Rush.MP4` devient
`mon-rush`. `studio_list_projects` (CLI : `studio projects`) donne les noms existants.

### Le rush est introuvable

Le serveur résout les chemins relatifs depuis son propre dossier de travail. Donnez un **chemin absolu**.

### `Project "…" is busy with job …`

Un seul calcul tourne à la fois par projet. Attendez la fin (`studio_status`), puis relancez. Si le job semble
bloqué, regardez ses dernières lignes de journal dans `studio_status`, ou dans le tableau de bord.

### `No cut plan yet`

La création du projet n'est pas allée jusqu'au plan de coupe. Regardez `studio_status` : une erreur
d'ingestion ou de transcription y est affichée.

### `The cut plan keeps nothing`

Toutes les coupes cumulées retirent tout. Revoyez les `remove`, ou restaurez avec `restore`.

### Une marque ou un nom est mal écrit dans les sous-titres

Corrigez-le dans la transcription, une fois pour toutes : `studio_fix_words { project, replace: { "mal entendu":
"correct" } }` (CLI : `studio fix <projet> "mal entendu=correct"`), puis reproposez les beats. Pour une coquille
isolée, corrigez le `text` du mot dans `beats.json`, jamais ses horodatages.

### Un mot derrière a disparu

Le détourage scintillait sur sa fenêtre : mouvement rapide, fond chargé, objet en main, deuxième personne. studio
l'a retiré plutôt que de livrer un défaut. La raison est dans les `notes` de `beats.json` et dans les
avertissements de QA. Ne le remettez pas sur la même plage : choisissez un autre mot, ou acceptez la vidéo sans.

### Des lettres passent devant le visage

La superposition est cassée. C'est un bug, pas un réglage : ne livrez pas, et ouvrez une issue avec la planche
contact et `work/<projet>/04-matte/matte-preview.png`.

### Les emojis s'affichent en carrés

Il manque la police emoji : `sudo apt install fonts-noto-color-emoji`, puis `studio_step { step: "compose" }` et
la suite.

### Avertissement de volume (LUFS, crête vraie)

L'écart à la cible dépasse 1 LU, ou la crête dépasse −1 dBTP. C'est souvent dû à une musique trop forte : baissez
`audio.musicDb`, ou les bruitages avec `audio.sfxDb`, puis relancez `audio`, `render` et `qa`.

### « hyperframes check n'a pas fini dans son délai »

La composition est dense, et la vérification automatique est restée partielle. Ce n'est pas un échec du rendu :
regardez la planche contact avec d'autant plus d'attention.

## Rendu

### Le rendu est très lent, le processeur est à 100 %

C'est normal : tout est rendu sur le processeur, sans GPU. Comptez 2 à 4 minutes par format pour 20 s de vidéo sur
4 cœurs, davantage avec flou de mouvement, profondeur 3D ou scènes. Pour itérer plus vite : un seul format
(`formats: ["9x16"]`) et `quality: "draft"`, puis le rendu final en `standard`.

### Ajouter des workers ne va pas plus vite

Sur une petite machine, le rendu logiciel occupe déjà tous les cœurs : plus de workers Chrome ralentit. Ne les
augmentez (`STUDIO_RENDER_WORKERS`, `--workers`) que sur une machine avec beaucoup de cœurs.

### Repartir de zéro sur une étape

`studio_step { step, force: true }`, ou `studio step <projet> <étape> --force`. Pour tout recommencer, supprimez
`work/<projet>/`.

### Le disque se remplit

Chaque projet garde ses fichiers intermédiaires : vidéo normalisée, vidéo coupée, fenêtres de détourage,
compositions. Supprimez les dossiers `work/<projet>/` dont vous n'avez plus besoin, ou rangez `work/` ailleurs avec
`STUDIO_WORK_DIR`.

## Signaler un bug

Ouvrez une [issue](https://github.com/Cheikh-Nakamoto/reelforge/issues) avec :

- l'outil MCP ou la commande lancés ;
- la sortie de `node dist/cli.js doctor` ;
- le style utilisé ;
- si possible `work/<projet>/08-qa/qa.json`, la planche contact et les dernières lignes de `events.jsonl`.

N'y joignez pas d'images dont vous n'avez pas le droit de les partager.

---

## FAQ

### Est-ce que mes vidéos quittent ma machine ?

**studio**, non : tous ses calculs sont locaux, et la télémétrie de chaque outil qu'il lance est coupée. En
revanche, **l'agent** reçoit, via les réponses d'outils, la transcription, le plan de coupe, `beats.json` et les
planches contact. Si votre client utilise un modèle hébergé (Claude, GPT, Gemini…), ces éléments passent par son
fournisseur, selon les conditions de votre client. Pour garder tout en local, branchez studio sur un client qui fait
tourner un modèle local, ou pilotez studio en CLI.

### Faut-il un GPU ?

Non. Tout tourne sur le processeur. Un GPU n'accélère pas studio aujourd'hui.

### Ça marche sous Windows ?

Par WSL2, voir [Installer](02-installer.md#windows-wsl2) et [Connecter un client](03-connecter-un-client.md#windows-et-wsl2).

### Quel agent, quel modèle choisir ?

N'importe quel client MCP fonctionne. La qualité du montage dépend surtout de la qualité de **relecture** du
modèle : il doit savoir lire une transcription comme un monteur, et regarder une image. Un modèle capable de voir
les images (planches contact) est fortement recommandé.

### Combien de tokens coûte un montage ?

Un montage complet d'un rush court tient dans une session. Un assemblage ou plusieurs formats avec des tours de
correction peuvent dépasser 140 000 tokens : passez alors aux [tickets](08-longs-montages-tickets.md), qui gardent
chaque session courte.

### Et dans une autre langue que le français ?

La transcription fonctionne dans les langues que couvre Parakeet, ou que vous passez à whisper (`language`).
En revanche, la détection des hésitations, des reprises annoncées et des mots vides (`src/lib/words.ts`) est
écrite pour le français : dans une autre langue, l'agent devra retirer davantage de mots à la main. Les
contributions de lexiques sont bienvenues.

### Puis-je utiliser studio pour un client, ou pour ma chaîne monétisée ?

Pas avec la licence gratuite. studio est sous [PolyForm Noncommercial 1.0.0](../LICENSE) : l'usage personnel,
éducatif, associatif, de recherche ou d'administration publique est libre. Un usage commercial (un client, un
employeur, une agence, une chaîne monétisée ou qui promeut une entreprise, un produit payant) demande une licence
écrite de l'auteur **avant** cet usage. Comment la demander : [COMMERCIAL.md](../COMMERCIAL.md). En cas de doute,
considérez que c'est commercial et écrivez.

### Les vidéos exportées portent-elles un filigrane ?

Pas de filigrane visible. Chaque export porte une métadonnée de conteneur qui nomme studio et sa licence, et
`receipt.json` consigne ce qui a servi à le produire. Ne les retirez pas : c'est ainsi que la licence reste visible
en aval.

### Et la musique ?

studio n'en livre aucune. Les morceaux que vous déposez dans `assets/music/` sont sous votre responsabilité :
utilisez des titres dont vous avez les droits. Les bruitages de `scripts/fetch-sfx.sh` sont en CC0.

### Puis-je faire une vidéo sans rush, juste sur de la musique ?

Oui, mais hors du pipeline : copiez `films/video-intro-funk-v2/` et suivez son README (préparation, mesure du
morceau, storyboard, vérification, rendu).

---

Précédent : [9. Le tableau de bord](09-tableau-de-bord.md) · Retour au [sommaire](README.md)
