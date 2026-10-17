# Studio craft — the device, the screen, and the cursor

## The device, without a 3D model

A slab in CSS perspective. No model file, no loader, no WebGL, and nothing to license.

```css
.studio { perspective: 2400px; perspective-origin: 50% 46%; }
.device {
  transform-style: preserve-3d;
  transform: rotateX(var(--rx)) rotateY(var(--ry)) rotateZ(var(--rz)) translateZ(var(--tz));
}
```

Three rules make it read as an object rather than a rectangle that happens to be skewed:

- **The bezel has thickness.** A second element behind the screen, two or three pixels
  larger on every side and a shade darker, is what stops the screen from looking painted on.
- **The highlight moves with the rotation.** One long, low-alpha linear gradient across the
  glass, its angle driven by the same `--ry` as the device. A static highlight on a turning
  object is the single most common tell.
- **The shadow is separate and softer than you think.** A blurred ellipse under the device,
  scaled with `--tz`, and it never rotates.

Keep `rotateY` under about 26°. Past that a CSS slab starts revealing that its bezel has no
real depth, and the illusion that survives at 20° collapses at 35°.

## Neutrality

The device is a slab: rounded corners, a uniform bezel, a screen. What makes a device
*recognisable* is not the rectangle, it is the details — the cutout shape, the camera
arrangement, the button positions, the corner radius ratio, the bezel asymmetry. Leave all of
them out. A neutral slab is not a compromise here; it is the only version that does not put a
second brand in a launch film for a first one.

If the caller manufactures hardware, use theirs, and say so in the handoff.

## The screen

The screen has to be a real capture. That is the film's entire claim.

```bash
npx hyperframes capture https://<a-site-you-own> --json
```

Then:

- **Match the aspect ratio to the device**, and capture at 2x the on-screen pixel size. A
  screen that is 420px wide in frame should come from an 840px-wide capture, or the type
  inside it will be soft exactly when the film pushes in.
- **Capture tall.** The scroll needs somewhere to go. Three to five screens of height is
  right; less and the scroll is a nudge, more and it becomes a tour.
- **Scrub before you stage.** Real names, real avatars, real balances, real addresses, real
  message content, and any third-party mark that happens to be in a corner. This is a
  five-minute job that is very hard to undo once the film is rendered.
- **Drive the scroll from one value.** A single `scroll` property tweened from 0 to a
  fraction, with the strip's `translateY` derived from it. Two scroll sources drift.

Check the screen at the frame where it is **largest**, not on a wide shot. A capture that
looks fine on a device at 40% can be unreadable at 100%, and beat 3 is at 100%.

## The cursor, not a hand

This staging traditionally uses a photograph of a hand. An oversized drawn cursor is better
in three ways and worse in none:

- It has no likeness, so there is no permission question and no uncanny edge to matte.
- It can move on a curve with a real arc and a real press, which a photographed hand cannot.
- It is unmistakably a pointer, so nobody spends a beat working out whose hand it is.

Make it large — 60 to 90px on a 1920 frame — and give it one press: down 6%, hold two frames,
back up. The press is what makes the click legible; the click sound is what makes it land.

## The zoom into the interface

The seam between staging and the action is the hardest thing in the film, because it is not a
camera move — it is a **change of subject**. The device stops being the subject and the
interface becomes it.

Two ways that work:

- **Scale through.** The device scales up past the frame while the interface, already at
  full size behind it, is revealed. Both moving, same direction, so the cut is velocity
  matched.
- **Match cut.** One element — the button, the field, the card — is in the same screen
  position at the same size on both sides of the cut, and everything else changes.

What does not work is a slow push-in that arrives at the interface. It reads as a zoom into a
picture of a screen, which is exactly what you are trying to stop it being.

## Determinism

- **Repeat every animated property in BOTH the `from` and `to` objects.** A property that
  appears only in `fromVars` has its *end* value resolved lazily from the element's current
  state; with `immediateRender: false` and a render worker seeking to arbitrary frames that
  resolves to `visibility: hidden`, and the element never appears — while a monotonic
  `snapshot` pass looks correct.
- Set `defaults: { immediateRender: false }` on the timeline.
- Initial hidden states belong in CSS, not in a zero-duration set at position 0 — a set at 0
  does not render while the playhead sits exactly at 0.
- No `Math.random`. Use a finite `repeat`; `repeat: -1` is banned outright.
- Every `<audio>` element needs an `id`. Every `<video>` needs `muted` and `playsinline`.
