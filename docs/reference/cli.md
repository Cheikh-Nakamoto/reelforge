# Référence : ligne de commande

```bash
node dist/cli.js <commande> [arguments] [options]
```

Le binaire s'appelle `studio` dans `package.json`. Après un `npm link` dans le dossier studio, vous pouvez taper
`studio <commande>` partout. Pour le développement, `npm run dev -- <commande>` lance les sources TypeScript
directement, sans compiler.

Les journaux vont sur la sortie d'erreur (stderr). Chaque commande qui touche un projet est aussi ajoutée à
`work/<projet>/events.jsonl` ([tableau de bord](../09-tableau-de-bord.md)). `studio --help` affiche le résumé.

## Commandes

| Commande | Rôle |
|---|---|
| [`run`](#run) | pipeline complet d'un rush |
| [`cut`](#cut) | lire, corriger, appliquer le plan de coupe |
| [`fix`](#fix) | corriger des mots mal entendus |
| [`step`](#step) | (re)lancer une étape |
| [`status`](#status) | état d'un projet |
| [`assemble`](#assemble) | plusieurs rushs en une vidéo |
| [`reference`](#reference) | mesurer une vidéo de référence |
| [`recipes`](#recipes) | lister les recettes |
| [`recipe-save`](#recipe-save) | garder un projet comme recette |
| [`tickets`](#tickets) | tickets d'un projet |
| [`serve`](#serve) | tableau de bord |
| [`styles`](#styles), [`projects`](#projects), [`doctor`](#doctor) | listes et vérification |

---

### `run`

```bash
studio run <rush> --style <nom> [options]
studio run <rush> --recipe <recette> [options]
studio run <rush> --answers '<json>' [options]
```

Lance le pipeline complet. Le premier passage **s'arrête au plan de coupe** tant qu'il n'est pas approuvé. Relancez
la même commande après `studio cut <projet> --apply` : elle reprend où elle s'était arrêtée et va jusqu'aux exports
et à la QA.

| Option | Sens | Défaut |
|---|---|---|
| `--style <nom>` | style | — |
| `--recipe <nom>` | recette (style, overrides, formats) | — |
| `--answers '<json>'` | réponses au questionnaire, par exemple `'{"ton":"Posé"}'` | — |
| `--like <vidéo>` | monter avec l'énergie d'une vidéo de référence | — |
| `--name <nom>` | nom du projet | tiré du nom de fichier |
| `--engine hybrid\|parakeet\|whisper` | moteur de transcription | `hybrid` |
| `--language <iso>` | whisper : langue | `fr` |
| `--model <nom>` | whisper : modèle | `large-v3-turbo` |
| `--approve-cut` | approuve le plan de coupe sans relecture | — |
| `--formats 16x9,9x16` | formats | les deux, ou ceux de la recette |
| `--quality draft\|standard\|high` | qualité du rendu | `standard` |
| `--workers N\|auto` | workers Chrome au rendu | choisi par HyperFrames |
| `--repropose` | recalcule les beats même s'ils existent | — |

### `cut`

```bash
studio cut <projet> [--remove w1,w2] [--restore w3] [--apply [--force]]
```

Sans option, affiche le plan de coupe. `--remove` et `--restore` le corrigent (les corrections s'accumulent).
`--apply` l'approuve et rend `cut.mp4` ; `--force` le rend à nouveau même s'il est en cache.

### `fix`

```bash
studio fix <projet> "mal entendu=correct" ["autre=correction" …]
```

Corrige des mots dans la transcription du projet. Sous-titres et graphiques reprennent la correction au prochain
calcul des beats.

### `step`

```bash
studio step <projet> <matte|beats|compose|audio|render|qa> [--formats 9x16] [--force] [--quality …] [--workers N]
```

Lance une étape seule. `beats` (re)propose le motion design, `--force` ignore le cache. Après une modification de
`beats.json` ou d'un style : `compose`, puis `render`, puis `qa`.

### `status`

```bash
studio status <projet>
```

Étapes en cache et état du plan de coupe.

### `assemble`

```bash
studio assemble <spec.yaml> [--approve-cut] [--formats …] [--like <vidéo>] [--quality …]
```

Plusieurs rushs en une vidéo. Le premier passage prépare les parties et s'arrête aux coupes non relues. Format de
la spécification : [Assembler plusieurs rushs](../07-assembler-plusieurs-rushs.md#la-spécification).

### `reference`

```bash
studio reference <vidéo> [--save-recipe <nom> --style <base>]
```

Mesure une vidéo de référence et affiche les réglages qui la reproduisent. `--save-recipe` en fait une recette sur
le style `--style`.

### `recipes`

```bash
studio recipes
```

### `recipe-save`

```bash
studio recipe-save <projet> <nom> [--title "…"] [--description "…"]
```

### `tickets`

```bash
studio tickets <projet>                                   # tableau
studio tickets <projet> --next                            # prochain ticket prêt, en entier
studio tickets <projet> --propose                         # découpage par défaut (garde les tickets faits)
studio tickets <projet> --close <id> --result "…"         # fermer
studio tickets <projet> --close <id> --status ouvert --reprise "…"   # laisser ouvert avec une reprise
```

### `serve`

```bash
studio serve [--port 4600]
```

Tableau de bord sur `http://127.0.0.1:<port>`, en lecture seule.

### `styles`

Liste les styles.

### `projects`

Liste les projets de `work/`.

### `doctor`

Vérifie la chaîne d'outils et donne la commande qui répare chaque manque. Le code de sortie vaut 1 si un contrôle
obligatoire échoue, ce qui permet de l'utiliser dans un script. Voir
[Installer](../02-installer.md#6-vérifier-avec-doctor).

## Scripts

| Script | Rôle |
|---|---|
| `scripts/fetch-sfx.sh` | télécharge la bibliothèque de bruitages CC0 dans `assets/sfx/` |
| `scripts/make-fixture.sh <vidéo>` | fabrique un rush de test (voix Piper) |
| `scripts/ticket-loop.sh <projet>` | exécute les tickets d'un projet, une session `claude -p` par ticket |
| `scripts/mcp-e2e.ts` | pilote tout le pipeline par le serveur MCP, comme un agent (`npm run e2e -- <rush>`) |
| `scripts/style-schema.ts` | régénère `styles/style.schema.json` (`npm run schema`) |

## Scripts npm

| Commande | Rôle |
|---|---|
| `npm run build` | compile `src/` dans `dist/` |
| `npm run typecheck` | vérification des types sans compiler |
| `npm test` | tests (`node:test`) |
| `npm run dev -- <commande>` | la CLI depuis les sources |
| `npm run mcp` | le serveur MCP depuis les sources |
| `npm run schema` | régénère le schéma JSON des styles |
| `npm run fixture` | `scripts/make-fixture.sh` |
| `npm run e2e -- <rush>` | test de bout en bout par MCP |

## Variables d'environnement

| Variable | Effet |
|---|---|
| `STUDIO_WORK_DIR` | dossier des projets (défaut : `<studio>/work`) |
| `STUDIO_RENDER_WORKERS` | workers Chrome au rendu (`--workers` le fixe pour la commande) |
| `HYPERFRAMES_BROWSER_PATH` | Chrome à utiliser pour le rendu |
| `TICKET_LOOP_CLAUDE_ARGS` | options ajoutées à chaque session de `scripts/ticket-loop.sh` |
