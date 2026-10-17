export const themes = {
  'white-yellow': {name:'White & Yellow',bg:'#F9F9F4',surface:'#FFFFFF',ink:'#18201D',muted:'#58615A',accent:'#F4CE36','accent-ink':'#18201D',rule:'#D8DED5',radius:'20px',shadow:'0 8px 24px #18201D08'},
  'charcoal-lime': {name:'Charcoal & Lime',bg:'#111411',surface:'#1C211D',ink:'#F6F8EF',muted:'#B6C3B6',accent:'#CAED79','accent-ink':'#18201D',rule:'#39463D',radius:'20px',shadow:'0 8px 24px #00000024'},
  'paper-orange': {name:'Paper & Orange',bg:'#F5EDE0',surface:'#FFFCF6',ink:'#30281F',muted:'#71614F',accent:'#E36F3D','accent-ink':'#201811',rule:'#D2BFA7',radius:'24px',shadow:'0 8px 24px #30281F09'},
  // Retain the existing style ID so saved commands and fourth-preview URLs keep working.
  'midnight-ice': {name:'Black & White',bg:'#111111',surface:'#1D1D1D',ink:'#F5F5F5',muted:'#B5B5B5',accent:'#F0F0F0','accent-ink':'#141414',rule:'#414141',radius:'18px',shadow:'0 8px 24px #00000024'},
};
const darkStyles=new Set(['charcoal-lime','midnight-ice']);
const stack=(primary,fallback)=>[...new Set([primary,...fallback])].map(f=>`"${f}"`).join(',');

export function themeCSS(style='white-yellow', overrides={}, {cjkFallback=[]}={}) {
  if (!themes[style]) throw new Error(`Unknown style: ${style}. Choose ${Object.keys(themes).join(', ')}.`);
  const t={...themes[style],...overrides};
  for(const [key,value] of Object.entries(overrides)) {
    if(!['bg','surface','ink','muted','accent','accent-ink','rule','radius','shadow','font','monoFont'].includes(key)) throw new Error(`Unknown style token: ${key}`);
    if(/[{};<>]/.test(String(value))) throw new Error(`Invalid style token: ${key}`);
  }
  const grid=darkStyles.has(style)
    ? 'linear-gradient(90deg,#FFFFFF0B 1px,transparent 1px) center/64px 64px,linear-gradient(#FFFFFF0B 1px,transparent 1px) center/64px 64px,linear-gradient(90deg,#FFFFFF06 1px,transparent 1px) center/320px 320px,linear-gradient(#FFFFFF06 1px,transparent 1px) center/320px 320px,var(--bg)'
    : 'var(--bg)';
  return `:root{${Object.entries(t).filter(([k])=>!['name','nameZh','font','monoFont'].includes(k)).map(([k,v])=>`--${k}:${v}`).join(';')};--font:${stack(t.font||'Inter',cjkFallback)};--mono:${stack(t.monoFont||'IBM Plex Mono',cjkFallback)};--canvas-bg:${grid};}
*{box-sizing:border-box}html,body{margin:0;width:1920px;height:1080px;overflow:hidden;background:var(--bg);color:var(--ink);font-family:var(--font),"Noto Sans SC",sans-serif;font-weight:450;font-optical-sizing:auto;font-synthesis:none;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}#composition{width:1920px;height:1080px;position:relative;overflow:hidden;background:var(--canvas-bg)}
.scene-content{width:100%;height:100%;padding:80px 96px;display:flex;flex-direction:column;gap:24px;box-sizing:border-box}h1,h2,h3,p{margin:0}h1,h2,h3{font-weight:650;letter-spacing:-.022em}svg{overflow:visible}.mono{font-family:var(--mono),"Noto Sans SC",monospace;font-variant-numeric:tabular-nums}.eyebrow{font:400 24px/1.3 var(--mono),monospace;text-transform:uppercase;letter-spacing:.09em}.headline{font-size:100px;line-height:1.08;font-weight:680;letter-spacing:-.028em}.muted{color:var(--muted)}.accent{color:var(--accent)}.panel{background:var(--surface);border:1.5px solid var(--rule);border-radius:var(--radius);box-shadow:var(--shadow)}.accent-panel{background:var(--accent);color:var(--accent-ink)}.rule{height:2px;background:var(--rule)}
`;
}

// These are opaque canvas planes, not cards, labels, photo masks, or transition tiles.
// Apply after effect styles so their background shorthand cannot erase the grid.
export function canvasCSS(style) {
  if(!darkStyles.has(style)) return '#composition #poly-middle{background:linear-gradient(90deg,#FFFFFF0B 1px,transparent 1px) center/64px 64px,linear-gradient(#FFFFFF0B 1px,transparent 1px) center/64px 64px,var(--ink)}';
  return '#composition :is(.browser-stage,.stamp-stage,.stamp-next,.slide-page,.scan-viewport,.swap-chart,.list-copy,.response-copy,.status-copy,.polygon-scene:not(#poly-middle),.burst-stage,.burst-statement,.tags-copy,.pressure-after,.takeover-cover,.flip-stage,.tile-statement){background:var(--canvas-bg)}';
}
