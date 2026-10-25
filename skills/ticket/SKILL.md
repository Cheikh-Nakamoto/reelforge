---
name: ticket
description: Carry one ticket of a tickets folder (a README table plus one NNNN-slug.md per ticket) to done in a fresh session.
---

# ticket

A tickets folder splits work too long for one session: a `README.md` table (`# | Ticket | Statut | Dépend de`) and one
`NNNN-slug.md` per ticket, whose front matter carries `statut` (`ouvert` or `fait`), `dépend de` and, on a review gate,
`checkpoint`. Each ticket runs in a fresh context and carries all its own context: nothing from an earlier session is
available, so read the ticket, not your memory. The caller says how the folder is reached (its files, or studio's
tools).

1. **Take the ticket.** The one named, else the first `ouvert` whose `dépend de` tickets are all `fait`.
2. **Read it whole**, then load the skills its « Skills » section names before touching anything.
3. **Do the work** until every box under « Terminé quand » is checked, with the project's rules on top (its
   `CLAUDE.md`; for a studio project, the `studio` skill). A `checkpoint` ticket needs the user's answer: ask and wait
   when you can talk to the user; as a subagent, prepare the question (what the user must judge, and where to look)
   and hand it back as your answer, leaving the ticket `ouvert`.
4. **Close it**: `statut: fait` in the ticket and in the table, and a « Résultat » section of two or three lines (what
   changed, what was verified, what is left). Anything left becomes a new ticket, sized to fit one session, rather
   than more work now.

A ticket that turns out bigger than one session: stop at a clean point, leave it `ouvert` with a « Reprise » section
(done, next step, files touched), and split the rest into new tickets.
