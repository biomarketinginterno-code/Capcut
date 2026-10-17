# Retarget checklist

Every line must pass before Scene 1 is written. Paste the filled list into the handoff.

## 1. The change is real

- [ ] The caller supplied the actual change: a pull request, a commit range, a branch, or
      a diff export.
- [ ] The scroll content uses real file paths, real added and removed lines, and real
      counts pulled from that change.
- [ ] The change is substantial enough to justify thirty seconds. A one-line fix is a
      sentence, not a film.

If the real change cannot be supplied, stop. The film's premise is "here is the actual
diff"; it cannot open on a fabricated one.

## 2. The agent surface — the blocking gate

- [ ] It is established in writing whether the terminal is an interface the caller owns or
      a neutral original built for this film.
- [ ] If neutral: no third-party wordmark, model chip, icon set, menu structure, or
      signature layout appears, and the deliverable says the terminal is representative.
- [ ] The window dots are drawn as plain circles, not as a recreation of a specific
      operating system's controls.
- [ ] No screen recording of a third-party agent or IDE is used.

## 3. Identifiers are safe to ship

- [ ] Repository names, organisation names, usernames, avatars, and PR URLs are fictional
      **unless** the caller owns them and has confirmed they may appear.
- [ ] No real person's name, handle, avatar, or likeness appears in a comment row, a
      review thread, or an author line.
- [ ] The diff content contains no secrets, keys, tokens, internal hostnames, customer
      names, or private paths. Read it, do not assume.

## 4. The summary carries the film

- [ ] `summary` is one sentence a person would actually say at standup.
- [ ] It fits on one line at 68–76px without wrapping to three.
- [ ] The caller has approved it. It is the single thing the audience leaves with.
- [ ] If the change cannot be summarised in one sentence, the film is premature — the
      change needs a clearer story before it needs a video.

## 5. The tiles are one idea each

- [ ] Four tiles, each ≤ 26 characters, each carrying exactly one idea.
- [ ] Each tile's evidence is built from the caller's real change, not a generic
      illustration.
- [ ] The four evidence types differ from one another.
- [ ] No tile needed the type shrunk to fit.

## 6. The closing command works

- [ ] `install` has been run and works as written.
- [ ] It is the correct command for the audience's environment, not an internal variant.
- [ ] It fits on one line in mono at composer size.

## 7. Timing

- [ ] The scroll is genuinely unreadable at the chosen speed — someone who has not seen
      the change was shown the beat and could not follow it.
- [ ] The punch card is ~0.9 seconds and holds exactly one line.
- [ ] The summary holds still for at least 1.2 seconds.
- [ ] No scene has spare seconds. At this density, a scene with time to fill is too long.

## 8. Palette and type

- [ ] The paper ground is warm, not `#ffffff`; the ink is warm, not `#000000`.
- [ ] The accent appears once per scene, never twice.
- [ ] Green and red appear only inside the scroll.
- [ ] Type licenses cover use in a rendered, distributed video.

## 9. Rights and honesty

- [ ] Nothing states or implies affiliation with, endorsement by, or authorization from
      any company the caller does not own.
- [ ] The caller owns or has licensed every supplied asset, including the music bed.
- [ ] Every capability the tiles claim is one the change actually delivers.
