# 3. Connecter un client MCP

> **Dans ce chapitre** : comment un client lance studio, les trois réglages qui comptent, la configuration exacte
> pour chaque client courant, l'installation du **skill** qui apprend à l'agent à monter, et comment vérifier que
> tout est branché.

studio fonctionne avec **n'importe quel client qui accepte un serveur MCP local en stdio**. Ce chapitre donne la
configuration prête à copier pour Claude Code, Claude Desktop, Codex, Antigravity, Gemini CLI, Cursor, VS Code
(Copilot), Windsurf, Zed, Cline, OpenCode, ainsi qu'une recette générique pour les autres.

> Les formats de configuration ont été vérifiés le **25 octobre 2026**. Les clients évoluent vite : en cas de
> doute, la documentation officielle de votre client, liée dans chaque section, fait foi.

## Comment ça marche

```
 votre client (Claude Code, Codex, Antigravity…)
        │  lance, une fois par session :  node /chemin/absolu/vers/studio/dist/mcp.js
        ▼
 serveur studio ── stdin/stdout : messages MCP (appels d'outils, réponses, images)
        │          stderr : journaux
        ├── jobs en arrière-plan : transcription, détourage, rendu… (FFmpeg, HyperFrames, Chrome)
        └── écrit dans  <studio>/work/<projet>/
```

Le client démarre lui-même le serveur : vous n'avez rien à lancer à la main, et rien n'écoute sur le réseau. Le
serveur expose **22 outils** (`studio_*`) et des **prompts** : un par recette, plus `questionnaire`, `ticket` et
`tickets`. La liste complète est dans [la référence MCP](reference/outils-mcp.md).

## Les trois réglages qui comptent

### 1. Un chemin absolu vers `dist/mcp.js`

Certains clients lancent le serveur depuis le dossier ouvert, d'autres depuis votre dossier personnel. Un chemin
relatif ne marche donc que par chance. Écrivez toujours le chemin complet, par exemple
`/home/vous/studio/dist/mcp.js`. Pour l'obtenir :

```bash
cd studio && echo "$(pwd)/dist/mcp.js"
```

Le nom du serveur, **`studio`**, compte aussi : les prompts s'appellent `mcp__studio__<nom>` dans Claude Code, et
le skill parle des outils `studio_*`.

### 2. Des chemins absolus vers les rushs

Le serveur résout un chemin de rush depuis **son propre dossier de travail**, que vous ne contrôlez pas toujours.
Donnez à l'agent des chemins complets (« monte /home/vous/videos/rush.mp4 »), ou rangez vos rushs dans
`<studio>/rushs/` et ouvrez le client dans le dossier studio. Les projets, eux, vont toujours dans
`<studio>/work/`, quel que soit le dossier de lancement.

### 3. Un délai d'outil d'au moins 10 minutes

Les calculs longs (transcription, détourage, rendu) tournent en **jobs d'arrière-plan** : l'outil répond tout de
suite et l'agent suit la progression avec `studio_status`. Quelques outils travaillent pourtant pendant l'appel.
`studio_cut_apply`, par exemple, rend la vidéo coupée : environ 50 s pour un rush de 30 s, davantage sur un long
rush. Un client qui coupe les outils au bout de 60 s fait échouer ces appels. Réglez le délai à **600 s** quand
votre client le permet ; chaque section indique où.

## Choisir sa configuration

