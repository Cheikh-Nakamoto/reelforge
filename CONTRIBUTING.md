# Contributing to studio

Thanks for helping. Bug reports with a short rush that reproduces the problem, new styles, better heuristics
and support for more languages are all welcome.

## Before you open a pull request

```bash
npm install
npm run typecheck
npm test
```

If you touched `src/steps/html.ts`, `matte.ts`, `audio.ts` or `render.ts`, also render a short clip
(`scripts/make-fixture.sh <video-of-a-person.mp4>` builds one) and look at the contact sheet in
`work/<project>/08-qa/` and at a full-resolution frame of each behind-word. Mention what you checked in the PR.
`npm run e2e -- rushs/test-synth.mp4` drives the whole pipeline through the MCP server, as an agent would.

Read `CLAUDE.md` for the architecture decisions; it applies to humans too. In short:

- every step has a deterministic default and writes an artifact an agent or a person can edit; no model calls for
  editorial decisions;
- pure logic (`cutplan.ts`, `beats.ts`, `html.ts`) gets unit tests;
- editing steps (cut, compose, audio, render) re-run when their code changes; bump the `version` of ingest,
  transcribe or matte by hand when their output changes;
- new dependencies and models must allow noncommercial redistribution, and go into `THIRD_PARTY.md`
  (no GPL code linked in-process, no non-commercial or share-alike weights).

## Styles

A style is one YAML file in `styles/`, validated by `src/lib/style.ts`. Run `npm run schema` after changing the
schema. A style PR includes a contact sheet of a test render in both formats.

## Licence of contributions

studio is distributed under the [PolyForm Noncommercial License 1.0.0](LICENSE), and its author also offers
separate commercial licences ([COMMERCIAL.md](COMMERCIAL.md)). For that to stay possible, contributions need
two permissions:

By submitting a contribution (code, documentation, styles, assets) you certify that you wrote it or have the right
to submit it, and you agree that:

1. it is licensed to everyone under the PolyForm Noncommercial License 1.0.0, like the rest of the project; and
2. you grant the project author, cheikh-nakamoto, a perpetual, worldwide, non-exclusive, royalty-free,
   irrevocable licence to use, modify, distribute and sublicense it, including under commercial terms.

You keep the copyright of your contribution. Sign off your commits to record this agreement
(`git commit -s`, which adds `Signed-off-by: Your Name <you@example.com>`).

If you cannot agree to point 2, open an issue before writing code so we can discuss it.

*This is not legal advice; the author may ask for a formal contributor agreement for large contributions.*

## Reporting problems

Open an issue with: the command or MCP tool you ran, `node dist/cli.js doctor` output, the style, and if possible
`work/<project>/08-qa/qa.json` and the contact sheet. Do not attach footage you do not have the rights to share.
