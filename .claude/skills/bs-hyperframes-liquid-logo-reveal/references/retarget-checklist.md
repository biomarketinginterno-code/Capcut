# Retarget checklist

Work top to bottom. Stop where it says stop.

## 1 · Fit

- [ ] This is a reveal, and it is going at the end of something or standing alone. If it is
      meant to introduce or explain, stop — there is no copy in this structure.
- [ ] The brand has a mark worth revealing. A wordmark alone works; a wordmark set in a
      system font does not, because there is nothing to recognise as a silhouette.

## 2 · Rights

- [ ] The mark and wordmark are files the caller owns or holds written permission to use.
      If there is no real file, stop and ask for one.
- [ ] No third-party mark appears inside the liquid, as a before state, a partner lockup, or
      a comparison.
- [ ] The fields behind the liquid are colour only — no photography, no captured
      environment, no screenshot, no pattern lifted from elsewhere.
- [ ] Music and any rupture sound are licensed for the caller's distribution.

## 3 · The mark

- [ ] The mark's real path bounding box was measured before it was placed.
- [ ] The bead is sized to the mark, not the mark to the bead.
- [ ] The lockup after the rupture uses the official artwork, at its official proportions.

## 4 · Colour

- [ ] A ground and exactly three field colours.
- [ ] The liquid itself is near-white. It is not a brand colour, and making it one turns the
      bead from glass into paint.
- [ ] The fields are large and soft. A field smaller than the bead reads as an object behind
      glass rather than as a world.

## 5 · The rupture

- [ ] The rupture frame was chosen first and everything else measured from it.
- [ ] The hold before it is at least ten frames.
- [ ] The collapse is at or under a fifth of a second.
- [ ] The scatter is at least three times the collapse.

## 6 · Legibility — the one test

- [ ] Snapshot the frame **before** the rupture. The mark cannot be read.
- [ ] Snapshot the frame **after**. It can.
- [ ] If it could be read early, the distortion was raised and both snapshots were retaken.

## 7 · Determinism

- [ ] Every `feTurbulence` carries a `seed`.
- [ ] No `Math.random` anywhere. Satellite positions, sizes, phases and launch vectors come
      from a stamped table.
- [ ] Every animated property appears in both the `from` and the `to` objects.
- [ ] No `repeat: -1`.

## 8 · Gates

- [ ] `npx hyperframes lint` clean.
- [ ] `npx hyperframes check` at zero findings, including contrast.
- [ ] Nothing is moving two seconds after the rupture.
- [ ] The render watched at full speed, twice: once for the rupture, once for whether the
      lockup lands.

## 9 · Handoff

- [ ] The mark's provenance and the rights position on it.
- [ ] The four colours.
- [ ] The rupture frame, and the three ratios around it.
- [ ] The two legibility snapshots.
- [ ] The `check` output, pasted.
