---
name: bs-hyperframes-code-change-launch
description: Build a 30-second film that explains a code change to people who will never read the diff. It opens by scrolling the real change too fast to follow, cuts to the summary, then fires four capability tiles and closes on the install command — delivered as a rendered MP4 plus the editable project.
---

# Code-Change Explainer Film

A short film for shipping engineering work to a non-engineering audience. It starts by
showing the actual change — scrolling past far too fast to read — admits nobody is reading
that, then does the job properly: a summary, the invocation, four fast capability tiles,
and an install command typed live. Warm paper ground, one clay accent, a dark terminal
inset. Built as HTML, CSS, SVG, and GSAP, rendered to MP4 by the HyperFrames CLI.

## Style origin

The scene order, the unreadable-scroll device, the four-tile capability run, and the
warm-paper palette structure are abstracted from a publicly published HyperFrames launch
film. The subject, copy, palette values, and every asset are authored fresh for the
caller's change. Nothing in the output states or implies affiliation with, endorsement by,
or authorization from any company the caller does not own.

## When to use

Use this for a changelog film, a release note that deserves more than a bullet list, a
pull-request walkthrough for stakeholders, or an internal "here is what shipped" clip. It
works when the change is real and substantial but the audience will not read code.

Do not use it for a tutorial, for a change too small to justify thirty seconds, or when
the audience *is* engineers who would rather read the diff — for them the diff is faster
and this film is theatre.

## Required input

- The change itself: a pull request, a commit range, a branch, or a written summary.
  The film shows real content, so it needs the real thing.
- **The summary in one sentence**, in the voice of someone explaining it at standup.
- Four capabilities or effects the change delivers, one per tile.
- The install or invocation command the film closes on.
- **The interface the film takes place in.** Either one the caller owns, or a neutral
  original. See the rights rule below.
- Brand tokens: a warm paper ground, an ink, one accent, and a dark terminal surface.

## The rights rule for the agent surface

This film is set inside a coding-agent terminal, which is exactly the kind of surface it is
tempting to copy pixel for pixel. Before Scene 1:

- If the caller owns the surface, build it from their real tokens.
- Otherwise build a **neutral original**: generic window chrome, original iconography, no
  third-party wordmark, model chip, menu structure, or signature layout. State plainly in
  the deliverable that the terminal is a representative interface.
- Never recreate a third-party agent's or IDE's UI, and never use a screen recording of
  one, without written permission. Refuse that element and offer the neutral build.
- Real repository names, usernames, avatars, and PR URLs are personal data. Use fictional
  ones unless the caller owns the repository and has said the identifiers may ship.

## Retarget to the user's change

1. **Read the change.** Pull the real diff, the real file names, the real line counts. The
   scroll beat is only convincing when the content is genuine.
2. **Fill the seven copy slots** in `references/film-blueprint.md`.
3. **Rebuild the palette** from the role table in `references/visual-system.md`. Keep the
   structure: warm paper, warm ink, one rationed accent, one dark terminal surface.
4. **Write the four tiles honestly.** Each is on screen for about two seconds, so each
   carries exactly one idea. A tile that needs a second clause is two tiles or none.
5. **Verify the closing command actually works.** It is the only instruction in the film.

`references/retarget-checklist.md` gates all of this.

## Workflow

1. **Load the HyperFrames stack.** Read `/hyperframes`, then `/hyperframes-core`,
   `/motion-doctrine`, and `/oversized-cursor`. `npx hyperframes skills update pr-to-video`
   installs the upstream workflow this composes on top of.
2. **Run the retarget gate**, including the agent-surface rights rule.
3. **Write `STORYBOARD.md`** from the scene table in `references/film-blueprint.md`. Ten
   scenes in thirty seconds means the copy has to be final before any HTML is written.
4. **Write `ledger.json`.** The current is LEFT. Reserve Z-forward for the punch card,
   upward for the outro.
5. **Build the design system first**: paper, ink, accent, terminal surface, the window
   chrome, the diff row, the tile.
6. **Build the scroll beat first and time it alone.** Everything downstream depends on the
   scroll being genuinely too fast; if it is readable, the film has no premise.
