---
name: bs-hyperframes-device-canvas-launch
description: Build a launch film that puts your product's real screen on a device in a dark studio, scrolls it, zooms into the interface for one action, and resolves to the lockup through a colour-split reveal. Delivered as a rendered MP4 plus the editable project, with no 3D model and no generation model involved.
---

# Device-Canvas Product Launch

A sixteen-to-twenty second launch film. A device rises into a dark studio carrying your
product's real screen. The page scrolls under an oversized cursor. Then the frame stops
being about the device and goes **inside** the interface for one action — a line typed, a
button pressed, an answer — before a claim, a colour split, and the lockup.

The device is a neutral original built from CSS perspective, not a 3D model. Everything is
HTML, CSS, SVG and GSAP.

## Style origin

The device-in-a-studio staging, the scroll-then-zoom-into-the-interface structure, the
single-action beat, and the colour-split reveal are abstracted from a publicly published
HyperFrames project. The subject, copy, palette, device, interface and every asset are
authored fresh for the caller's product. Nothing in the output states or implies affiliation
with, endorsement by, or authorization from any company the caller does not own.

## When to use

Use it when the product **has a screen worth showing** and the launch's job is to prove it
exists and works. The film is a demonstration, and its whole argument is that the interface
in it is real.

Do not use it for a product with no interface, or when the screen would have to be a mockup.
A mockup on a device in a studio is a very expensive way to show nothing.

## The three rules this film lives by

**One. The screen is real.** It is a capture of the caller's own product — the actual page,
the actual app, at the actual proportions. A drawn approximation is the one thing this
structure cannot survive, because the whole point of putting it on a device is to say it
exists.

**Two. The device is neutral.** It is a slab: rounded corners, a bezel, a screen. It is not a
recognisable phone from a recognisable manufacturer, and it does not carry anyone's mark.
Nobody watching a launch film needs to know which handset it is, and the moment they can
tell, a second brand is in the frame.

**Three. One action, inside the interface.** The film goes into the screen exactly once and
does exactly one thing there. Two actions turn a launch film into a tutorial, and a tutorial
has a different length, a different pace, and a different audience.

## Required input

- **The screen**: a real capture of the product, tall enough to scroll — a full-page image, a
  screen recording, or a real rebuild of the interface the caller owns.
- **The one action**, and what the product actually answers with.
- **The claim**: one line, after the action.
- **The CTA**: two lines at most.
- **The lockup.**
- **Two colours**: the studio ground and the product accent.

## The rights rule

- The screen is the caller's own product. Never a third party's site, app, dashboard, or
  interface — not as a "for example", not blurred, not partially.
- The device is a neutral original, or hardware the caller manufactures. Recreating a
  specific manufacturer's product, including its silhouette, button placement, camera
  arrangement or screen cutout, needs that manufacturer's permission.
- The cursor is a drawn original. `references/studio-craft.md` explains why an oversized
  cursor replaces the photographed hand this staging traditionally uses — it is better
  motion and it removes a likeness question entirely.
- Anything the interface shows — names, avatars, balances, messages, addresses — is fictional
  or the caller's own, and contains no real customer data.

## Retarget to the user's product

1. **Capture the screen for real**, at the device's aspect ratio, tall enough that the scroll
   has somewhere to go. `references/studio-craft.md` covers the capture and the strip.
2. **Choose the one action.** The most convincing one, not the most complete one.
3. **Set the two colours.** A dark studio and one accent. The accent belongs to the product,
   and it appears in the interface and in the reveal, nowhere else.
4. **Scrub the interface** for real names, real data, and third-party marks before it goes on
   a device.
5. **Fill the copy slots** in `references/beat-sheet.md`.

`references/retarget-checklist.md` gates all of this.

## Workflow

1. **Load the HyperFrames stack.** Read `/hyperframes`, then `/hyperframes-core`,
   `/motion-doctrine`, `/oversized-cursor`, and `/cut-the-curve`.
2. **Run the retarget gate**, including the screen's provenance and the data scrub.
3. **Build the device first** and get its perspective right before anything animates.
   `references/studio-craft.md` has the transform stack.
4. **Build the scroll**, then the zoom **into** the interface — the zoom is a change of
   subject, not a camera move, and it is the film's hardest seam.
5. **Build the action**, the claim, and the reveal.
6. **Verify the screen** at the frame where it is largest: a capture that survives a device
   at 40% can fall apart at 100%.
7. **Verify.** `npx hyperframes check` at zero findings, then snapshot every beat.
8. **Preview, then render.** `npx hyperframes render --quality high --fps 30`, then `ffprobe`.

## The beats

Full table in `references/beat-sheet.md`. The shape:

| Beat | What happens | Roughly |
| --- | --- | --- |
| 1 | The device rises into the studio, carrying the screen | ~4.0s |
| 2 | The page scrolls under an oversized cursor; the device turns | ~3.5s |
| 3 | Into the interface: one action, and the answer | ~4.0s |
| 4 | The claim, and a colour split | ~2.5s |
| 5 | The CTA, then the reveal to the lockup | ~4.0s |

Beat 3 is where the film earns its length. Beats 1 and 2 are staging.

## Commands

```bash
npx hyperframes init device-launch
npx hyperframes capture https://<a-site-you-own> --json
npx hyperframes lint
npx hyperframes check
npx hyperframes snapshot --at 1.6,3.4,5.8,7.6,9.4,11.2,13.0,16.4
npx hyperframes preview --background
npx hyperframes render --quality high --fps 30 --output renders/launch.mp4
ffprobe -v error -show_streams renders/launch.mp4 | grep codec_type
```

`capture` is run only against a site the caller owns. The CLI needs Node.js 22 or newer and
FFmpeg. No generation-model credential is used anywhere, and no 3D runtime is involved.

## Output contract

- One MP4 at 1920x1080, 30fps, 16–20s, H.264 + AAC.
- A HyperFrames project: `index.html`, the screen capture, and `meta.json`.
- A handoff note recording where the screen came from, the data scrub, the rights position on
  the device silhouette, the one action, and the claim's basis.
- `npx hyperframes check` at zero findings, pasted into the handoff.

## Failure rules

- If the screen is a mockup rather than a capture, stop. Everything else in the film is
  staging for it.
- If the device is recognisable as a specific manufacturer's product, redraw it.
- If the interface shows a real person's name, avatar, or data, scrub it before it goes on a
  device.
- If the film performs a second action inside the interface, cut one. Two is a tutorial.
- If the accent colour appears anywhere except the interface and the reveal, remove it — a
  dark studio with an accent in three places has no accent.
- Never call an image, video, or avatar generation model, and do not add a 3D runtime. Every
  frame is HTML, CSS, SVG, GSAP, or material the caller supplied.
