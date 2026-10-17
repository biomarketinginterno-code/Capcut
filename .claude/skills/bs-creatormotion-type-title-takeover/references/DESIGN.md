# B-roll visual system

## Style Prompt

An editorial motion toolkit for creator explanations. Strong typographic hierarchy, generous margins, precise diagrams, and confident short transitions. A viewer should understand the changing relationship before reading every label. A real presenter is framed as a participant in the composition. Content occupies the frame; there are no decorative dashboards or boilerplate title cards wrapped around every effect.

## Colors

| Style | Canvas | Surface | Text | Muted text | Accent | Accent ink | Rule |
|---|---|---|---|---|---|---|---|
| white-yellow (default) | #F9F9F4 | #FFFFFF | #18201D | #58615A | #F4CE36 | #18201D | #D8DED5 |
| charcoal-lime | #111411 | #1C211D | #F6F8EF | #B6C3B6 | #CAED79 | #18201D | #39463D |
| paper-orange | #F5EDE0 | #FFFCF6 | #30281F | #71614F | #E36F3D | #201811 | #D2BFA7 |
| midnight-ice (Black & White) | #111111 | #1D1D1D | #F5F5F5 | #B5B5B5 | #F0F0F0 | #141414 | #414141 |

Accents identify the changing element, not every element. Dark styles use lighter rules and muted type. White-yellow remains the default for new briefs. User color overrides replace semantic tokens, with contrast checked before delivery.

## Typography

- Inter from Google Fonts, true variable 100–900: titles, explanatory copy and diagram labels. Headline weight 650–700; repeated labels 500–600; body 400–450. Preserve 750 only for a deliberate typographic focal point. Avoid making every element bold.
- Smiley Sans (Deyi Hei) v2.0.1, SIL OFL: default typeface whenever the content contains Chinese. The generator detects Chinese in the resolved content and sets it for titles, copy, and Latin words in the same composition; Chinese characters inside IBM Plex Mono labels fall back to it too. It has one slanted display weight, so hierarchy comes from size, color, and spacing, not weight; synthetic bold stays disabled. `--zh-font noto-sans-sc` restores the previous Noto Sans SC look.
- Noto Sans SC from Google Fonts, true variable 100–900: Simplified Chinese fallback behind Smiley Sans for rare characters, with Google's complete delivered Unicode subsets. The Chinese and Latin text share one hierarchy rather than mixing unrelated system fonts.
- IBM Plex Mono, 400/500: small measurements, short axes and ordinal labels only. Main figures use the proportional text family with tabular numerals where stable width matters.
- Headline tracking around −0.022em to −0.028em; body tracking 0 to −0.012em. Keep generous optical line spacing; avoid crushed counters and tight multi-line display text.
- Headline sizes typically 72–112 px at 1920×1080; larger text only when the actual effect is a full-frame typographic reveal. Diagram labels 30–44 px, secondary labels at least 24 px.
- Google Fonts are fetched from their official CSS API and bundled locally with source URLs, hashes and SIL Open Font Licenses. Rendering and installed compositions do not depend on a later network request. Font assets are included in render freshness checks.
- Preserve custom font overrides: `--font` or an `overrides.font` token always wins over the Chinese default, with Smiley Sans kept as the CJK fallback. Use optical sizing and disable synthetic bold. All four styles use identical font metrics and motion.

## Layout and Motion

- 1920×1080, 30 fps, safe margins 96 px horizontally / 80 px vertically. Most demonstrations 6–9 seconds; preserve longer multi-stage behavior where it needs reading time.
- Layout settled states with grid/flex and gap before authoring motion. Canvas-bound positioned elements are allowed for spatial diagrams, camera planes, masks and presenter frames when their geometry is deliberate.
- Start entrances after 0.16 seconds. Use power3.out for confident movement, expo.out for decisive reveals, sine.inOut for reading-time travel, back.out(1.15) only for physical pops.
- Timeline beats communicate structure. Draw before label, reveal before compare, move before resolve. A meaningful settled reading interval is required.
- Preserve the defining movement of each extracted effect. Shared colors do not justify replacing it with a generic card animation.
- Thin dividers, simple abstract symbols and sparse diagrams; 1.5–3 px panel rules and 3–5 px diagram strokes on 1080p; essential moving paths may be stronger. Shadows are restrained and palette-aware.
- Four styles keep the same motion and content so visual choices can be compared directly. Paper-orange has slightly softer corners; Black & White is strictly neutral in its UI palette; white-yellow is crisp editorial; charcoal-lime uses lime sparingly on a near-black field.

Both dark styles have static fine grid lines: a 64 px minor grid at low opacity, with a still quieter 320 px major grid. Apply the same canvas treatment to full-frame and split-frame background planes, not to every card, label, mask or transition tile. Preserve clean reading areas and supplied photo colors.

## What NOT to Do

- No source creator names, copied titles, logos, watermarks or recognizable proprietary interface skins in generated examples.
- No fake photos from CSS polygons. Use supplied media or ImageGen when a visual truly needs imagery.
- No repeated full-screen presenter loops with visible jump seams. Cut away, choose a long-enough take, or generate a longer take when needed.
- No all-purpose animated card template that merely changes its heading for different Skills.
- No unreadable mini-labels, excessive frosted glass, gradient blobs, or jitter on settled text.
- No original reference media in installable Skill packages.
