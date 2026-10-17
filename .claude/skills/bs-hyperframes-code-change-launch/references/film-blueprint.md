# Film blueprint — ten scenes in thirty seconds

Durations are the reference cut at 1920x1080 / 30fps, total 30.0s. Ten scenes in thirty
seconds means the average scene is three seconds and four of them are under 2.6. The copy
has to be final before any HTML is written; there is no room to fix pacing later by
trimming words.

| # | id | Start | Dur | Beat | Sustained-motion route | Seam OUT |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `opener` | 0.0 | 5.2 | The request types into the composer with the change's link as a chip; send | Cursor-led, then sequenced UI life | Cut-the-curve LEFT |
| 2 | `scroll` | 5.2 | 3.2 | The real change scrolls past at speed | Animated sequence | Hard cut, mid-scroll |
| 3 | `punch` | 8.4 | 0.9 | One card, one line | Text beat | Z-forward |
| 4 | `summary` | 9.3 | 3.0 | The one sentence that matters, revealed on a mask | Staged reveal | Cut-the-curve LEFT |
| 5 | `invoke` | 12.3 | 3.8 | The invocation types and runs; the terminal answers | Sequenced UI life | Cut-the-curve LEFT |
| 6 | `tile-1` | 16.1 | 2.4 | Capability one | Animated sequence | Cut LEFT |
| 7 | `tile-2` | 18.5 | 2.5 | Capability two | Animated sequence | Cut LEFT |
| 8 | `tile-3` | 21.0 | 2.0 | Capability three | Animated sequence | Cut LEFT |
| 9 | `tile-4` | 23.0 | 2.6 | Capability four | Animated sequence | Upward |
| 10 | `outro` | 25.6 | 4.4 | The install command types into the composer and lands | Cursor-led | End |

The composer is the film's spine: it opens the film carrying a question and closes it
carrying the answer. Keep it in the same screen position in scenes 1 and 10 so the return
reads as a return.

---

## The seven copy slots

| Slot | Count | Budget | Purpose |
| --- | --- | --- | --- |
| `request` | 1 | ≤ 120 chars | What a teammate actually asked, in their voice |
| `link_chip` | 1 | ≤ 46 chars | The change's reference, shown as a chip, fictional unless owned |
| `punch` | 1 | ≤ 34 chars | The self-aware line on the 0.9s card |
| `summary` | 1 | ≤ 100 chars | The one sentence someone would say at standup |
| `invocation` | 1 | ≤ 40 chars | The command that runs in scene 5 |
| `tiles` | 4 | ≤ 26 chars each | One capability per tile, one idea each |
| `install` | 1 | ≤ 44 chars | The closing command, which must actually work |

Slot rules:

- `request` reads as a message, not a brief. "can you review it?" beats "please provide a
  summary of the changes."
- `punch` is the only place the film is allowed to be funny, and it gets 0.9 seconds. Short.
- `summary` is the payload. If the caller cannot say it in one sentence, the film is
  premature and the change needs a clearer story first.
- Each tile carries **one** idea. A tile needing a second clause is two tiles or none, and
  shrinking the type to fit is not a fix.

---

## Scene 1 — opener

1. A window sits on the paper ground, holding a composer. Nothing else on screen.
2. `request` types in at ~30 chars/second. Reveal by tweening the clipped line's width —
   never a per-frame text mutation, which is not seekable.
3. `link_chip` snaps in as an inline chip on its own frame, mid-sentence, the way a pasted
   link resolves.
4. A cursor travels to send, presses (0.08s compress, 0.14s `back.out(1.5)` release), and
   the press ignites the next beat on the **same frame**.
5. The window expands toward full bleed as the change loads, handing the frame to scene 2.

## Scene 2 — the unreadable scroll

The device the film is built on.

- The content is **real**: actual file paths, actual added and removed lines, actual counts.
- Speed 900–1200 px/second, ease `none`. Any acceleration reads as a designed effect
  instead of as someone scrolling.
- Colour does the work the eye can catch at that speed: green additions, red deletions,
  muted file headers, a hairline gutter with line numbers.
- **Do not blur it.** A blur says "you are not meant to read this." The point is that you
  could have, and would not.
- The cut into scene 3 lands mid-scroll, never at rest.

## Scene 3 — the punch

0.9 seconds. One card on the paper ground, `punch` at ~92px, nothing else. It arrives on a
short Z-forward push and the cut out lands while it is still growing.

This is the shortest scene and the hinge of the film. Long enough to read one line and
nothing else. Extending it kills the joke; cutting it removes the film's only moment of
self-awareness.

## Scene 4 — the summary

`summary` reveals on an upward mask at ~72px in the display ramp, one line, centred. If it
wraps to three lines it is too long — cut words, do not reduce the size.

Hold the finished sentence for at least 1.2 seconds. This is the one thing the audience is
meant to leave with, and it is the only scene in the film that is allowed to be still.

## Scene 5 — the invocation

Back inside the window. `invocation` types in mono, the cursor taps return, a short
thinking beat (~0.4s), then a two-line answer streams. Keep the answer to two lines: the
scene is 3.8 seconds and the tiles are next.

## Scenes 6–9 — the tiles

Four cards, 2.0–2.6 seconds each, cut leftward with no crossfade.

Each tile is: a mono eyebrow, one short headline, and one piece of programmatic evidence —
a small diff fragment, a flow of three nodes, a stack of comment rows, a count-up. Build
the evidence from the caller's real change; a generic illustration wastes the only two
seconds that tile gets.

Vary the evidence type across the four. Four tiles with four identical layouts read as a
template; four different pieces of evidence read as a product with range.

## Scene 10 — outro

The composer returns to its scene-1 position. `install` types in mono, the cursor taps
return, and the command lands with a short confirm. The wordmark rises beneath it — the
film's one upward vector — and holds.

End on stillness, not on a fade.

---

## Audio

| Layer | Level | Notes |
| --- | --- | --- |
| Music bed | ~0.15 | One continuous track under the whole runtime, resolving on the outro |
| Typing | ~0.22 | Under scenes 1, 5, and 10 only |
| Interaction SFX | ~0.5 | Cursor presses, on the exact press frame |
| Scroll | ~0.18 | A soft rush under scene 2, cut hard at the punch |

Rules:

- Every `<audio>` element needs an `id` or the mixer skips it and the render is silent.
- The hard audio cut into scene 3 is half of what makes the punch land. Cut the scroll rush
  on the same frame as the picture, not a few frames after.
- There is no voiceover. At thirty seconds across ten scenes, narration and on-screen copy
  compete and both lose.
