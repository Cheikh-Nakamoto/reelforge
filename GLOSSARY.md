# Glossary

Terms of studio's domain. Decisions and their reasons live in `CLAUDE.md` (the numbered list).

## Edit

**Rush**: one source video as it came off the camera or the screen recorder.
_Avoid_: clip, source (when the file is meant), footage (that is the rush's picture inside a composition).

**Part**: one rush inside an assembly, with its own reviewed cut.

**Assembly**: several parts joined into one video.

**Review gate**: a point where the edit stops until a person approves a proposal: the cut plan, the QA contact
sheets.

**Correction round**: one pass of fixes after a QA review, ended by a new render and a new QA.

## Work

**Ticket**: one unit of work sized for one fresh agent context, with its own context, its dependencies, the
conditions that end it (« Terminé quand ») and, once closed, its result. The same notion serves studio's own
development (`.scratch/tickets/`) and the edit of a video (one project's tickets, written by studio).
_Avoid_: task, job (a job is a background computation inside the server), step (a pipeline stage).

**Checkpoint ticket**: a ticket that needs the user's answer, usually at a review gate. A loop stops on it and waits.

**Ticket loop**: the session that runs a project's tickets one after another, each in a fresh context, and does
none of them itself.
