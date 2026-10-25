# 2. Installer studio

> **Dans ce chapitre** : les prérequis selon votre système, l'installation pas à pas, les modèles téléchargés et
> leur place sur le disque, la vérification avec `doctor`, puis la mise à jour et la désinstallation.
>
> **Temps** : 10 à 30 minutes, surtout du téléchargement. **Disque** : 3 à 6 Go de modèles et de navigateur.

## En bref

Si vous avez déjà Node 22, FFmpeg et un compilateur C :

```bash
git clone https://github.com/Cheikh-Nakamoto/reelforge.git studio
cd studio
npm install                               # installe les dépendances et compile dist/
npx hyperframes models install parakeet   # modèle de transcription (640 Mo)
npx hyperframes browser ensure            # navigateur de rendu
scripts/fetch-sfx.sh                      # facultatif : 45 bruitages CC0
node dist/cli.js doctor                   # tout doit être ✓
```

Passez ensuite à [3. Connecter un client MCP](03-connecter-un-client.md). La suite de cette page détaille chaque
étape.

## Ce dont studio a besoin

| Outil | Pourquoi | Obligatoire |
|---|---|---|
| **Node.js ≥ 22** | studio est écrit en TypeScript et tourne sur Node | oui |
| **FFmpeg et ffprobe** | toutes les opérations sur l'image et le son | oui |
| **git, cmake, un compilateur C/C++** | whisper.cpp est compilé depuis ses sources au premier usage | oui avec la transcription par défaut (`hybrid`) |
| **une police emoji** | les emojis des sous-titres (styles avec `captions.emojis`) | non |
| **un GPU** | — | non : tout tourne sur le processeur |

La machine de référence du projet est un portable à 4 cœurs (i5-7200U) sans GPU. Plus de cœurs donne un rendu plus
rapide. Prévoyez au moins 8 Go de RAM.

## Installer les prérequis

### Ubuntu, Debian, Linux Mint

```bash
sudo apt update
sudo apt install -y ffmpeg git cmake build-essential fonts-noto-color-emoji
```

