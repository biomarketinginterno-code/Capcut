# Beat plan

Durations are the reference cut at 1920x1080 / 30fps, total 7.0s. The rupture is placed
first and everything else is measured from it.

| Beat | Frames | Seconds | What happens |
| --- | --- | --- | --- |
| 1 · gather | 1–30 | 0.00–1.00 | Satellites arrive from off-frame and coalesce; the hero bead forms out of them |
| 2 · drift | 31–90 | 1.00–3.00 | The bead travels slowly, carrying the mark. The fields move behind it |
| 3 · hold | 91–103 | 3.00–3.43 | The bead stops. The only still moment before the event |
| 4 · **rupture** | 104–109 | 3.43–3.63 | The bead collapses to nothing in six frames |
| 5 · scatter | 104–140 | 3.43–4.66 | Satellites launch outward; the lockup lands and recoils |
| 6 · hold | 141–210 | 4.66–7.00 | The lockup, alone, still |

Beats 4 and 5 overlap deliberately: the collapse and the launch are the same event seen from
two distances.

## Why the hold is there

Beat 3 is thirteen frames and it is the most important beat in the film. A rupture that
arrives while the bead is still travelling reads as an accident — something knocked it. A
rupture out of stillness reads as an event.

It is also the only place a viewer gets to look at the carried mark without motion helping
to hide it, which is the honest place to run the legibility check.

## Why the satellite table is authored

Fifteen satellites need a position, a radius, a drift phase, and a launch vector each. All of
it is a stamped table rather than a generator, for two reasons:

- **Determinism.** `Math.random` re-rolls per render worker.
- **Composition.** A generated scatter distributes evenly, which reads as a pattern. An
  authored one can be denser on one side, leave the lower-right quiet, and put the two
  largest satellites where they will bridge to the hero. That is a decision and it should
  look like one.

Launch vectors point **away from the hero's centre**, but not radially even — vary the speeds
by a factor of about two across the set, and let two or three of them leave slowly enough to
still be on frame when the lockup lands. A scatter where everything leaves at the same speed
reads as an explosion diagram.

## Copy

There is none before the rupture. No tagline, no URL, no label, no caption, no UI, no HUD,
no grid, no ticks. The bead is the only subject in the frame and anything else in it is
competing with the one thing the film is for.

After the rupture, the lockup, and at most one line — and one line is usually one too many.

## Retiming

The rupture frame is the anchor. Moving it moves everything: beat 3's hold has to stay at
least ten frames, the collapse has to stay at or under a fifth of a second, and the scatter
has to stay at least three times the collapse. Those three ratios are the film; the absolute
length is not.
