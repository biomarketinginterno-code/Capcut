# Title Scene Takeover motion specification

## Shot intent

The same oversized phrase sits behind a presenter, then owns the frame when the presenter shot cuts away. This is an edit between two shots with one persistent type layer. The phrase must not shrink into a small centered web heading.

## Authored timing at 30 fps

- 0–0.36s: A closer presenter crop establishes the subject.
- 0.36–0.59s: The headline punches from 67% to 103.5% scale with an exponential deceleration. Its brief opacity ramp belongs to this punch; it is not a 1-second fade.
- 0.59–0.76s: Settle from 103.5% to 100% scale without oscillation.
- 0.76–1.8s: Hold the headline behind the alpha presenter.
- Exactly 1.8s: Cut both the background and foreground subject. Reveal the palette canvas, including the fine static grid in dark styles. Keep the same headline element, size and position.
- 2.08–2.35s: Reveal the small right-aligned supporting line from left to right, without a box, pill, border or bounce.
- 2.35–5.4s: Stable reading hold. Do not fade to an empty last frame.

The final frame is intentionally still. Extra floating, glowing, repeated trails, camera drift or decorative motion would compete with the statement.

## Typography and geometry

At 1920×1080, the title is a single line with an authored 1680 px advance width, a 4-degree forward slant and a tall display silhouette. Use the bundled Google Inter variable font at weight 850; Chinese content uses the bundled Smiley Sans (Deyi Hei) by default. SVG `textLength` and `lengthAdjust="spacingAndGlyphs"` keep replacement headlines inside the authored width without waiting on asynchronous font measurement. The condensed letterforms are a deliberate display treatment, not a replacement font dependency.

Prefer a short 2–4-word English headline or 4–8 Chinese characters. The input rejects more than 32 characters rather than silently turning paragraph copy into a title. The Latin display em is 500 px; the Chinese display em is 420 px. Keep counters legible and inspect the actual replacement copy.

The supporting line is plain 43 px text, right aligned with 146 px of right clearance. Keep it to one concise line. The headline retains the same width and baseline across the cut. There is no second heading copy to crossfade or reposition.

## Media and compositing

Supply a continuous presenter/background take and matching alpha matte at least 1.8 seconds long. Both begin at media time zero, with identical sizing, object position and transform: 150% scale, origin 58% 34%, and -150 px horizontal translation. The tighter crop makes the presenter participate in the type composition. Reframe both layers together for different supplied media; never move just the matte.

The headline stays neutral white (#F5F5F5) over footage in every palette. On the exact 1.8s cut it switches to the selected palette ink, so light-canvas final states remain readable. The base is darkened beneath the headline. The foreground matte preserves the original subject exposure. A wrapper around the matte carries the cut so HyperFrames clip visibility management cannot leave a one-frame foreground hold over the new canvas.

Videos stay muted; this effect does not generate narration or a sound effect. Never loop a shorter take. Do not include any source creator's reference footage or identity in the installable package.

## Fidelity and validation

- Render through HyperFrames only. The result does not depend on an external compositor.
- Check the exact cut at 1.7667s, 1.8s and 1.8333s. The title must be stationary, and the subject must disappear completely on the 1.8s frame.
- Check the scale handoff around 0.5667s, 0.6s and 0.7s. It is one punch with a short settle, never a double entrance.
- Preserve the 1920×1080, 30 fps, 5.4-second composition unless the narration explicitly requires retiming.
- Keep only the title layer marked for intentional presenter occlusion. Nothing else gains a broad layout exemption.
- The current inspector overestimates SVG text bounds for `textLength`/`lengthAdjust`. If it reports title overflow, compare the actual 1080p title pixels and exact screenshots before accepting it. Do not mask genuine clipped lettering with a blanket overflow exception.
- Inspect an actual rendered MP4 as well as snapshots. Successful HTML generation alone is not aesthetic approval.

## Image material contract

Use the raster defaults in `default-image-slots.md` when no image reference is supplied. User replacements through `--images` override only their named slots. Preserve the reference's image-rich material: photos, avatars, covers, document imagery and content thumbnails must not become HTML drawings or placeholder text lines. Text labels, real charts, controls and motion remain editable. Generated default imagery is illustrative, not factual evidence. See `image-policy.md` for generation, provenance and replacement details.
