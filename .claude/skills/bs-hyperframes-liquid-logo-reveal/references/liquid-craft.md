# Liquid craft — the filter stack

There is no 3D here. The liquid is four SVG filter primitives and a lot of restraint.

## 1 · Merge — the goo filter

Beads that pass near each other should join and part like fluid rather than overlap like
circles. That is a blur followed by a hard alpha contrast:

```xml
<filter id="goo">
  <feGaussianBlur in="SourceGraphic" stdDeviation="22" result="blur"/>
  <feColorMatrix in="blur" type="matrix"
    values="1 0 0 0 0
            0 1 0 0 0
            0 0 1 0 0
            0 0 0 26 -12" result="goo"/>
  <feBlend in="SourceGraphic" in2="goo"/>
</filter>
```

The alpha row is the whole trick: multiply alpha by a large number and subtract, and the
blurred halo snaps back to a hard edge — except where two halos overlap, which is where the
bridge forms.

Two numbers to tune, and only two: `stdDeviation` sets how far apart beads can be and still
bridge, and the alpha multiplier sets how tight the resulting edge is. Raising the blur
without raising the multiplier gives you soft mush; raising both gives you fluid.

Apply it to a **group** containing the hero and the satellites. Applying it per element does
nothing, because the merge is an interaction between them.

## 2 · Refract — the carried mark

The mark rides inside the hero and must be unmistakably a shape and unmistakably unreadable.

```xml
<filter id="refract">
  <feTurbulence type="fractalNoise" baseFrequency="0.012 0.02"
                numOctaves="2" seed="7" result="noise"/>
  <feDisplacementMap in="SourceGraphic" in2="noise" scale="86"
                     xChannelSelector="R" yChannelSelector="G"/>
</filter>
```

`seed` is not optional. An unseeded `feTurbulence` is re-generated per render worker, so the
preview and the render disagree and neither is reproducible.

`scale` is the legibility control. Tune it against **one test**: snapshot the frame before
the rupture and try to read the mark. If you can, raise it. Tuning it to look good instead
produces a beautiful film with nothing to reveal.

## 3 · Glass — the fringe

A bead reads as glass rather than paint when its edge splits colour slightly. Two offset
copies of the bead outline, each in one channel's direction, at low alpha:

```css
.bead-fringe-a { transform: translate(-2px, -1px); color: rgba(120, 200, 255, 0.5); }
.bead-fringe-b { transform: translate( 2px,  1px); color: rgba(255, 150, 190, 0.5); }
```

Two pixels, not ten. At ten it stops being glass and becomes a 3D-anaglyph joke.

One specular highlight per bead — a small offset radial gradient near the upper left — and
one soft occlusion near the lower right. Not a rim light all the way round; a bead lit from
everywhere reads as a sphere in a studio, which is a different film.

## 4 · Fields — what is behind

Three large, heavily blurred radial gradients, drifting slowly. They are colour, not imagery:
no photograph, no environment map, no pattern. Their only job is to give the liquid something
to bend, so they should be **large and soft** — a field smaller than the bead reads as an
object behind glass rather than as a world.

Keep them slow. Everything else in this film is either still or violent, and a mid-speed
background undercuts both.

## Determinism

- **Seed every `feTurbulence`.** Unseeded turbulence is the single most common source of a
  render that does not match its preview in this kind of film.
- **No `Math.random` anywhere.** Satellite positions, sizes, phases and launch vectors come
  from a stamped table. `references/beat-plan.md` explains why the table is authored rather
  than generated.
- **Repeat every animated property in BOTH the `from` and `to` objects.** A property that
  appears only in `fromVars` has its *end* value resolved lazily from the element's current
  state; with `immediateRender: false` and a render worker seeking to arbitrary frames that
  resolves to `visibility: hidden`, and the element never appears — while a monotonic
  `snapshot` pass looks correct.
- Set `defaults: { immediateRender: false }` on the timeline.
- Use a finite `repeat` count; `repeat: -1` is banned outright.
- Every `<audio>` element needs an `id` or the mixer skips it and the render is silent.

## Cost

The goo filter is a full-frame blur on every frame it is active, which is most of the film.
That is the expensive part of the render and it is worth it. What is not worth it: applying
the refract filter to anything other than the carried mark, or leaving the goo filter active
after the rupture, when there is nothing left to merge.