Node 22 ou plus récent : les dépôts de la distribution sont souvent en retard. Passez par
[nvm](https://github.com/nvm-sh/nvm) :

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
# rouvrez le terminal, puis :
nvm install 22
node --version    # v22.x ou plus
```

### Fedora

```bash
sudo dnf install -y ffmpeg git cmake gcc-c++ make google-noto-color-emoji-fonts
```

FFmpeg complet se trouve dans [RPM Fusion](https://rpmfusion.org/Configuration). Pour Node, utilisez nvm comme
ci-dessus.

### Arch Linux

```bash
sudo pacman -S --needed ffmpeg git cmake base-devel noto-fonts-emoji nodejs npm
```

### macOS

Installez les outils de compilation d'Apple, puis [Homebrew](https://brew.sh) :

```bash
xcode-select --install
brew install node@22 ffmpeg cmake git
```

macOS fournit déjà une police emoji (Apple Color Emoji). Le contrôle « Emoji font » de `doctor` cherche
Noto Color Emoji et restera en ✗ : vous pouvez l'ignorer, ou installer la police Noto pour retrouver exactement le
rendu de Linux.

### Windows (WSL2)

studio ne tourne pas nativement sous Windows : ses scripts sont en bash, et il appelle FFmpeg et Chrome par des
chemins Unix. Passez par WSL2 :

1. Dans PowerShell, en administrateur : `wsl --install -d Ubuntu`, puis redémarrez.
2. Ouvrez « Ubuntu » et suivez la section [Ubuntu](#ubuntu-debian-linux-mint) ci-dessus.
3. Clonez studio **dans le système de fichiers Linux** (`~/studio`), pas dans `/mnt/c/…` : les accès disque y sont
   bien plus rapides.
4. Pour brancher un client MCP installé côté Windows, voir
   [Windows et WSL2](03-connecter-un-client.md#windows-et-wsl2) dans le chapitre suivant.

## Installer studio

### 1. Récupérer le code

```bash
git clone https://github.com/Cheikh-Nakamoto/reelforge.git studio
cd studio
```

Retenez le chemin absolu de ce dossier (`pwd`) : les clients MCP en ont besoin. Dans la suite, on l'appelle
`$STUDIO` :

```bash
export STUDIO="$(pwd)"
```

### 2. Installer les dépendances

```bash
npm install
```

Cette commande installe HyperFrames (version figée `0.8.188`), GSAP, le SDK MCP, zod et yaml. Elle compile aussi
le TypeScript dans `dist/` (script `prepare`). À la fin, vous devez avoir `dist/mcp.js` et `dist/cli.js`.

> **Pourquoi une version figée de HyperFrames ?** Sa ligne de commande en version 0.x change souvent. Une mise à
> jour se fait délibérément, avec les tests et un rendu complet (décision 1 de [CLAUDE.md](../CLAUDE.md)).

### 3. Installer les modèles

Tous les modèles se rangent une fois pour toutes dans `~/.cache/hyperframes/`.

| Modèle | Rôle | Taille | Comment il arrive |
|---|---|---|---|
| Parakeet TDT 0.6B v3 | transcription, horodatage des mots | 640 Mo | `npx hyperframes models install parakeet` |
| whisper.cpp large-v3-turbo | transcription, texte des mots | 1,6 Go + compilation | automatiquement, à la première transcription `hybrid` ou `whisper` |
| U²-Net human seg | détourage de la personne | 168 Mo | automatiquement, au premier détourage |
| chrome-headless-shell | capture des images au rendu | ~150 Mo | `npx hyperframes browser ensure` |

```bash
npx hyperframes models install parakeet
npx hyperframes browser ensure
```

La transcription par défaut, `hybrid`, combine les deux modèles. Elle prend **les mots de whisper**, plus fiables
sur un son de téléphone bruité, et **les horodatages de Parakeet**, plus précis. Le premier projet compile donc
whisper.cpp, d'où le besoin de git, cmake et d'un compilateur C. Cela prend quelques minutes, une seule fois.
Pour vous en passer, choisissez `engine: "parakeet"` (MCP) ou `--engine parakeet` (CLI), en sachant que Parakeet
seul perd des mots sur un son bruité.

### 4. Bruitages (facultatif)

```bash
scripts/fetch-sfx.sh
```

Le script télécharge 45 bruitages **CC0** (domaine public), de Kenney et OpenGameArt, dans `assets/sfx/` (whoosh,
pop, hit, click, glitch). Il vérifie la licence de chaque pack avant d'utiliser quoi que ce soit, puis normalise
les sons. Chaque fichier est mesuré une fois (attaque, crête, niveau) pour que le son tombe pile sur l'image. Sans
cette bibliothèque, studio synthétise ses bruitages avec FFmpeg.

### 5. Musique (facultatif)

Déposez un morceau dont vous avez les droits dans `assets/music/`. Avec `audio.music: auto` (le défaut), studio
prend le premier morceau du dossier et le baisse quand vous parlez (ducking). `audio.music: none` coupe la musique.
Le dépôt ne livre aucune musique.

### 6. Vérifier avec `doctor`

```bash
node dist/cli.js doctor
```

Exemple de sortie sur une machine prête :

```
✓ Node.js                      22.12.0
✓ ffmpeg                       ffmpeg version 6.1.1
✓ ffprobe                      ffprobe version 6.1.1
✓ Parakeet (default ASR)       parakeet-tdt-0.6b-v3 via sherpa-onnx
✓ whisper.cpp (optional ASR)   large-v3-turbo
✓ U²-Net matting weights       ~/.cache/hyperframes/background-removal
✓ Chrome (render)              chrome-headless-shell 152.0.7977.30
✓ SFX library (optional)       whoosh, pop, hit, click, glitch
✓ Emoji font (captions)        Noto Color Emoji
✓ styles                       cinematic, reel-dynamique, tech-explainer
```

Chaque ligne en ✗ est suivie d'une flèche `→` avec la commande qui répare. Lors d'une première installation,
deux ✗ sont **normaux** : `whisper.cpp` et `U²-Net` se téléchargent d'eux-mêmes au premier projet. L'agent peut
lancer la même vérification avec l'outil `studio_doctor`.

### 7. Essai sans agent (facultatif)

Pour vérifier la chaîne complète avant de brancher un agent, montez un rush court en ligne de commande :

```bash
node dist/cli.js run rushs/ma-video.mp4 --style tech-explainer --approve-cut --formats 9x16 --quality draft
```

`--approve-cut` valide le plan de coupe sans relecture et `--quality draft` accélère le rendu : c'est un essai, pas
un montage. Les exports arrivent dans `work/ma-video/07-render/`.

Vous n'avez pas de rush sous la main ? `scripts/make-fixture.sh` fabrique un rush de test à partir d'une vidéo de
personne et d'une voix de synthèse ([Piper](https://github.com/rhasspy/piper)).

## Où studio écrit

| Emplacement | Contenu | Réglage |
|---|---|---|
| `<studio>/work/<projet>/` | tout le travail d'un projet, étape par étape | variable `STUDIO_WORK_DIR` |
| `~/.cache/hyperframes/` | modèles, navigateur, polices | — |
| `<studio>/assets/sfx/`, `assets/music/` | bruitages, musique | — |
| `<studio>/recipes/` | recettes, dont celles que vous enregistrez | — |

Pour ranger les projets ailleurs, par exemple sur un disque plus grand, définissez
`STUDIO_WORK_DIR=/chemin/vers/projets` dans l'environnement de la CLI ou dans la configuration du serveur MCP.

## Mettre à jour

```bash
cd "$STUDIO"
git pull
npm install          # recompile dist/
node dist/cli.js doctor
```

Redémarrez ensuite votre client MCP pour qu'il relance le serveur. Vos projets dans `work/` restent valables : les
étapes dont le code a changé se recalculent d'elles-mêmes au prochain passage, les autres restent en cache.

## Désinstaller

```bash
rm -rf "$STUDIO"                 # le code, vos projets (work/) et vos recettes
rm -rf ~/.cache/hyperframes      # les modèles et le navigateur (partagés avec HyperFrames, si vous l'utilisez ailleurs)
```

Retirez aussi l'entrée `studio` de la configuration de votre client MCP, et le lien du skill si vous l'avez créé
(voir [chapitre 3](03-connecter-un-client.md)).

---

Précédent : [1. Découvrir](01-decouvrir.md) · Suivant : [3. Connecter un client MCP](03-connecter-un-client.md)
