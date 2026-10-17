# Retarget checklist

Work top to bottom. Stop where it says stop.

## 1 · Fit

- [ ] The product has a screen worth showing.
- [ ] The screen can be captured for real. If it would have to be a mockup, stop — a mockup
      on a device in a studio is a very expensive way to show nothing.

## 2 · The screen

- [ ] Captured from the caller's own product, at 2x the on-screen pixel size.
- [ ] Aspect ratio matches the device.
- [ ] Three to five screens tall, so the scroll has somewhere to go.
- [ ] **Scrubbed**: no real person's name, avatar, message, balance, address, or any other
      real customer data.
- [ ] No third-party mark anywhere in it, including in a corner or a browser chrome strip.
- [ ] Checked at the frame where it is largest, not on a wide shot.

## 3 · The device

- [ ] A neutral slab: rounded corners, uniform bezel, screen. No cutout shape, camera
      arrangement, button placement, or bezel asymmetry that identifies a manufacturer.
- [ ] Or the caller's own hardware, recorded as such in the handoff.
- [ ] `rotateY` stays under about 26°.
- [ ] The bezel has thickness; the glass highlight moves with the rotation; the shadow is
      separate and does not rotate.

## 4 · The cursor

- [ ] A drawn original, 60–90px on a 1920 frame.
- [ ] No photograph of a hand, and therefore no likeness question.
- [ ] One visible press: down, hold two frames, up.

## 5 · The action

- [ ] Exactly one, inside the interface.
- [ ] The typed line is something the product genuinely accepts.
- [ ] The answer is the product's real behaviour. If its real timing was compressed, the
      handoff says so.

## 6 · Copy and colour

- [ ] Every slot in `beat-sheet.md` filled and inside its budget.
- [ ] The claim is a claim, not a feature.
- [ ] Two colours: a dark studio ground and one product accent.
- [ ] The accent appears in the interface and in the reveal, and nowhere else.

## 7 · Structure

- [ ] The zoom into the interface is a scale-through or a match cut, not a slow push-in.
- [ ] The colour split happens once, on the claim, not as a transition.
- [ ] The reveal lands on a light ground — the film's only change of state.

## 8 · Gates

- [ ] `npx hyperframes lint` clean.
- [ ] `npx hyperframes check` at zero findings, including contrast.
- [ ] No 3D runtime, no model file, no generation-model credential anywhere in the project.
- [ ] The render watched at full speed. The device reads as an object; the screen reads as
      real.

## 9 · Handoff

- [ ] Where the screen came from, and when it was captured.
- [ ] The data scrub, and what was removed.
- [ ] The rights position on the device silhouette.
- [ ] The one action, and whether its timing was compressed.
- [ ] The claim's basis.
- [ ] The `check` output, pasted.
