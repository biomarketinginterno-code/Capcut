# Visual system

One stylesheet owns every token. Compositions read `var(--…)` and never hard-code a value.

## Palette roles

The film is light and warm. The only dark surface is the terminal inset, and that contrast
is what makes the terminal read as "the tool" rather than as the film's ground.

| Role | Token | What it is | Reference value |
| --- | --- | --- | --- |
| Paper | `--paper` | The film's ground. Warm, never `#ffffff` | `#f0efe9` |
| Surface | `--surface` | Cards, tiles, the window body | `#faf9f5` |
| Sunken | `--sunken` | Tint bands, the diff gutter | `#e6e2d6` |
| Ink | `--ink` | Display type and body copy. Warm, never `#000000` | `#1d1f1f` |
| Muted | `--muted` | Secondary copy | `#6f6e66` |
| Quiet | `--quiet` | Line numbers, metadata, eyebrows | `#8c8b83` |
| Hairline | `--hairline` | Dividers, card edges | `#dcd8cc` |
| Accent | `--accent` | The rationed clay: caret, send, one word per scene | `#d97757` |
| Accent deep | `--accent-deep` | Pressed and text-on-light variant | `#cc785c` |
| Terminal | `--terminal` | The dark window body | `#1f1f1e` |
| Terminal inset | `--terminal-inset` | The composer inside the terminal | `#2c2c2b` |
| On-terminal | `--on-terminal` | Text on the dark surface | `#efeadd` |
| Add | `--add` | Added lines in the scroll | `#2f7d4f` |
| Remove | `--remove` | Removed lines in the scroll | `#b04a3f` |

Three rules that matter more than the values:

- **Never pure white, never pure black.** The warm paper and warm ink are what make this
  read as a tool people already use.
- **The accent is rationed to one element per scene.** The caret, the send control, one
  highlighted word — pick one per scene, never two.
- **Green and red appear only inside the scroll.** They are diff semantics, not palette. If
  they show up in a tile, the tile reads as a diff and the eye goes hunting.

Give the assembled root the paper colour so any inter-scene gap reads as the film's ground
rather than as black.

## Type

| Ramp | Token | Job | Reference |
| --- | --- | --- | --- |
| Display | `--f-display` | The punch card, the summary, tile headlines | A heavy grotesk, weight 700–900 |
| Body | `--f-body` | Composer text, replies, tile support copy | A neutral grotesk, 400–600 |
| Mono | `--f-mono` | Diff content, line numbers, commands, eyebrows | Any humanist mono, 400–500 |

Sizes at 1920x1080:

- Punch card: 88–96px, tracking `-0.03em`.
- Summary: 68–76px, one line, tracking `-0.03em`.
- Tile headline: 46–54px.
- Composer text: 30–34px.
- Diff rows: 22px mono, line-height 1.55.
- Line numbers and eyebrows: 18px mono in `--quiet`, tracking `0.16em` for eyebrows.

Load faces with `<link>` so the assembler hoists them. No `<br>` in body text.

## Components

### The window

A rounded card on the paper, `--terminal` fill, 18px radius, a 44px title bar with three
window dots and a mono path label. The dots are decorative: draw them as three plain
circles at `--quiet`, not as a recreation of any particular operating system's controls.

### The composer

Inside the window: a `--terminal-inset` rounded box, mono text in `--on-terminal`, an
accent caret, and a circular send control. The caret is the clipped element's own
`border-right`, so it tracks the reveal edge exactly.

### The link chip

An inline pill in the composer line: `--sunken` fill, hairline border, mono at 24px, with a
small inline SVG link glyph. It snaps in on a single frame with a `back.out(1.6)` scale —
the way a pasted link resolves.

### The diff row

```
[ line-no (mono, --quiet) ][ sign gutter ][ content (mono) ]
```

Added rows tint the content with `--add` and the row background with a 6% wash of it;
removed rows the same with `--remove`. File headers are `--sunken` bands with the path in
mono at `--muted`. Nothing else — at scroll speed, anything more is noise.

### The tile

`--surface` fill, `--hairline` border, 24px radius, generous padding. A mono eyebrow, one
headline, and one piece of evidence. Vary the evidence across the four tiles.

## Motion tokens

| Intent | Duration | Ease |
| --- | --- | --- |
| Typing reveal | length-derived | `none` |
| Link chip snap | 0.18s | `back.out(1.6)` |
| Cursor travel | 0.55s | `power2.inOut` |
| Cursor press / release | 0.08s / 0.14s | `power2.in` / `back.out(1.5)` |
| Diff scroll | 3.0s+ | `none` |
| Punch card push | 0.9s | `power2.in` |
| Summary mask reveal | 0.55s | `power3.out` |
| Scene enter from right | 0.45s | `expo.out` |
| Scene exit to left | 0.34s | `power3.in` |
| Tile evidence build | 0.4s, 0.08s stagger | `power2.out` |
| Outro rise | 0.5s | `expo.out` |

Banned: `bounce.out`, `elastic.out`, and any idle sine loop used to fill time. At ten
scenes in thirty seconds there is no time to fill — if a scene has spare seconds, it is
too long.

## Determinism notes

- **Typing is a width or clip tween**, never a per-frame substring rewrite. A per-frame
  rewrite is not seekable and the render will disagree with the preview.
- Use a finite `repeat` count; `repeat: -1` is banned outright.
- `fromTo` defaults to `immediateRender: true`, which stamps a later tween's start state at
  build time and can leave elements visible from frame 0. Set
  `defaults: { immediateRender: false }` on each composition timeline.
- **Repeat every animated property in BOTH the `from` and `to` objects.** A property that
  appears only in `fromVars` has its *end* value resolved lazily, from the element's state
  at the moment the tween first renders. Combined with `immediateRender: false` and a
  render worker seeking to arbitrary frames, that end value resolves to the element's CSS
  `visibility: hidden` — so `fromTo(el, {x: 900, autoAlpha: 1}, {x: 0})` animates the
  element from visible straight back to invisible and it never appears in the render.
  A monotonic `snapshot` pass resolves it differently and looks fine, which is exactly what
  makes this one expensive: it passes every gate and every contact sheet, and only the
  final multi-worker render is wrong. Write `{x: 0, autoAlpha: 1, ...}` instead.
- Never pair a CSS initial `transform` with a GSAP tween on the same property.
- Never put `crossorigin` on `<video>` or `<audio>`; every `<audio>` needs an `id`.
- Elements hidden before their entrance need `visibility: hidden`, not just `opacity: 0` —
  an opacity-0 element still counts as a present text block in the layout audit.
- Mark deliberate off-canvas travel with `data-layout-allow-overflow`. The scroll column is
  taller than the frame by design; that is not a defect.
