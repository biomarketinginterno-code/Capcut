import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';

export const REMOVE_BACKGROUND_CLI = 'hyperframes@0.8.30';

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

export async function fileSha256(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

// A take that already carries transparency (VP9 alpha WebM, ProRes 4444, PNG-in-MOV) is its own cutout.
export function hasAlphaChannel(file) {
  const probe = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=pix_fmt:stream_tags', '-of', 'json', file], {encoding: 'utf8'});
  if (probe.error || probe.status !== 0) throw new Error(`ffprobe could not read ${file}. FFmpeg is required to inspect presenter footage.`);
  const stream = JSON.parse(probe.stdout).streams?.[0] ?? {};
  const tags = Object.fromEntries(Object.entries(stream.tags ?? {}).map(([key, value]) => [key.toLowerCase(), String(value)]));
  return /^(yuva|rgba|argb|bgra|abgr|gbrap|ya)/.test(stream.pix_fmt ?? '') || tags.alpha_mode === '1';
}

// Cut the presenter out of the exact --media take so the cutout shares its frames, duration and framing.
// Results are cached by source checksum, so building other palettes of the same take reuses the cutout.
export async function generatePresenterMatte(media) {
  const sourceSha256 = await fileSha256(media);
  const cacheDir = path.join(os.tmpdir(), 'creatormotion-presenter-matte');
  const file = path.join(cacheDir, `${sourceSha256}.webm`);
  const command = `npx --yes ${REMOVE_BACKGROUND_CLI} remove-background ${JSON.stringify(media)} -o ${JSON.stringify(file)} --quality best`;
  if (fs.existsSync(file)) return {file, sourceSha256, cached: true, command};
  await fsp.mkdir(cacheDir, {recursive: true});
  const partial = path.join(cacheDir, `${sourceSha256}.partial.webm`);
  console.error(`No presenter cutout supplied; generating one with HyperFrames remove-background (local model, runs once per take)...`);
  const run = spawnSync(npx, ['--yes', REMOVE_BACKGROUND_CLI, 'remove-background', media, '-o', partial, '--quality', 'best'], {stdio: ['ignore', 'inherit', 'inherit']});
  if (run.error || run.status !== 0 || !fs.existsSync(partial)) {
    await fsp.rm(partial, {force: true});
    throw new Error(`HyperFrames remove-background failed for ${media}. Run it manually to see the cause: ${command.replace(JSON.stringify(file), '/absolute/presenter-matte.webm')}; or supply an existing cutout with --matte.`);
  }
  await fsp.rename(partial, file);
  return {file, sourceSha256, cached: false, command};
}

// Resolve the presenter cutout for an effect whose references/entry.json declares presenterMatte.
// Precedence: --matte file > presenter-matte in --images > --media that already has alpha > generated from --media.
export async function resolvePresenterMatte({policy, matteOption = 'auto', media, imageResolution}) {
  if (!policy) return null;
  const {images, provenance} = imageResolution;
  if (matteOption !== 'auto' && matteOption !== 'off') {
    const file = path.resolve(matteOption);
    images['presenter-matte'] = file;
    provenance['presenter-matte'] = {origin: 'user-matte', sha256: await fileSha256(file)};
    return provenance['presenter-matte'];
  }
  if (images['presenter-matte']) return provenance['presenter-matte'];
  if (media && hasAlphaChannel(media)) {
    const file = path.resolve(media);
    images['presenter-matte'] = file;
    provenance['presenter-matte'] = {origin: 'user-media-alpha', sha256: await fileSha256(file)};
    return provenance['presenter-matte'];
  }
  if (matteOption === 'off' || !media) {
    if (policy === 'required') throw new Error('This effect needs a presenter cutout aligned with the footage. Pass --media so one is generated with HyperFrames remove-background, or supply an existing cutout with --matte /absolute/presenter-matte.webm.');
    return null;
  }
  const generated = await generatePresenterMatte(path.resolve(media));
  images['presenter-matte'] = generated.file;
  provenance['presenter-matte'] = {origin: 'generated-remove-background', tool: `${REMOVE_BACKGROUND_CLI} remove-background --quality best`, sourceSha256: generated.sourceSha256, sha256: await fileSha256(generated.file), cached: generated.cached};
  return provenance['presenter-matte'];
}
