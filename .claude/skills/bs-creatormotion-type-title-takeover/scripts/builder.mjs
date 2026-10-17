import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {themes,themeCSS,canvasCSS} from './themes.mjs';

export const esc = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const sha = data=>crypto.createHash('sha256').update(data).digest('hex');
const hasChinese = value=>/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(JSON.stringify(value??''));
// Chinese content defaults to Smiley Sans (Deyi Hei); Noto Sans SC stays behind it for rare characters.
const zhFonts = {'smiley-sans':'Smiley Sans','noto-sans-sc':'Noto Sans SC'};

export async function createComposition({effect,out,assets,style='white-yellow',data={},media,images={},overrides={},fontFile,zhFont='smiley-sans',designPath,skillPath}) {
  if(!zhFonts[zhFont])throw new Error(`Unknown --zh-font ${zhFont}. Choose ${Object.keys(zhFonts).join(', ')}.`);
  if(!effect.meta?.slug||typeof effect.default!=='function')throw new Error('Effect requires meta.slug and a default build function.');
  const selected=themes[style];if(!selected)throw new Error(`Unknown style ${style}`);
  const slug=effect.meta.slug;
  const resolved=path.resolve(out);
  await fs.mkdir(resolved,{recursive:true});
  await fs.mkdir(path.join(resolved,'assets'),{recursive:true});
  await fs.cp(path.join(assets,'fonts'),path.join(resolved,'assets/fonts'),{recursive:true});
  // Keep explicit faces in the composition so the strict renderer sees them too.
  const bundledFontCSS=(await Promise.all(['inter.css','noto-sans-sc.css','ibm-plex-mono.css','smiley-sans.css'].map(async file=>(await fs.readFile(path.join(assets,'fonts',file),'utf8')).replace(/url\(([^)]+)\)/g,'url(assets/fonts/$1)')))).join('\n');
  await fs.copyFile(path.join(assets,'gsap.min.js'),path.join(resolved,'assets/gsap.min.js'));
  let customFontCSS='';
  if(fontFile){
    const extension=path.extname(fontFile).toLowerCase();
    if(!['.woff2','.woff','.ttf','.otf'].includes(extension))throw new Error('Custom font must be WOFF2, WOFF, TTF or OTF.');
    overrides={...overrides,font:overrides.font||'Custom Font'};
    await fs.copyFile(fontFile,path.join(resolved,'assets','custom-font'+extension));
    customFontCSS=`@font-face{font-family:"${overrides.font}";src:url("assets/custom-font${extension}");font-weight:100 900;font-display:block;}`;
  }
  let mediaPath='';
  if(media){const ext=path.extname(media)||'.mp4';mediaPath='assets/presenter'+ext;}
  const imagePaths={};
  for(const [name,input] of Object.entries(images)){
    if(!/^[a-z0-9_-]+$/i.test(name))throw new Error(`Invalid image key ${name}`);
    imagePaths[name]=`assets/${name}${path.extname(input)}`;
  }
  const content={...effect.defaults,...data};
  const chinese=hasChinese(content);
  const typography={language:chinese?'zh':'en',font:fontFile||overrides.font?overrides.font:chinese?zhFonts[zhFont]:'Inter',source:fontFile?'custom-file':overrides.font?'override':chinese?'zh-default':'default'};
  // Mono labels and a Latin custom font still need the Chinese face for CJK glyphs.
  const cjkFallback=chinese?[zhFonts[zhFont]]:[];
  if(chinese&&typography.source==='zh-default')overrides={...overrides,font:zhFonts[zhFont]};
  const result=effect.default({data:content,media:mediaPath,images:imagePaths,esc,theme:{...selected,...overrides},style});
  if(!result.html||!result.js||!Number.isFinite(result.duration)||result.duration<=0)throw new Error(`Invalid composition result from ${slug}`);
  if(result.html.includes('src="undefined"')||result.html.includes('src=""'))throw new Error('A required media input is missing.');
  const assetReferences=result.html+'\n'+(result.css||'')+'\n'+result.js;
  if(mediaPath&&assetReferences.includes(mediaPath))await fs.copyFile(media,path.join(resolved,mediaPath));
  for(const [name,target] of Object.entries(imagePaths))if(assetReferences.includes(target))await fs.copyFile(images[name],path.join(resolved,target));
  const metadata={slug,style,duration:result.duration,width:1920,height:1080,fps:30,typography,content,overrides};
  const html=`<!doctype html>\n<html lang="${chinese?'zh-CN':'en'}"><head><meta charset="utf-8"><title>${esc(effect.meta.name)} · ${esc(selected.name)}</title><style>${bundledFontCSS}\n${themeCSS(style,overrides,{cjkFallback})}\n${customFontCSS}\n${result.css||''}\n${canvasCSS(style)}</style></head><body><div id="composition" data-composition-id="${slug}" data-start="0" data-duration="${result.duration}" data-width="1920" data-height="1080" data-fps="30">${result.html}</div><script src="assets/gsap.min.js"></script><script>\nconst tl=gsap.timeline({paused:true,defaults:{ease:'power3.out'}});\n${result.js}\nwindow.__timelines=window.__timelines||{};window.__timelines[${JSON.stringify(slug)}]=tl;\n</script></body></html>`;
  await fs.writeFile(path.join(resolved,'index.html'),html);
  await fs.writeFile(path.join(resolved,'hyperframes.json'),JSON.stringify({$schema:'https://hyperframes.heygen.com/schema/hyperframes.json',registry:'https://raw.githubusercontent.com/heygen-com/hyperframes/main/registry',paths:{blocks:'compositions',components:'compositions/components',assets:'assets'},media:{autoProxy:false},skill:slug},null,2));
  await fs.writeFile(path.join(resolved,'package.json'),JSON.stringify({name:slug,private:true,type:'module',scripts:{preview:'npx --yes hyperframes@0.8.30 preview',check:'npx --yes hyperframes@0.8.30 check',render:'npx --yes hyperframes@0.8.30 render --fps 30 --quality high --strict'}},null,2));
  if(designPath)await fs.copyFile(designPath,path.join(resolved,'DESIGN.md'));
  const skillHash=skillPath?sha(await fs.readFile(skillPath)):null;
  await fs.writeFile(path.join(resolved,'build.json'),JSON.stringify({...metadata,builtAt:new Date().toISOString(),htmlSha256:sha(html),skillSha256:skillHash},null,2));
  return {...metadata,out:resolved,htmlSha256:sha(html),skillSha256:skillHash};
}
