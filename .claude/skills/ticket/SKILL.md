---
name: ticket
description: Take the next open ticket from .scratch/tickets/ and carry it to done in this session.
disable-model-invocation: true
argument-hint: "[numéro du ticket]"
---

Each ticket is worked in a fresh context: the user runs `/clear` between two tickets, so nothing from an earlier
session is available. The ticket file carries all the context it needs.

1. Read `.scratch/tickets/README.md`. Take the ticket named in the arguments, else the first one `ouvert` whose
   `dépend de` tickets are all `fait`.
2. Read that ticket, then load the skills it names before touching code.
3. Do the work. Every box under « Terminé quand » is checked, with `CLAUDE.md`'s working rules on top.
4. Close it: set `statut: fait` in the ticket and in the README, and write a « Résultat » section of two or three
   lines (what changed, what was verified, what is left). Anything left becomes a new ticket in the README, sized to
   fit one session, rather than more work now.
5. Stop. Tell the user in two lines what the ticket delivered, then: « Tape `/clear` puis `/ticket` pour le
   suivant. »

A ticket that turns out bigger than one session: stop at a clean point, write a « Reprise » section in the ticket
(done, next step, files touched), split the rest into new tickets, and hand over as in step 5.
