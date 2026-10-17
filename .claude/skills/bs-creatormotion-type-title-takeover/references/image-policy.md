# Image material policy

## Use the right material

Photos, portraits, chat avatars, cover art, content thumbnails, document pages and visual evidence should appear as actual raster images. Follow the reference shot's material and subject density. Do not replace them with CSS illustrations, initials in a circle, empty rectangles, simulated text lines or generic HTML cards. Keep headings, readable copy, chat balloons, controls, charts, arrows, masks and their animation editable in HyperFrames. A chart can remain a vector chart; a photo shown beside it remains a photo.

## Selection order

1. Use the user's explicit image or cover replacements for the requested slots. Inspect the supplied images and preserve their intended crop and identity. Do not regenerate or silently substitute them.
2. When no replacement is supplied, reuse the generated images already included in `default-images/manifest.json`. Do not ask the user to supply every image and do not make a fresh paid generation call just to reproduce a bundled default.
3. If a requested new subject has no suitable default, use the available image-generation tool to create original raster material. Request image2 when the environment exposes that model; otherwise use its available image-generation tool and record the actual provider/model instead of claiming an unavailable model was used. Store the result and provenance for reuse. If generation is unavailable, identify the missing material; do not silently draw a substitute with HTML.

Bundled images are illustrative generated material, not screenshots or proof of real customer statements, analytics, products or source events. For factual evidence, use the user's actual source image. Presenter motion footage and a same-frame alpha matte remain separate media requirements; a generated avatar does not replace a required presenter performance.

## Portable defaults and overrides

The generator reads the selected effect's key-to-asset mapping from `default-images/manifest.json`. Each asset has a relative filename, SHA-256 checksum and generation provenance. Installation includes the original raster files listed by that manifest. It excludes reference clips, preview videos, private local paths and unlisted media.

Use `--images /path/to/images.json` to replace only the named slots. All other default images remain available. Values are local paths; relative values resolve beside the supplied JSON file, not the current working directory. For example, `{"avatar-user":"./my-portrait.png"}` selects the image next to that JSON file. Use the actual slot keys in the effect manifest; they vary by effect. Missing or invalid replacements fail visibly rather than reverting to an unrelated default.

The generated project copies the used files into its own `assets/` directory. Its `image-assets.json` and `build.json` record the selected slots, bundled-versus-user origin, project-relative filenames and checksums. Review the final raster crops and mask edges in the rendered video, including entrances and transitions. Preserve enough resolution for the largest visible crop.
