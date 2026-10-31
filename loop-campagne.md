# Boucle d'une campagne

Lancement par le mainteneur, dans une session vide : `/clear`, puis
`/loop exécute loop-campagne.md sur la campagne <nom>`. Reprise après un checkpoint : la même commande, suivie de
`réponse au checkpoint NNNN : <réponse>`.

Tu es la session **pilote** : tu ne fais aucun ticket toi-même. Chaque ticket part dans un sous-agent au contexte
vide ; ta session ne grossit que d'un résumé par ticket. Un seul ticket à la fois. Les tickets, leur ordre et les tours
de critique viennent de `scripts/campaign.ts` (`AGENTS-WORKFLOW.md` décrit l'équipe et le flux) : tu lis la sortie
du script, rien d'autre de la campagne.

## À chaque tour

1. **Prends le suivant** : `npx tsx scripts/campaign.ts suivant <nom>`. Une sortie qui commence par `AUCUN` termine
   la boucle (voir « Fin »). Sinon c'est le ticket NNNN entier ; lis dans son en-tête `id`, `agent` et `checkpoint`.
2. **Vérifie l'agent** : `general-purpose`, ou un fichier `.claude/agents/<agent>.md`. Absent : arrête la boucle et
   dis quel agent manque (tickets 0032 et 0037 les créent).
3. **Ticket sans checkpoint** : lance un sous-agent du type `<agent>` avec ce prompt, en remplaçant NNNN et NOM :

   > Fais le ticket NNNN de la campagne NOM. Suis les étapes 1 à 4 de `skills/ticket/SKILL.md` : le dossier est
   > `work/campaigns/NOM/tickets/`, et tu fermes le ticket par `npx tsx scripts/campaign.ts fermer` (ou `rejeter`,
   > pour un avis bloquant), jamais en éditant le statut à la main. Ne commite rien. Réponds en trois lignes
   > exactement : livré, vérifié, reste. Si un critère « Terminé quand » ne peut pas être coché, n'invente pas :
   > laisse le ticket ouvert avec `fermer NOM NNNN --statut ouvert --reprise "…"` et commence ta réponse par
   > « BLOQUÉ ».

4. **Ticket checkpoint** (`checkpoint: mainteneur` : une gate, ou un désaccord après 2 tours de critique) :
   - Réponse déjà donnée au lancement pour ce NNNN : passe directement à l'application.
   - Sinon, un sous-agent `general-purpose` prépare la question :

     > Prépare le checkpoint NNNN de la campagne NOM (`work/campaigns/NOM/tickets/`, `skills/ticket/SKILL.md`
     > étape 3). Ne ferme pas le ticket et n'applique rien. Rends seulement la question, commençant par
     > « QUESTION » : ce que le mainteneur doit juger, les fichiers à regarder, les désaccords restants, et deux à
     > quatre réponses possibles.

     Pose-la au mainteneur par `AskUserQuestion` et attends. Sans utilisateur pour répondre (`claude -p`, ou
     `AskUserQuestion` absent) : affiche la question et la commande de reprise, puis arrête la boucle.
   - Application : un sous-agent `general-purpose` reçoit le prompt du point 3, plus
     « Le mainteneur a répondu, le JJ/MM/AAAA : « <réponse> ». Journalise la question et la réponse dans le fichier
     `sortie`, applique-la, puis ferme le ticket. »
5. **Rends compte** : passe au mainteneur le numéro, le titre et les trois lignes du sous-agent. Relance
   `suivant` : si la réponse commence par « BLOQUÉ », ou si `suivant` rend encore le même NNNN, arrête la boucle et
   dis ce qui bloque, sans relancer le ticket. Sinon, tour suivant.

## Limite de critique

Un avis bloquant passe par `rejeter` : le script annule la suite du tour, écrit la reprise par l'auteur et les trois
revues du tour suivant, et après 2 tours écrit le checkpoint « Désaccord ». Tu ne lances donc jamais une revue ou une
reprise hors de `suivant`, et tu n'écris aucun ticket.

## Fin

`AUCUN : tout est fait` : dis-le en une ligne. `AUCUN : rien de prêt` : cite les tickets en attente et ce qu'ils
attendent.
