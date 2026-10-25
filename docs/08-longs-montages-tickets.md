# 8. Longs montages : les tickets

> **Dans ce chapitre** : pourquoi une seule session d'agent ne suffit pas pour un gros montage, comment studio le
> découpe en **tickets**, et les trois façons de les exécuter.

## Le problème

Chaque planche contact, chaque plan de coupe et chaque `beats.json` relu remplit le contexte de l'agent. Un
montage complet (relecture de la coupe, beats, rendu, QA, tours de correction, second format) dépasse environ
**140 000 tokens** sur une session. C'est arrivé sur un vrai projet. Au-delà, l'agent oublie le début, résume mal,
ou s'arrête.

## La solution : un ticket par session neuve

studio découpe le travail d'un projet en tickets, chacun calibré pour une session d'agent **au contexte neuf** et
porteur de tout son contexte. Le découpage par défaut, déterministe :

| Ticket | Contenu | Porte de revue |
|---|---|---|
| un par partie (assemblage) | revue du plan de coupe de la partie | oui |
| revue du plan de coupe | relire, corriger, appliquer | oui |
| motion design | proposer et relire les beats | — |
| rendu et QA du premier format | produire, regarder les planches | oui |
| rendu et QA de chaque autre format | idem | — |
| tours de correction | écrits après une QA qui laisse des avertissements | — |

Les tickets sont écrits à la création du projet (ou de l'assemblage) et réécrits après chaque QA, dans
`work/<projet>/tickets/` :

```
work/mon-projet/tickets/
  README.md          tableau des tickets (généré, ne pas éditer)
  plan.json
  0001-cut.md
  0002-beats.md
  0003-produce.md
  0004-format-16x9.md
```

Un ticket ressemble à ceci :

```markdown
---
id: 0002
statut: ouvert
dépend de: 0001
---

# Motion design : revue des beats

## Contexte
Projet `mon-projet`, style `reel-dynamique`. Formats : 9x16, 16x9.
Cette session ne connaît rien des précédentes : `skills/studio/SKILL.md` décrit les outils…

## Terminé quand
- [ ] `studio_beats { project: "mon-projet", action: "propose" }` a fini.
- [ ] Beats revus selon l'étape 5 : mots derrière rares, graphismes et effets justifiés…
- [ ] `studio_beats { action: "set", beats }` a accepté l'objet corrigé.
```

Un ticket marqué **checkpoint** est une porte de revue : il attend votre réponse.

## Quand passer aux tickets

- le montage est un **assemblage** ;
- il y a **plus d'un format** ;
- vous le demandez, ou l'agent sent que sa session s'allonge.

## Relire le découpage

Avant de lancer, l'agent (ou vous) peut ajuster le découpage :

- `studio_tickets { project, action: "show" }` : le tableau et le texte de chaque ticket ;
- `studio_tickets { project, action: "set", tickets: [...] }` : remplace tous les tickets ouverts. Vous pouvez
  fusionner deux tickets trop petits, ou ajouter un checkpoint là où vous voulez juger ;
- `studio_tickets { project, action: "propose" }` : revient au découpage par défaut, en gardant les tickets faits.

## Trois façons d'exécuter les tickets

### 1. Une session pilote avec des sous-agents (recommandé)

Pour les clients qui lancent des sous-agents, comme Claude Code :

```
/mcp__studio__tickets mon-projet
```

La session devient **pilote**. Elle ne fait aucun ticket elle-même et ne lit ni planche ni plan de coupe. À chaque
tour :

1. `studio_ticket_next` donne le prochain ticket prêt (ouvert, dépendances faites) ;
2. un **sous-agent neuf** l'exécute (prompt `ticket`) et ne rend que trois lignes : livré, vérifié, reste ;
3. sur un checkpoint, un premier sous-agent prépare la question, le pilote **vous la pose** et attend, puis un
   second sous-agent applique votre réponse.

La session pilote ne grandit que de trois lignes par ticket. Un seul ticket tourne à la fois, car un rendu prend
tout le processeur.

### 2. Le script sans tête : une session `claude -p` par ticket

Quand votre client ne lance pas de sous-agents, ou quand même les résumés du pilote deviendraient trop longs
(beaucoup de parties, beaucoup de tours), lancez depuis un terminal, dans le dossier studio :

```bash
scripts/ticket-loop.sh mon-projet
```

Chaque ticket part dans une session `claude -p` neuve. Une question de checkpoint s'affiche dans le terminal : une
réponse vide, ou Ctrl-D, arrête la boucle et laisse le ticket ouvert. La boucle s'arrête aussi sur un ticket resté
ouvert. Pour passer des options à chaque session :

```bash
TICKET_LOOP_CLAUDE_ARGS="--model sonnet" scripts/ticket-loop.sh mon-projet
```

Le script utilise la CLI Claude Code. Avec un autre client en ligne de commande, la même boucle s'écrit avec son
mode non interactif, par exemple `codex exec`, en lui passant le texte du prompt `ticket`.

### 3. À la main, ticket par ticket

Dans n'importe quel client : videz le contexte (`/clear` ou une nouvelle conversation), puis demandez le prompt
`ticket` avec le nom du projet (Claude Code : `/mcp__studio__ticket mon-projet`). Recommencez pour chaque ticket.

## En ligne de commande

```bash
node dist/cli.js tickets mon-projet                       # le tableau
node dist/cli.js tickets mon-projet --next                # le prochain ticket, en entier
node dist/cli.js tickets mon-projet --close 0002 --result "Beats relus : 2 effets retirés, compteur corrigé."
node dist/cli.js tickets mon-projet --close 0003 --status ouvert --reprise "Rendu 9x16 fait, QA à relire."
node dist/cli.js tickets mon-projet --propose             # revenir au découpage par défaut
```

Chaque fermeture est journalisée et apparaît dans le [tableau de bord](09-tableau-de-bord.md).

## Et si je fais `/clear` pendant qu'un ticket tourne ?

Un `/clear` vide la conversation affichée, mais il n'arrête pas forcément un calcul déjà lancé : un rendu en cours
peut continuer jusqu'au bout. Avant de relancer un ticket, regardez où en est le projet avec `studio_status`, ou
dans le tableau de bord, pour ne pas lancer deux calculs sur le même `work/<projet>/`.

---

Précédent : [7. Assembler plusieurs rushs](07-assembler-plusieurs-rushs.md) · Suivant : [9. Le tableau de bord](09-tableau-de-bord.md)
