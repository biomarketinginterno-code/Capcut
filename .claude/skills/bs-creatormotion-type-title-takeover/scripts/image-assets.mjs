import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const validKey = value => typeof value === 'string' && /^[a-z0-9_-]+$/i.test(value) && !['__proto__', 'constructor', 'prototype'].includes(value);

export async function readDefaultImageManifest(manifestPath) {
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  if (manifest.schemaVersion !== 1 || !record(manifest.assets) || !record(manifest.effects)) {
    throw new Error('Invalid default-image manifest: expected schemaVersion 1, assets and effects.');
  }
  for (const [slug, slots] of Object.entries(manifest.effects)) {
    if (!validKey(slug) || !record(slots)) throw new Error('Invalid default-image effect mapping: ' + slug);
    for (const [slot, assetId] of Object.entries(slots)) {
      if (!validKey(slot) || !validKey(assetId) || !Object.hasOwn(manifest.assets, assetId)) {
        throw new Error(`Invalid default-image slot ${slug}.${slot}`);
      }
    }
  }
  return manifest;
}

export async function verifyDefaultImage(manifestPath, assetId, asset) {
  if (!validKey(assetId) || !record(asset) || asset.kind !== 'generated-image' || asset.redistributable !== true) {
    throw new Error('Default image must be a redistributable generated image: ' + assetId);
  }
  if (typeof asset.file !== 'string' || !/^[a-z0-9][a-z0-9._-]*\.(png|jpe?g|webp)$/i.test(asset.file)) {
    throw new Error('Default image file must be a relative raster filename: ' + assetId);
  }
  if (!/^[a-f0-9]{64}$/.test(asset.sha256 || '') || typeof asset.provider !== 'string' || !asset.provider.trim()) {
    throw new Error('Default image requires a SHA-256 and recorded generation provider: ' + assetId);
  }
  const file = path.join(path.dirname(manifestPath), asset.file);
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Default image must be a regular local file: ' + assetId);
  const bytes = await fs.readFile(file);
  if (hash(bytes) !== asset.sha256) throw new Error('Default image checksum mismatch: ' + assetId);
  const extension = path.extname(asset.file).toLowerCase();
  const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const webp = bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (!(extension === '.png' ? png : extension === '.webp' ? webp : jpeg)) {
    throw new Error('Default image bytes do not match its raster extension: ' + assetId);
  }
  return file;
}

export async function resolveImageAssets({manifestPath, slug, userImagesPath}) {
  const manifest = await readDefaultImageManifest(manifestPath);
  const images = {};
  const provenance = {};
  const slots = manifest.effects[slug] || {};
  const absoluteUserMap = userImagesPath ? path.resolve(userImagesPath) : null;
  const supplied = absoluteUserMap ? JSON.parse(await fs.readFile(absoluteUserMap, 'utf8')) : {};
  if (!record(supplied)) throw new Error('--images must contain an object mapping image keys to local paths.');
  for (const [slot, assetId] of Object.entries(slots)) {
    if (Object.hasOwn(supplied, slot)) continue;
    const asset = manifest.assets[assetId];
    images[slot] = await verifyDefaultImage(manifestPath, assetId, asset);
    provenance[slot] = {origin: 'bundled-default', assetId, provider: asset.provider, sha256: asset.sha256};
  }
  if (absoluteUserMap) {
    for (const [slot, suppliedPath] of Object.entries(supplied)) {
      if (!validKey(slot) || typeof suppliedPath !== 'string' || !suppliedPath.trim() || /^[a-z]+:\/\//i.test(suppliedPath)) {
        throw new Error('Invalid user image path for ' + slot + '. Use a local path; relative paths resolve beside the image-map JSON.');
      }
      const file = path.resolve(path.dirname(absoluteUserMap), suppliedPath);
      const bytes = await fs.readFile(file);
      images[slot] = file;
      provenance[slot] = {origin: 'user-override', sha256: hash(bytes)};
    }
  }
  return {images, provenance};
}

export async function recordImageAssets(out, resolution) {
  const html = await fs.readFile(path.join(out, 'index.html'), 'utf8');
  const assets = Object.entries(resolution.images).flatMap(([slot, file]) => {
    const target = `assets/${slot}${path.extname(file)}`;
    return html.includes(target) ? [{slot, file: target, ...resolution.provenance[slot]}] : [];
  });
  const report = {schemaVersion: 1, precedence: 'user-override > bundled-default', assets};
  await fs.writeFile(path.join(out, 'image-assets.json'), JSON.stringify(report, null, 2) + '\n');
  const buildPath = path.join(out, 'build.json');
  const build = JSON.parse(await fs.readFile(buildPath, 'utf8'));
  await fs.writeFile(buildPath, JSON.stringify({...build, imageAssets: report}, null, 2) + '\n');
  return report;
}
