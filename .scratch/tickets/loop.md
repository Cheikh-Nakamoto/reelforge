# Boucle des tickets

Lancement par le mainteneur, dans une session vide : `/clear`, puis `/loop exécute .scratch/tickets/loop.md`.

Tu es la session qui pilote la boucle : tu ne fais aucun ticket toi-même. Chaque ticket part dans un sous-agent qui
démarre avec un contexte vide (l'équivalent d'un `/clear`), donc ta session ne grossit que d'un résumé par ticket et
reste loin des 140 k tokens. Un seul ticket à la fois : les rendus occupent tout le CPU.

## À chaque tour

1. Lis `.scratch/tickets/README.md` (rien d'autre). Les candidats : statut `ouvert`, et tous leurs tickets
   `dépend de` sont `fait`.
2. Écarte les candidats dont le ticket porte `checkpoint: mainteneur` dans son en-tête : un sous-agent ne peut pas
   poser de questions. Prends le premier qui reste, dans l'ordre du tableau.
3. Lance un sous-agent (type `general-purpose`) avec ce prompt, en remplaçant NNNN :

   > Fais le ticket NNNN du dépôt reelforge. Lis `.claude/skills/ticket/SKILL.md` et suis ses étapes 1 à 4 pour ce
   > ticket (le ticket et le README sont dans `.scratch/tickets/`). Tout reste local ; ne commite rien. À la place
   > de l'étape 5, réponds en trois lignes exactement : livré, vérifié, reste (avec les nouveaux tickets créés).
   > Si un critère « Terminé quand » ne peut pas être coché, n'invente pas : laisse le ticket `ouvert`, écris une
   > section « Reprise » dans le ticket, et commence ta réponse par « BLOQUÉ ».

4. À son retour, relis la ligne du ticket dans le README et passe à l'utilisateur ses trois lignes, précédées du
   numéro et du titre du ticket.
   - Le ticket est `fait` : enchaîne directement sur le tour suivant.
   - La réponse commence par « BLOQUÉ », ou le ticket n'est pas `fait` : arrête la boucle et explique ce qui bloque.
     Ne relance pas le même ticket.

## Fin de la boucle

Quand il ne reste plus de candidat, arrête la boucle et dis à l'utilisateur, en une ou deux lignes :

- s'il reste des tickets `checkpoint: mainteneur` prêts : lesquels, et que c'est à lui de les faire avec
  `/ticket NNNN` (ils demandent ses réponses), puis de relancer la boucle ;
- sinon, s'il reste des tickets bloqués par leurs dépendances : lesquels et pourquoi ;
- sinon, que tous les tickets sont faits.
