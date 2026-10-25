# 9. Le tableau de bord

> **Dans ce chapitre** : la page locale qui montre tout ce que studio et l'agent ont fait, projet par projet.

## L'ouvrir

| Avec un agent | En ligne de commande |
|---|---|
| l'agent appelle `studio_dashboard` en début de session et vous donne l'adresse | `node dist/cli.js serve` (option `--port`, 4600 par défaut) |

Puis ouvrez `http://127.0.0.1:4600`. Le serveur n'écoute que sur votre machine (127.0.0.1), en **lecture seule** : il
ne modifie rien et n'est pas joignable depuis le réseau.

## Ce qu'il montre

À gauche, la liste des projets. Pour chacun, l'en-tête montre les huit étapes, avec leur état et leur durée. En
dessous, sept onglets :

| Onglet | Contenu |
|---|---|
| **Montage** | le rendu, avec une **timeline multipiste** synchronisée : parties, coupes, cadres réduits, scènes, mots derrière, graphiques, effets, bruitages, sous-titres. Un clic sur un élément place la lecture à cet instant. |
| **Plan de coupe** | chaque mot retiré, avec la raison de son retrait |
| **Motion design** | le contenu de `beats.json`, lisible |
| **Journal de Claude** | chaque outil MCP appelé par l'agent, avec ses arguments, chaque étape du pipeline, chaque commande CLI, chaque erreur |
| **Tickets** | l'avancement des tickets (faits / total) et leur texte |
| **QA** | les planches contact, le volume, les avertissements |
| **Technique** | les versions, les modèles, les résultats de `lint` et `check`, le reçu de rendu |

## Le journal

Chaque appel d'outil MCP (sauf les interrogations répétées comme `studio_status`), chaque commande CLI et chaque
ligne de journal du pipeline sont ajoutés à `work/<projet>/events.jsonl`, une ligne JSON par événement :

```json
{"t":"2026-10-25T09:38:32.503Z","kind":"tool","source":"mcp","tool":"studio_cut_review","args":{"project":"budget","remove":["w9"]},"message":"studio_cut_review"}
{"t":"2026-10-25T09:45:21.994Z","kind":"tool","source":"cli","tool":"studio step","args":["budget","qa","--formats","9x16"],"message":"studio step budget qa --formats 9x16"}
{"t":"2026-10-25T09:45:22.049Z","kind":"log","source":"cli","message":"render 9x16…"}
```

Vous voyez ainsi **ce que l'agent a décidé, et quand** : quels mots il a retirés, quels beats il a renvoyés, quelle
étape il a relancée. C'est aussi le premier endroit à regarder quand quelque chose a mal tourné.

## Pour les curieux

La page est un fichier statique, `templates/dashboard.html`, servie par `src/dashboard.ts` sans aucune dépendance.
Les chemins sont vérifiés (rien hors de `work/`) et les vidéos sont servies par plages HTTP, ce qui permet de se
déplacer dans la lecture.

---

Précédent : [8. Longs montages : les tickets](08-longs-montages-tickets.md) · Suivant : [10. Dépannage et FAQ](10-depannage-faq.md)
