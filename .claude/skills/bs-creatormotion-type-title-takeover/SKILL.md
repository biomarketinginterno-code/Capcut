---
name: bs-creatormotion-type-title-takeover
description: An oversized condensed headline punches in behind a presenter. A clean edit removes the presenter while the same lettering holds its scale and position.
---

# Title Scene Takeover

Use this Skill for a short statement that starts behind a foreground presenter and then takes over the whole frame. This is a 5.4-second HyperFrames composition, built as two edited shots with one persistent title layer. Read `references/motion-spec.md` and `references/DESIGN.md` before adapting it. The reference-specific display typography and timing in the motion specification take precedence over generic small-title defaults.

## Create an editable project

1. Put replacement content in a JSON object using the input names below.
2. Choose `white-yellow` by default, or `charcoal-lime`, `paper-orange` or `midnight-ice` (Black & White). Dark styles retain fine static grid lines.
3. Run `node scripts/create.mjs --out /absolute/output/path --data /absolute/content.json --style midnight-ice --media /absolute/presenter.mp4 --images /absolute/images.json`.
4. Render through HyperFrames using the command printed by the generator. Inspect the punch, exact cut and final reading hold.

Supply a continuous presenter/background take at least 1.8 seconds long with `--media`; its aligned cutout follows the Presenter cutout rules below. The generator copies media into the editable project. Never loop shorter footage; keep video muted and provide narration separately if required.

## Inputs

```json
{
  "title": "BUILD WITH US",
  "supportingLine": "One small project every week"
}
```

Prefer 2–4 short English words or 4–8 Chinese characters. The headline is capped at 32 characters. Keep the support concise enough for one line. Change input values rather than animation selectors. If reframing different media, adjust the base and alpha matte together.

## Motion invariants

- A tall, condensed Google-font headline occupies most of the frame width.
- A fast punch and small settle establish the title behind the presenter; there is no slow generic fade-in.
- At 1.8 seconds the presenter shot cuts away. The same headline element remains exactly in place and at the same size.
- A plain subordinate supporting line appears after the cut. It must not become a rounded UI button.
- The final statement has a stable reading hold. Do not add decorative motion to fill the hold.

All type, compositing and motion render inside HyperFrames. No AE, Fusion or external compositing stage is required. A different palette must not turn this movement into a generic card entrance.

## Validation

Run HyperFrames lint, validate and inspect in the generated project. Review exact frames immediately before, on and after the 1.8-second cut. Verify the alpha matte aligns, replacement text remains readable, fonts are local, and the final frame is not empty. Inspect an actual rendered video; technical checks do not replace the user's visual acceptance. See the motion specification for the current SVG text-bounds inspection limitation.

## Presenter cutout

This effect uses a transparent presenter cutout (`presenter-matte`) that shares the frames, duration and framing of the `--media` take. The cutout is required for the first shot, where the headline sits behind the presenter.

1. If the user already has a cutout of the same take, generate directly: pass it with `--matte /absolute/presenter-matte.webm` (or the `presenter-matte` key in `--images`). Footage that already carries an alpha channel (VP9 alpha WebM or ProRes 4444) is detected and used as its own cutout.
2. Otherwise keep the default `--matte auto`. Before building, the generator cuts the presenter out of the `--media` take with HyperFrames: `npx --yes hyperframes@0.8.30 remove-background /absolute/presenter.mp4 -o /absolute/presenter-matte.webm --quality best`. It runs a local human-segmentation model (CoreML on Apple silicon, otherwise CPU or CUDA), downloads the model weights once on first use, and needs roughly 0.1–0.6 seconds per frame depending on resolution. The cutout keeps the source resolution and is cached by source checksum, so other palettes of the same take reuse it. Run the command yourself first when you want to review the cutout, then pass the result with `--matte`.
3. `--matte off` disables automatic cutting.

`build.json` and `image-assets.json` record whether the cutout came from the user, from alpha footage or from `remove-background`, with checksums. Inspect hair, hands and fast motion in the rendered frames; if the automatic edge is not clean enough, supply a better cutout. For 4K delivery, supply 4K footage and add `--resolution landscape-4k` to the printed render command.

## Chinese typography

Chinese content uses the bundled Smiley Sans (Deyi Hei) by default. The generator detects Chinese in the resolved content and applies it with no flag, including to Latin words in the same composition; Noto Sans SC stays behind it for rare characters. Smiley Sans has one slanted display weight, so hierarchy comes from size, color and spacing rather than weight. Pass `--zh-font noto-sans-sc` only when the user wants the plainer Noto Sans SC; a supplied `--font` always wins. `build.json` records the choice under `typography`.

## Image material contract

Follow [the image policy](references/image-policy.md) before adapting visual content. Photos, covers, document imagery and chat avatars use actual raster assets. Without user references, reuse the generated defaults in [the slot map](references/default-image-slots.md); do not ask for every image. User-specified images replace the corresponding slots first. Keep typography, vector diagrams, masks and movement editable in HyperFrames. New image subjects require the available image-generation tool (image2 when exposed), with actual provider/model provenance; no silent HTML substitute. Presenter video remains a separate input; its aligned cutout is supplied or generated as described in Presenter cutout.
