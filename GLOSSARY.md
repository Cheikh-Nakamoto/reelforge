# Glossary

Terms of studio's domain. Decisions and their reasons live in `CLAUDE.md` (the numbered list).

## Edit

**Rush**: one source video as it came off the camera or the screen recorder.
_Avoid_: clip, source (when the file is meant), footage (that is the rush's picture inside a composition).

**Part**: one rush inside an assembly, with its own reviewed cut.

**Assembly**: several parts joined into one video.

**Review gate**: a point where the edit stops until a person approves a proposal: the cut plan, the QA contact
sheets.

**Rig**: the perspective wrapper (`.rig` > `.rigcam`) around one scene, graphic or phone, which a camera move
(`beats.camera`: orbit, crane, dolly, truck) drives. It never wraps the rush, whose camera levels stay as they are.
_Avoid_: camera (that is the rush's `.cam` stack).

**Card space**: UI cards at different depths (`cards.ts`, `beats.spaces`), with a depth-of-field blur growing with the
distance to the focus plane, and one camera path (`.spcam`) that arrives on each card in turn. Its cards are graphics
(same kinds as `beats.mographs`), not cut-outs of a recording. A space spends one of the 3 3D effects.
_Avoid_: rig (that wraps one scene, graphic or phone; a space owns its own camera).

**Browser**: the desktop-window alternative to the phone for a screen recording (`browser.ts`): tab bar, address bar, three
dots, the recording as a page that scrolls in a viewport, in perspective. Its **hover frames** (`beats.hovers`) are
rectangles in page positions (0–1) that the editor lays on an element; the page scrolls to them first. A browser spends
one of the 3 3D effects.
_Avoid_: window (ambiguous with the matte windows).

**Turn** (3D transition): the hand-over between the rush and a typography scene as two faces of one solid
(`scenes[].transition`: cube, flip; `portal` is the Z crossing). The rush turns on `.shake`, hidden while the scene is on.

**Correction round**: one pass of fixes after a QA review, ended by a new render and a new QA.

## Work

**Ticket**: one unit of work sized for one fresh agent context, with its own context, its dependencies, the
conditions that end it (« Terminé quand ») and, once closed, its result. The same notion serves studio's own
development (`.scratch/tickets/`) and the edit of a video (one project's tickets, written by studio).
_Avoid_: task, job (a job is a background computation inside the server), step (a pipeline stage).

**Checkpoint ticket**: a ticket that needs the user's answer, usually at a review gate. A loop stops on it and waits.

**Ticket loop**: the session that runs a project's tickets one after another, each in a fresh context, and does
none of them itself.
