# Documentation de studio

Bienvenue. **studio** monte vos vidéos face caméra **sur votre machine**. Vous lui donnez un rush brut, il coupe
les silences et les prises ratées, ajoute des sous-titres animés, glisse des mots derrière vous, place des
animations au bon moment et mixe le son. Il exporte le résultat en 16:9 et en 9:16.

Un agent IA pilote studio : Claude Code, Codex, Antigravity, Cursor, ou tout autre client qui parle **MCP**.
L'agent tient le rôle du monteur. Il relit les propositions de studio, les corrige, regarde le rendu et reprend ce
qui ne va pas. Aucun service cloud, aucune API payante : tout tourne en local.

```
 votre rush ──▶ studio propose ──▶ l'agent relit et corrige ──▶ studio rend ──▶ l'agent vérifie ──▶ vidéo finale
                (plan de coupe,     (avec vous aux deux          (HyperFrames,    (planches contact,
                 motion design)      portes de revue)             FFmpeg)          loudness)
```

## Par où commencer ?

| Vous voulez… | Lisez |
|---|---|
| comprendre ce que fait studio et comment | [1. Découvrir studio](01-decouvrir.md) |
| l'installer sur votre machine | [2. Installer](02-installer.md) |
| le brancher sur votre agent (Claude Code, Codex, Antigravity, Cursor, VS Code…) | [3. Connecter un client MCP](03-connecter-un-client.md) |
| monter votre première vidéo, pas à pas | [4. Premier montage](04-premier-montage.md) |

Comptez une demi-heure pour installer studio et le connecter à votre agent. Il faut ensuite 15 à 20 minutes de
calcul pour un premier rush de 30 secondes.

## Le guide complet

1. [Découvrir studio](01-decouvrir.md) : ce que fait studio, ce qu'il ne fait pas, le vocabulaire, le partage du
   travail entre studio et l'agent.
2. [Installer](02-installer.md) : prérequis par système, installation, modèles, sons, vérification avec `doctor`,
   mise à jour, désinstallation.
3. [Connecter un client MCP](03-connecter-un-client.md) : la configuration exacte pour chaque client et
   l'installation du skill qui apprend à l'agent à monter.
4. [Premier montage](04-premier-montage.md) : une session complète, de la demande à l'export, avec ce que vous
   verrez à chaque étape.
5. [Le pipeline, étape par étape](05-le-pipeline.md) : ce que fait chacune des huit étapes, ce qu'elle produit,
   combien de temps elle prend, ce qui peut mal tourner.
6. [Styles, recettes et références](06-styles-recettes-references.md) : choisir un rendu, le personnaliser, garder
   un montage réussi, imiter une vidéo que vous aimez.
7. [Assembler plusieurs rushs](07-assembler-plusieurs-rushs.md) : intro, enregistrement d'écran, explication en
   bulle, transitions.
8. [Longs montages : les tickets](08-longs-montages-tickets.md) : découper un gros montage en sessions courtes pour
   que l'agent ne sature pas.
9. [Le tableau de bord](09-tableau-de-bord.md) : suivre chaque étape, le rendu sur une timeline et le journal de
   l'agent.
10. [Dépannage et FAQ](10-depannage-faq.md) : les erreurs fréquentes et leurs solutions, les questions de licence.

## Référence

- [Outils et prompts MCP](reference/outils-mcp.md) : chaque outil `studio_*`, ses paramètres et ce qu'il renvoie.
- [Ligne de commande](reference/cli.md) : chaque commande `studio` et ses options.
- [Clés de style](reference/style.md) : toutes les clés d'un fichier `styles/*.yaml`, avec leurs valeurs par
  défaut.
- [Fichiers d'un projet](reference/fichiers.md) : l'arborescence `work/<projet>/`, les formats `cutplan`,
  `beats.json`, `receipt.json`.

## Contribuer

- [Architecture](architecture.md) : les modules, les flux de données, les tests, où ajouter quoi.
- [CONTRIBUTING.md](../CONTRIBUTING.md) : avant d'ouvrir une pull request, et la licence des contributions.
- [CLAUDE.md](../CLAUDE.md) : les décisions d'architecture numérotées et leurs raisons (le journal des décisions du
  projet).
- [GLOSSARY.md](../GLOSSARY.md) : les termes du domaine.

## Licence en une phrase

studio est sous **[PolyForm Noncommercial 1.0.0](../LICENSE)** : il est libre pour un usage personnel, éducatif,
associatif ou de recherche. Un usage commercial (un client, un employeur, une chaîne monétisée) demande une licence
de l'auteur, voir [COMMERCIAL.md](../COMMERCIAL.md).
