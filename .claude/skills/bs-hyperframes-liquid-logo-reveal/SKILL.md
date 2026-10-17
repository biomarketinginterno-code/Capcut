---
name: bs-hyperframes-liquid-logo-reveal
description: Build a short logo-reveal sting where the mark rides inside a bead of liquid, refracted past the point of legibility, until the bead ruptures and leaves the lockup crisp on the frame. Delivered as a rendered MP4 plus the editable project, with no 3D asset and no generation model involved.
---

# Liquid-Rupture Logo Reveal

A six-to-eight second sting. A bead of liquid gathers out of a scatter of smaller ones,
carrying something inside it that is clearly a shape and clearly not readable. It drifts,
it holds, and then it ruptures — the bead collapses in a fifth of a second, the satellites
are thrown outward, and what is left standing is the lockup, crisp, for the first time.

Built as HTML, CSS, SVG filters and GSAP. No 3D scene, no environment map, no model.

## Style origin

The carried-then-ruptured device, the satellite scatter, and the rule that the mark resolves
only after the rupture are abstracted from a publicly published HyperFrames logo-reveal
project. The subject, palette, geometry, timing, and every asset are authored fresh for the
caller's brand. Nothing in the output states or implies affiliation with, endorsement by, or
authorization from any company the caller does not own.

## When to use

Use it as an outro on a longer film, a standalone brand sting, a loop for a screen, or the
last four seconds of an ad. It is a **reveal**, so it wants to be the last thing, not the
first.

Do not use it to introduce a product, explain anything, or carry a message. There is no copy
in it before the rupture and there should not be.

## The three rules this film lives by

**One. The mark is not readable before the rupture.** It is present — a silhouette moving
under the surface, obviously *something* — and it cannot be resolved. If a viewer can read
it early, the rupture has nothing left to deliver and the film becomes six seconds of
waiting.

**Two. The rupture is fast and its consequences are slow.** The bead collapses in about a
fifth of a second. The satellites take four times that to travel. A rupture that takes as
long as its aftermath reads as a dissolve.

**Three. Nothing is liquid after the rupture.** The lockup does not wobble, shimmer, breathe,
or get a second bead. The whole film exists to make one crisp frame land, and anything still
moving in it argues with that.

## Required input

- **The mark**, as a real vector file, and the **wordmark** if there is one. Both are the
  caller's own — see the rights rule.
- **Four colours**: a ground, and three field colours for the abstract wash behind the
  liquid. The liquid itself is near-white and is not a brand colour.
- The canvas, and whether the film is an outro on something longer or standalone.
- Optionally a music bed and a rupture sound, under whatever licence the caller holds.

## The rights rule

This film's entire subject is a mark, which makes it the highest-exposure structure in this
family for exactly one thing: it must be the caller's own.

- The mark and wordmark are files the caller owns or holds written permission to use.
- No third-party mark is placed inside the liquid, including as a "before" state, a partner
  lockup, or a comparison.
- The abstract fields behind the liquid are colour, not imagery. No captured photography,
  no environment map lifted from somewhere else, no screenshot.
- If the caller cannot supply a real mark file, stop. A drawn-from-description mark is wrong
  in ways that are invisible to whoever describes it and obvious to everyone who knows the
  brand.

## Retarget to the user's brand

1. **Measure the mark's real path bounding box** before placing it. Supplied art is
   frequently not centred in its own viewBox, and a guessed viewBox clips glyphs silently.
2. **Set the ground and the three field colours.** The fields are abstract and slow; they are
   not a gradient background and not a pattern.
3. **Size the bead to the mark**, not the other way round. The bead is large enough that the
   mark inside it is unmistakably a shape and small enough that the frame is mostly ground.
4. **Choose the rupture frame** and build outward from it. Everything before is approach and
   everything after is consequence.
5. **Check legibility at the rupture frame minus one.** If the mark is readable there, raise
   the distortion.

`references/retarget-checklist.md` gates all of this.

## Workflow

1. **Load the HyperFrames stack.** Read `/hyperframes`, then `/hyperframes-core`,
   `/motion-doctrine`, and `/cut-the-curve`.
2. **Run the retarget gate**, including the rights position on the mark.
3. **Place the rupture first**, as a frame number, and write the beat plan around it.
4. **Build the liquid.** `references/liquid-craft.md` has the filter stack: how the beads
   merge, how the carried mark is distorted, and why every one of these is seeded.
5. **Build the rupture and the scatter.** Satellite trajectories are stamped, not random.
6. **Build the lockup** as the crispest thing in the film.
7. **Verify legibility**: snapshot the frame before the rupture and confirm the mark cannot
   be read; snapshot the frame after and confirm it can.
8. **Verify.** `npx hyperframes check` at zero findings, then snapshot every beat.
9. **Preview, then render.** `npx hyperframes render --quality high --fps 30`, then `ffprobe`.

## The beat plan

Durations are the reference cut at 30fps. `references/beat-plan.md` has the full table.

| Beat | What happens | Roughly |
| --- | --- | --- |
| 1 | The satellites gather and the bead forms | ~1.0s |
| 2 | The bead drifts, carrying the mark | ~2.0s |
| 3 | The hold — the one still moment before the event | ~0.4s |
| 4 | **The rupture** | ~0.2s |
| 5 | The scatter, and the lockup lands | ~1.0s |
| 6 | The lockup holds, alone | ~2.4s |

Beat 3 is the shortest and the most important. A rupture that arrives while the bead is
still travelling reads as an accident rather than an event.

## Commands

```bash
npx hyperframes init reveal
npx hyperframes lint
npx hyperframes check
npx hyperframes snapshot --at 0.6,1.8,3.2,3.53,3.7,4.4,6.4
npx hyperframes preview --background
npx hyperframes render --quality high --fps 30 --output renders/reveal.mp4
ffprobe -v error -show_streams renders/reveal.mp4 | grep codec_type
```

The CLI needs Node.js 22 or newer and FFmpeg. No generation-model credential is used
anywhere in this workflow, and no 3D runtime is involved.

## Output contract

- One MP4 at 1920x1080 (or the caller's canvas), 30fps, 6–8s, H.264 + AAC.
- A HyperFrames project: `index.html`, the filter definitions, the stamped satellite table,
  and `meta.json`.
- A handoff note listing the mark's provenance and rights position, the four colours, the
  rupture frame, and the legibility check at rupture-minus-one.
- `npx hyperframes check` at zero findings, pasted into the handoff.

## Failure rules

- If the mark can be read before the rupture, raise the distortion. This is the film's only
  real requirement and it is the one most often lost while tuning the liquid to look good.
- If anything is still moving two seconds after the rupture, remove it.
- If the film has copy in it before the rupture — a tagline, a URL, a label, a caption —
  remove it. The bead is the only subject.
- If any part of the liquid uses an unseeded random source, seed it. A turbulence without a
  seed and a scatter from `Math.random` both re-roll per worker, and the render will not
  match the preview.
- If the caller cannot supply a real mark file, stop and ask for one.
- Never call an image, video, or avatar generation model, and do not add a 3D runtime. Every
  frame is HTML, CSS, SVG, and GSAP.
