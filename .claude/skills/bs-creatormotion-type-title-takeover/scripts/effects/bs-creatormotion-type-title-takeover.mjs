export const meta={slug:'bs-creatormotion-type-title-takeover',name:'Title Scene Takeover',category:'type',duration:5.4,description:'An oversized condensed headline punches in behind a presenter. A clean edit removes the presenter while the same lettering holds its scale and position.'};
export const defaults={title:'BUILD WITH US',supportingLine:'One small project every week'};
export default function build({data:d,media,images={},esc:e}) {
  if(!images['presenter-matte']) throw new Error('An aligned presenter-matte alpha video is required.');
  const title=String(d.title??defaults.title).trim();
  if(!title) throw new Error('A short title is required.');
  if([...title].length>32) throw new Error('Keep the takeover title to 32 characters or fewer; this is an oversized headline, not a paragraph.');
  const hasCjk=/[\u3400-\u9fff]/u.test(title);
  const fontSize=hasCjk?420:500;
  const baseline=hasCjk?668:673;
  return {
    duration:5.4,
    html:`<video id="takeover-base" class="takeover-video" src="${e(media)}" muted playsinline data-start="0" data-duration="1.8" data-track-index="0"></video>
<div id="takeover-grade" class="takeover-grade"></div>
<div id="takeover-cover" class="takeover-cover"></div>
<section class="scene-content takeover-type-stage"><div id="takeover-title" data-layout-allow-occlusion class="takeover-title"><svg role="img" aria-label="${e(title)}" viewBox="0 0 1920 1080" width="1920" height="1080"><text x="960" y="${baseline}" text-anchor="middle" textLength="1680" lengthAdjust="spacingAndGlyphs" font-size="${fontSize}" transform="translate(40 0) skewX(-4)">${e(title)}</text></svg></div></section>
<div id="takeover-subject" class="takeover-subject"><video id="takeover-matte" class="takeover-video" src="${e(images['presenter-matte'])}" muted playsinline data-start="0" data-duration="1.8" data-track-index="1"></video></div>
<section class="scene-content takeover-support-stage"><p id="takeover-support">${e(d.supportingLine??'')}</p></section>`,
    css:`.takeover-video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:50% 50%;transform:translateX(-150px) scale(1.5);transform-origin:58% 34%}.takeover-subject{position:absolute;inset:0}.takeover-grade{position:absolute;inset:0;background:#000;opacity:.35}.takeover-cover{position:absolute;inset:0;background:var(--bg);opacity:0}.takeover-type-stage{position:absolute;inset:0;padding:0;justify-content:center;align-items:center;pointer-events:none}.takeover-title{width:1920px;height:1080px;transform-origin:50% 48%;color:#F5F5F5}.takeover-title svg{display:block;width:100%;height:100%;overflow:visible}.takeover-title text{font-family:var(--font),"Noto Sans SC",sans-serif;font-weight:850;letter-spacing:-.025em;fill:currentColor}.takeover-support-stage{position:absolute;inset:0;padding:785px 146px 90px 96px;align-items:flex-end;justify-content:flex-start;pointer-events:none}.takeover-support-stage p{max-width:1550px;font-size:43px;line-height:1.2;font-weight:450;letter-spacing:-.018em;text-align:right;color:var(--ink);opacity:0}`,
    js:`tl.fromTo('#takeover-title',{scale:.67,opacity:0},{scale:1.035,opacity:1,duration:.23,ease:'expo.out'},.36);
tl.fromTo('#takeover-title',{scale:1.035},{scale:1,duration:.17,ease:'power2.out',immediateRender:false},.59);
tl.set(['#takeover-base','#takeover-subject','#takeover-grade'],{opacity:0},1.8);
tl.set('#takeover-cover',{opacity:1},1.8);
tl.set('#takeover-title',{color:'var(--ink)'},1.8);
tl.fromTo('#takeover-support',{opacity:1,clipPath:'inset(0 100% 0 0)'},{opacity:1,clipPath:'inset(0 0% 0 0)',duration:.27,ease:'power2.out',immediateRender:false},2.08);
`
  };
}