7. **Build the rest in order, checking each.** `npx hyperframes lint` after the first HTML
   pass; `npx hyperframes check` before moving on.
8. **Assemble the master timeline**: ten scene hosts, the music bed, and the interaction
   SFX. Every `<audio>` needs an `id`. Give the root the paper colour so inter-scene gaps
   read as the film's ground, not as black.
9. **Verify.** `npx hyperframes check` at zero findings, then
   `npx hyperframes snapshot --at <scene midpoints>` and look at every frame.
10. **Preview, then render.** `npx hyperframes preview --background`, wait for approval,
    then `npx hyperframes render --quality high --fps 30`. Probe with `ffprobe`.

## The ten scenes

Copy slots, durations, and per-scene motion routes are in
`references/film-blueprint.md`. The shape:

| # | Scene | Beat | Runtime |
| --- | --- | --- | --- |
| 1 | `opener` | A teammate's request types into the composer, with the change's link as a chip | ~5.2s |
| 2 | `scroll` | The real change scrolls past, far too fast to read | ~3.2s |
| 3 | `punch` | One card, one line, held. The shortest scene in the film | ~0.9s |
| 4 | `summary` | The agent condenses it into the one sentence that matters | ~3.0s |
| 5 | `invoke` | The invocation runs; the terminal answers | ~3.8s |
| 6–9 | `tile-1..4` | Four capability tiles, one idea each, no dwell | ~2.0–2.6s each |
| 10 | `outro` | The install command types into the composer and lands | ~4.4s |

Scene 3 is 0.9 seconds and it is the hinge of the whole film. It is long enough to read one
short line and nothing else. Extending it kills the joke; cutting it removes the film's
only moment of self-awareness.

## The unreadable scroll

The device this film is built on, and the one worth getting right.

- The content must be **real**: actual file paths, actual added and removed lines, actual
  line counts from the caller's change.
- It scrolls at roughly 900–1200 px/second. Fast enough that the eye catches shape and
  colour — green additions, red deletions, file headers — and nothing else.
- Ease is linear. Any acceleration makes it read as a designed effect rather than as
  someone scrolling.
- Do not blur it. A blur says "you are not meant to read this"; the point is that you
  *could* have, and would not.
- Land the cut into Scene 3 mid-scroll, never at rest.

## Commands

```bash
npx hyperframes init launch-film
npx hyperframes skills update pr-to-video
npx hyperframes catalog --query "long content scrolling past at speed"
npx hyperframes check
npx hyperframes snapshot --at 2.4,6.8,8.8,10.8,14.2,17.3,19.7,22.0,24.3,27.8
npx hyperframes preview --background
npx hyperframes render --quality high --fps 30 --output renders/launch.mp4
ffprobe -v error -show_streams renders/launch.mp4
```

The CLI needs Node.js 22 or newer and FFmpeg. No generation-model credential is used
anywhere in this workflow.

## Output contract

- One MP4 at 1920x1080, 30fps, 26–34s, H.264 + AAC, with a music bed and interaction SFX.
- A HyperFrames project: `index.html`, one composition per scene, `STORYBOARD.md`,
  `ledger.json`, and the design-system stylesheet.
- A handoff note listing every copy slot, the palette, the scroll speed actually used, and
  whether the terminal is the caller's own surface or a neutral original.
- `npx hyperframes check` at zero findings, pasted into the handoff.

## Failure rules

- If the caller cannot supply the real change, stop. A film whose premise is "here is the
  actual diff" cannot open on a fabricated one.
- If the scroll is readable at the chosen speed, it is too slow. Re-time it rather than
  shortening the scene.
- If a tile needs two clauses to make sense, it is two tiles or none. Do not shrink the
  type to fit.
- If the closing command does not actually work, stop. It is the only instruction in the
  film and the only thing a viewer will try.
- If the caller cannot confirm rights to the agent surface, build the neutral original. Do
  not proceed with a recreated third-party UI on a verbal assurance.
- If a real username, avatar, repository, or PR URL would ship, replace it with a fictional
  one unless the caller owns it and has said it may appear.
- Never call an image, video, or avatar generation model. Every frame is HTML, CSS, SVG,
  GSAP, or material the caller supplied.