| Client | Fichier ou commande | Portée | Skill |
|---|---|---|---|
| [Claude Code](#claude-code) | `.mcp.json` livré, ou `claude mcp add` | projet / utilisateur | natif (`.claude/skills/`) |
| [Claude Desktop](#claude-desktop) | `claude_desktop_config.json` | utilisateur | instructions de projet |
| [Codex](#codex-cli-ide-app) | `~/.codex/config.toml`, ou `codex mcp add` | utilisateur / projet | natif (`.agents/skills/`) |
| [Antigravity](#antigravity) | `~/.gemini/config/mcp_config.json` | utilisateur / projet | natif (`.agents/skills/`) |
| [Gemini CLI](#gemini-cli) | `~/.gemini/settings.json`, ou `gemini mcp add` | utilisateur / projet | `GEMINI.md` |
| [Cursor](#cursor) | `~/.cursor/mcp.json` | utilisateur / projet | règle |
| [VS Code (Copilot)](#vs-code-github-copilot) | `.vscode/mcp.json` | projet / utilisateur | instructions |
| [Windsurf](#windsurf) | `~/.codeium/windsurf/mcp_config.json` | utilisateur | règle |
| [Zed](#zed) | `settings.json` → `context_servers` | utilisateur | règle |
| [Cline / Roo Code](#cline-et-roo-code) | `cline_mcp_settings.json` | utilisateur | règle |
| [OpenCode](#opencode) | `opencode.json` | utilisateur / projet | `AGENTS.md` |
| [Autre client](#nimporte-quel-autre-client) | selon le client | — | instructions |

Dans tous les exemples, remplacez `/chemin/absolu/vers/studio` par le vôtre.

---

## Claude Code

Doc officielle : [Claude Code, MCP](https://docs.anthropic.com/en/docs/claude-code/mcp).

### Dans le dossier studio (rien à configurer)

Le dépôt livre un `.mcp.json` et le lien `.claude/skills/studio`. Lancez Claude Code **depuis le dossier studio** :

```bash
cd /chemin/absolu/vers/studio
claude
```

Au premier lancement, Claude Code demande d'approuver le serveur `studio` déclaré par le projet : acceptez. Le
skill `studio` est chargé automatiquement, et les prompts apparaissent sous `/mcp__studio__…`.

### Depuis n'importe quel dossier

Ajoutez le serveur pour votre utilisateur :

```bash
claude mcp add --scope user studio -- node /chemin/absolu/vers/studio/dist/mcp.js
```

Puis rendez le skill disponible partout :

```bash
mkdir -p ~/.claude/skills
ln -s /chemin/absolu/vers/studio/skills/studio ~/.claude/skills/studio
```

Pour passer une variable d'environnement, par exemple un dossier de projets ailleurs :

```bash
claude mcp add --scope user studio -e STUDIO_WORK_DIR=/data/studio-work -- node /chemin/absolu/vers/studio/dist/mcp.js
```

**Délai** : celui de Claude Code est très long par défaut ; rien à régler.
**Vérifier** : `claude mcp list` doit montrer `studio … ✓ Connected`. Dans une session, `/mcp` liste les outils.

---

## Claude Desktop

Doc officielle : [Connecter des serveurs MCP locaux](https://modelcontextprotocol.io/quickstart/user).

Ouvrez **Réglages → Développeur → Modifier la configuration**. Le fichier se trouve ici :

- macOS : `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows : `%APPDATA%\Claude\claude_desktop_config.json` (avec studio dans WSL2, voir
  [plus bas](#windows-et-wsl2))

```json
{
  "mcpServers": {
    "studio": {
      "command": "node",
      "args": ["/chemin/absolu/vers/studio/dist/mcp.js"]
    }
  }
}
```

Redémarrez Claude Desktop. Si `node` n'est pas trouvé (cas fréquent avec nvm, que l'application ne voit pas),
mettez le chemin complet du binaire : `"command": "/home/vous/.nvm/versions/node/v22.12.0/bin/node"`. La commande
`which node` vous le donne.

**Skill** : si votre version gère les Skills (Réglages → Capacités), importez le dossier `skills/studio` en zip.
Sinon, créez un Projet et collez le contenu de `skills/studio/SKILL.md` dans ses instructions.
**Délai** : Claude Desktop impose son propre délai d'outil, non réglable. Si `studio_cut_apply` échoue sur un long
rush, lancez `node dist/cli.js cut <projet> --apply` dans un terminal, puis reprenez dans Claude Desktop.

---

## Codex (CLI, IDE, app)

Doc officielle : [Codex, MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli) ·
[Codex, skills](https://learn.chatgpt.com/docs/build-skills).

En une commande :

```bash
codex mcp add studio -- node /chemin/absolu/vers/studio/dist/mcp.js
```

Ajoutez ensuite le délai dans `~/.codex/config.toml`, car celui de Codex est de 60 s par défaut. Vous pouvez aussi
écrire le bloc entier à la main :

```toml
[mcp_servers.studio]
command = "node"
args = ["/chemin/absolu/vers/studio/dist/mcp.js"]
startup_timeout_sec = 30
tool_timeout_sec = 600

# facultatif
# [mcp_servers.studio.env]
# STUDIO_WORK_DIR = "/data/studio-work"
```

Le même bloc peut aller dans `.codex/config.toml` à la racine d'un projet que vous avez marqué comme « de
confiance ».

**Skill** : Codex lit les skills dans `.agents/skills/` (dossier courant et racine du dépôt) et dans
`~/.agents/skills/` pour l'utilisateur :

```bash
mkdir -p ~/.agents/skills
ln -s /chemin/absolu/vers/studio/skills/studio ~/.agents/skills/studio
```

**Vérifier** : `codex mcp list`, puis `/mcp` dans une session.

---

## Antigravity

Doc officielle : [Antigravity, MCP](https://antigravity.google/docs/mcp) ·
[Antigravity, skills](https://antigravity.google/docs/skills/).

Dans l'éditeur : panneau de l'agent → menu **…** → **MCP Servers** → **Manage MCP Servers** → **View raw config**.
Le fichier global est `~/.gemini/config/mcp_config.json`. Pour un seul espace de travail, utilisez
`<espace>/.agents/mcp_config.json`.

```json
{
  "mcpServers": {
    "studio": {
      "command": "node",
      "args": ["/chemin/absolu/vers/studio/dist/mcp.js"],
      "timeoutSeconds": 600
    }
  }
}
```

`timeoutSeconds` remplace les deux délais par défaut : 180 s par appel d'outil et 300 s au démarrage.

**Skill** : Antigravity lit `.agents/skills/` dans l'espace de travail, et `~/.gemini/config/skills/` (app et IDE)
ou `~/.gemini/antigravity-cli/skills/` (CLI) pour l'utilisateur :

```bash
mkdir -p ~/.gemini/config/skills
ln -s /chemin/absolu/vers/studio/skills/studio ~/.gemini/config/skills/studio
```

Certaines installations plus anciennes utilisent encore `~/.gemini/antigravity/` au lieu de `~/.gemini/config/`. Si
le serveur n'apparaît pas, regardez lequel des deux dossiers existe chez vous.

---

## Gemini CLI

Doc officielle : [Gemini CLI, serveurs MCP](https://github.com/google-gemini/gemini-cli/blob/main/docs/tools/mcp-server.md).

```bash
gemini mcp add studio node /chemin/absolu/vers/studio/dist/mcp.js
```

Ou, dans `~/.gemini/settings.json` (ou `.gemini/settings.json` pour un projet) :

```json
{
  "mcpServers": {
    "studio": {
      "command": "node",
      "args": ["/chemin/absolu/vers/studio/dist/mcp.js"],
      "timeout": 600000
    }
  }
}
```

`timeout` s'exprime en millisecondes.

**Skill** : Gemini CLI charge les fichiers `GEMINI.md`, qui peuvent en importer d'autres avec `@`. Ajoutez cette
ligne à `~/.gemini/GEMINI.md` :

```markdown
@/chemin/absolu/vers/studio/skills/studio/SKILL.md
```

---

## Cursor

Doc officielle : [Cursor, MCP](https://docs.cursor.com/context/model-context-protocol).

Fichier `~/.cursor/mcp.json` (tous les projets) ou `.cursor/mcp.json` (un projet) :

```json
{
  "mcpServers": {
    "studio": {
      "command": "node",
      "args": ["/chemin/absolu/vers/studio/dist/mcp.js"]
    }
  }
}
```

Activez ensuite le serveur dans **Settings → MCP**. Il doit passer au vert et lister ses outils.

**Skill** : créez une règle (`.cursor/rules/studio.mdc`, ou une règle utilisateur dans les réglages) dont le texte
renvoie au skill, comme dans le [modèle d'instructions](#le-skill-ou-comment-lagent-apprend-à-monter) plus bas.

---

## VS Code (GitHub Copilot)

Doc officielle : [VS Code, serveurs MCP](https://code.visualstudio.com/docs/copilot/chat/mcp-servers).

Fichier `.vscode/mcp.json` dans votre espace de travail. Attention, la clé racine est `servers`, pas `mcpServers` :

```json
{
  "servers": {
    "studio": {
      "type": "stdio",
      "command": "node",
      "args": ["/chemin/absolu/vers/studio/dist/mcp.js"]
    }
  }
}
```

Pour tous vos espaces de travail : palette de commandes → **MCP: Open User Configuration**, même contenu. Le chat
doit être en mode **Agent** pour appeler les outils.

**Skill** : ajoutez le [modèle d'instructions](#le-skill-ou-comment-lagent-apprend-à-monter) à
`.github/copilot-instructions.md` ou à un fichier `AGENTS.md`.

---

## Windsurf

Doc officielle : [Windsurf, MCP](https://docs.windsurf.com/windsurf/cascade/mcp).

Fichier `~/.codeium/windsurf/mcp_config.json` :

```json
{
  "mcpServers": {
    "studio": {
      "command": "node",
      "args": ["/chemin/absolu/vers/studio/dist/mcp.js"]
    }
  }
}
```

Cliquez ensuite sur **Refresh** dans le panneau MCP de Cascade. **Skill** : une règle globale avec le
[modèle d'instructions](#le-skill-ou-comment-lagent-apprend-à-monter).

---

## Zed

Doc officielle : [Zed, MCP](https://zed.dev/docs/ai/mcp).

Dans `settings.json` (**zed: open settings**) :

```json
{
  "context_servers": {
    "studio": {
      "command": "node",
      "args": ["/chemin/absolu/vers/studio/dist/mcp.js"],
      "env": {}
    }
  }
}
```

**Skill** : une règle de la bibliothèque de règles (Rules Library) avec le
[modèle d'instructions](#le-skill-ou-comment-lagent-apprend-à-monter).

---

## Cline et Roo Code

Doc officielle : [Cline, MCP](https://docs.cline.bot/mcp/configuring-mcp-servers).

Panneau MCP → **Configure MCP Servers**, qui ouvre `cline_mcp_settings.json` :

```json
{
  "mcpServers": {
    "studio": {
      "command": "node",
      "args": ["/chemin/absolu/vers/studio/dist/mcp.js"],
      "timeout": 600,
      "disabled": false
    }
  }
}
```

Si le champ `timeout` est refusé par votre version, réglez le délai dans l'interface du serveur. **Skill** : une
règle (`.clinerules`) avec le [modèle d'instructions](#le-skill-ou-comment-lagent-apprend-à-monter).

---

## OpenCode

Doc officielle : [OpenCode, serveurs MCP](https://opencode.ai/docs/mcp-servers/).

Fichier `opencode.json` (projet) ou `~/.config/opencode/opencode.json` (utilisateur) :

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "studio": {
      "type": "local",
      "command": ["node", "/chemin/absolu/vers/studio/dist/mcp.js"],
      "enabled": true
    }
  }
}
```

**Skill** : ajoutez le [modèle d'instructions](#le-skill-ou-comment-lagent-apprend-à-monter) à `AGENTS.md`.

---

## N'importe quel autre client

Tout client compatible MCP accepte un serveur local en stdio. Il vous demandera, sous une forme ou une autre :

| Champ | Valeur |
|---|---|
| nom | `studio` |
| transport / type | `stdio` (ou « local », « command ») |
| commande | `node` (ou le chemin complet de `node`) |
| arguments | `["/chemin/absolu/vers/studio/dist/mcp.js"]` |
| variables d'environnement | facultatives, voir [plus bas](#variables-denvironnement) |
| délai d'outil | 600 s ou plus |

Deux capacités du client améliorent nettement le travail :

- **Les images dans les réponses d'outils.** `studio_qa` et `studio_reference` renvoient des planches contact en
  images. Si votre client ne les montre pas au modèle, l'agent peut ouvrir les fichiers indiqués dans la réponse
  (`work/<projet>/08-qa/sheet_*.png`) avec son outil de lecture de fichiers.
- **Les prompts MCP.** Les recettes et le questionnaire sont des prompts. Un client qui ne les affiche pas peut
  toujours appeler les outils `studio_recipes` et `studio_questionnaire`.

## Le skill, ou comment l'agent apprend à monter

Les outils disent à l'agent **ce qu'il peut faire**. Le skill `skills/studio/SKILL.md` lui dit **comment monter** :
l'ordre des étapes, comment relire un plan de coupe, quand retirer un effet, ce qu'il faut regarder sur une planche
contact, quand s'arrêter. Sans le skill, l'agent appelle les bons outils mais relit moins bien. Installez-le.

| Client | Installation |
|---|---|
| Claude Code | automatique dans le dossier studio ; sinon `ln -s <studio>/skills/studio ~/.claude/skills/studio` |
| Codex | `ln -s <studio>/skills/studio ~/.agents/skills/studio` |
| Antigravity | `ln -s <studio>/skills/studio ~/.gemini/config/skills/studio` (ou `.agents/skills/` dans l'espace de travail) |
| les autres | le modèle d'instructions ci-dessous, dans le fichier de règles ou d'instructions du client |

Un lien symbolique plutôt qu'une copie garde le skill à jour à chaque `git pull`.

**Modèle d'instructions**, pour les clients sans skills natifs :

```markdown
## Montage vidéo avec studio

Quand je demande de monter, couper, sous-titrer ou « monter » une vidéo face caméra, un rush ou un reel, utilise
les outils `studio_*` du serveur MCP studio. Avant le premier appel, lis entièrement
/chemin/absolu/vers/studio/skills/studio/SKILL.md et suis-le : tu es le monteur, studio propose, tu relis.
Les deux portes de revue (plan de coupe, planches contact de QA) sont obligatoires.
```

Si votre client sait importer un fichier (comme le `@` de Gemini CLI), importez directement `SKILL.md`.

## Variables d'environnement

À passer dans le bloc `env` de la configuration du serveur :

| Variable | Effet | Défaut |
|---|---|---|
| `STUDIO_WORK_DIR` | dossier des projets | `<studio>/work` |
| `STUDIO_RENDER_WORKERS` | nombre de workers Chrome au rendu (`auto` ou un entier) | choisi par HyperFrames |
| `HYPERFRAMES_BROWSER_PATH` | un Chrome déjà installé, au lieu de chrome-headless-shell | — |

studio force de lui-même `HYPERFRAMES_NO_TELEMETRY=1`, `DO_NOT_TRACK=1` et `HYPERFRAMES_SKIP_SKILLS=1` sur chaque
processus qu'il lance. Vous n'avez rien à faire pour que rien ne sorte de la machine.

Sur un portable à 4 cœurs, plus de workers ralentit le rendu (1 worker : 134 s, 2 : 141 s, 3 : 165 s pour 17 s de
vidéo), car le rendu logiciel occupe déjà tous les cœurs. N'augmentez `STUDIO_RENDER_WORKERS` que sur une grosse
machine.

## Windows et WSL2

studio tourne dans WSL2, et votre client peut tourner côté Windows. Le client lance alors le serveur à travers
`wsl` :

```json
{
  "mcpServers": {
    "studio": {
      "command": "wsl",
      "args": ["-e", "bash", "-lc", "node /home/vous/studio/dist/mcp.js"]
    }
  }
}
```

`bash -lc` charge votre profil, et donc le `node` de nvm. Les chemins de rushs sont alors des chemins **Linux**
(`/home/vous/videos/rush.mp4`, ou `/mnt/c/Users/vous/Videos/rush.mp4` pour un fichier Windows). Cette configuration
n'est pas testée par le projet : si vous la faites marcher avec un client précis, une
[issue](https://github.com/Cheikh-Nakamoto/reelforge/issues) ou une PR qui complète cette section est la bienvenue.

Plus simple encore : lancez un client en ligne de commande (Claude Code, Codex, Gemini CLI) **dans** WSL2.

## Vérifier que tout est branché

Dans votre client, demandez :

> Lance studio_doctor et studio_list_styles.

Vous devez obtenir la liste des contrôles (voir [Installer](02-installer.md#6-vérifier-avec-doctor)) et les trois
styles `cinematic`, `reel-dynamique` et `tech-explainer`. Si c'est le cas, passez au
[premier montage](04-premier-montage.md).

Si le serveur n'apparaît pas ou échoue au démarrage, lancez-le vous-même pour voir l'erreur :

```bash
node /chemin/absolu/vers/studio/dist/mcp.js
```

Un serveur sain ne répond rien et attend des messages sur son entrée : quittez avec Ctrl-C. Une erreur s'affiche au
contraire tout de suite, par exemple `Cannot find module` si `dist/` n'est pas compilé (`npm install`). Les autres
cas sont dans [Dépannage](10-depannage-faq.md#le-client-ne-voit-pas-studio).

---

Précédent : [2. Installer](02-installer.md) · Suivant : [4. Premier montage](04-premier-montage.md)
