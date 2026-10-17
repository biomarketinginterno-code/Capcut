import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createComposition} from './builder.mjs';
import {resolveImageAssets,recordImageAssets} from './image-assets.mjs';
import {resolvePresenterMatte} from './presenter-matte.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
const packageRoot=path.resolve(here,'..');
const args=process.argv.slice(2), options={};
for(let i=0;i<args.length;i++){
  if(args[i]==='--help'){console.log('Create an editable video project: node scripts/create.mjs --out PATH [--data content.json] [--style white-yellow|charcoal-lime|paper-orange|midnight-ice] [--media presenter.mp4] [--images images.json] [--overrides style.json] [--font custom-font.woff2] [--zh-font smiley-sans|noto-sans-sc] [--matte auto|off|presenter-matte.webm] [--skill SLUG for the master router] (midnight-ice selects Black & White). Chinese content defaults to Smiley Sans; --zh-font noto-sans-sc restores Noto Sans SC, and --font always wins. This effect uses a transparent presenter cutout aligned with --media: pass an existing one with --matte, supply footage that already has alpha, or leave --matte auto to generate it with HyperFrames remove-background.');process.exit(0);}
  if(!args[i].startsWith('--')||args[i+1]===undefined)throw new Error('Expected --option value. Run with --help.');
  options[args[i].slice(2)]=args[++i];
}
const config=JSON.parse(await fs.readFile(path.join(packageRoot,'references/entry.json'),'utf8'));
const slug=options.skill||config.slug;
if(!config.allowed.includes(slug))throw new Error(`Choose a supported Skill: ${config.allowed.join(', ')}`);
if(!options.out)throw new Error('--out PATH is required. The output directory contains the editable composition.');
const effect=await import(pathToFileURL(path.join(here,'effects',slug+'.mjs')));
const jsonFile=async file=>file?JSON.parse(await fs.readFile(file,'utf8')):{};
const imageResolution=await resolveImageAssets({manifestPath:path.join(packageRoot,'references/default-images/manifest.json'),slug,userImagesPath:options.images});
await resolvePresenterMatte({policy:config.presenterMatte,matteOption:options.matte||'auto',media:options.media,imageResolution});
const result=await createComposition({effect,out:options.out,assets:path.join(packageRoot,'references/runtime-assets'),style:options.style||'white-yellow',data:await jsonFile(options.data),media:options.media,images:imageResolution.images,overrides:await jsonFile(options.overrides),fontFile:options.font,zhFont:options['zh-font']||'smiley-sans',designPath:path.join(packageRoot,'references/DESIGN.md'),skillPath:path.join(packageRoot,'SKILL.md')});
result.imageAssets=await recordImageAssets(result.out,imageResolution);
console.log(JSON.stringify(result,null,2));
console.log(`Render: npx --yes hyperframes@0.8.30 render ${JSON.stringify(result.out)} --fps 30 --quality high --strict --output ${JSON.stringify(path.join(result.out,'output.mp4'))}`);
