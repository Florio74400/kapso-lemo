// Page d'invitation LEMO : aperçu WhatsApp (Open Graph), puis écran épuré (logo, Bienvenue, prénom),
// « Hello <prénom> · Early adopter », et transfert vers WhatsApp avec le message prérempli.
// En fond, une très grande sphère de données (verbatims, émotions, tendances) à faible opacité, qui tourne lentement.

import fs from 'node:fs';

const logoSvg = fs.readFileSync(new URL('../public/lemo-logo.svg', import.meta.url), 'utf8');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const HELLO_MS = 4200; // durée d'affichage de « Hello … Early adopter » avant le transfert

export function invitePage({ wa, waNumber = '', base, inviter = null, code = null }) {
  const title = inviter ? `${inviter} t'invite sur LEMO` : 'Vous êtes invité sur LEMO';
  const desc = "Invitation privée d'un membre LEMO.";
  const sub = inviter ? `Invitation personnelle de ${inviter}` : 'Invitation personnelle';
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="theme-color" content="#FFFFFF">
<meta property="og:type" content="website">
<meta property="og:site_name" content="LEMO">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(base)}/public/lemo-invite.png">
<meta property="og:image:width" content="600"><meta property="og:image:height" content="600">
<meta property="og:url" content="${esc(base)}/i${code ? `/${esc(code)}` : ''}">
<meta name="twitter:card" content="summary">
<link rel="preload" href="/public/montserrat.woff2" as="font" type="font/woff2" crossorigin>
<style>
@font-face{font-family:'Montserrat';font-style:normal;font-weight:100 900;font-display:swap;src:url(/public/montserrat.woff2) format('woff2')}
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;background:#fff;color:#1A1A1A;overflow:hidden}
body{font-family:"Montserrat","Helvetica Neue",Arial,sans-serif;-webkit-font-smoothing:antialiased}
canvas{position:fixed;inset:0;width:100%;height:100%;display:block}
.veil{position:fixed;inset:0;background:#fff;opacity:0;pointer-events:none;transition:opacity .4s ease;z-index:5}
.veil.on{opacity:1}
.panel{position:fixed;inset:0;z-index:3;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;text-align:center;opacity:0;animation:in 1s .2s ease forwards}
.logo{color:#1A1A1A}.logo svg{height:46px;width:auto;display:block}
h1{margin-top:34px;font-size:30px;line-height:1.2;font-weight:600;letter-spacing:-.02em}
.sub{margin-top:10px;font-size:11px;font-weight:600;letter-spacing:.28em;text-transform:uppercase;color:#4553C7;padding-left:.28em}
form{margin-top:34px;width:100%;max-width:320px;display:flex;flex-direction:column;gap:10px}
input{font:500 16px "Montserrat",Arial,sans-serif;width:100%;padding:14px 16px;border:1px solid #E2E2E8;border-radius:10px;background:rgba(255,255,255,.9);color:#1A1A1A;outline:none;text-align:center;-webkit-appearance:none}
input::placeholder{color:#A8A8B4}
input:focus{border-color:#6B7CFF;box-shadow:0 0 0 4px rgba(107,124,255,.12)}
button{font:600 15px "Montserrat",Arial,sans-serif;width:100%;padding:14px 16px;border:0;border-radius:10px;color:#fff;background:#1A1A1A;cursor:pointer}
button:disabled{opacity:.6}
.hello{display:none}.hi .welcome{display:none}.hi .hello{display:block}
.hello h2{margin-top:34px;font-size:30px;font-weight:600;letter-spacing:-.02em;opacity:0;animation:in .7s ease forwards}
.badge{display:inline-block;margin-top:18px;padding:9px 18px;border-radius:99px;border:1px solid #DADDFB;background:rgba(245,246,255,.9);font-size:12px;font-weight:700;letter-spacing:.32em;text-transform:uppercase;color:#2F3DA8;padding-right:calc(18px - .32em);opacity:0;animation:in .7s .5s ease forwards}
.hello p{margin-top:26px;font-size:14px;color:#777;opacity:0;animation:in .7s 1.6s ease forwards}
@keyframes in{to{opacity:1}}
@media (min-width:900px){.logo svg{height:56px}h1,.hello h2{font-size:36px}.sub{font-size:12px}}
@media (prefers-reduced-motion:reduce){.panel,.hello h2,.badge,.hello p{animation:none;opacity:1}}
</style>
</head><body>
<canvas id="cv" aria-hidden="true"></canvas>
<section class="panel" id="panel" aria-live="polite">
  <div class="logo">${logoSvg}</div>
  <div class="welcome">
    <h1>Bienvenue</h1>
    <div class="sub">${esc(sub)}</div>
    <form id="ask" autocomplete="on"><input id="name" name="given-name" autocomplete="given-name" placeholder="Prénom" maxlength="30" required aria-label="Prénom"><button type="submit">Continuer</button></form>
  </div>
  <div class="hello"><h2>Hello <span id="hn"></span></h2><div class="badge">Early adopter</div><p>Tu vas être transféré sur WhatsApp.</p></div>
</section>
<div class="veil" id="veil"></div>
<script>
(function(){
  var WA=${JSON.stringify(wa)},NUM=${JSON.stringify(String(waNumber))},CODE=${JSON.stringify(code || '')},HELLO=${HELLO_MS};
  var reduced=window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;
  var cv=document.getElementById('cv'),ctx=cv.getContext('2d');
  var W,H,DPR,CX,CY,R,mobile;
  var INK=['#2F3DA8','#4553C7','#6B7CFF','#E8734F'];
  var OPACITY=0.26;
  var MONO='ui-monospace,SFMono-Regular,Menlo,Consolas,monospace';
  function rgba(c,a){var r=parseInt(c.slice(1,3),16),g=parseInt(c.slice(3,5),16),b=parseInt(c.slice(5,7),16);return 'rgba('+r+','+g+','+b+','+a+')'}
  function layout(){
    DPR=Math.min(window.devicePixelRatio||1,2);W=innerWidth;H=innerHeight;mobile=W<700;
    cv.width=W*DPR;cv.height=H*DPR;ctx.setTransform(DPR,0,0,DPR,0,0);
    CX=W/2;CY=H/2;R=mobile?W*0.8:H*0.62; // plus grande que l'écran : elle déborde, mais on devine encore sa courbe
  }
  layout();addEventListener('resize',layout);
  var N=mobile?1600:2600,pts=[];
  for(var i=0;i<N;i++){
    var shell=Math.random()<0.6,r=shell?(0.93+Math.random()*0.07):Math.pow(Math.random(),0.42);
    var y=1-(i+0.5)/N*2,rad=Math.sqrt(Math.max(0,1-y*y)),th=Math.PI*(1+Math.sqrt(5))*i;
    pts.push({x:Math.cos(th)*rad*r,y:y*r,z:Math.sin(th)*rad*r,c:INK[(Math.random()*4)|0],s:0.5+Math.random()});
  }
  // Chaque point est une donnée : un verbatim, une émotion, une tendance.
  var LABELS=['verbatim #48 213','joie · 0,82','tendance +14 %','attente −6 min','intensité 0,77','frustration · 0,31','1 284 moments / h','satisfaction +9 %','vocal · 00:21','surprise · 0,64','signal faible ↑','gratitude · 0,88','irritant ↓ 12 %','verbatim #48 219'];
  function ease(t){return t<0?0:t>1?1:1-Math.pow(1-t,3)}
  function label(str,x,y,align){var w=ctx.measureText(str).width,m=12,l=align==='right'?x-w:x;l=Math.max(m,Math.min(W-m-w,l));ctx.fillText(str,l,y)}
  var start=performance.now(),proj=new Array(N);
  var tagged=[];for(var k=0;k<(mobile?6:10);k++)tagged.push({i:(Math.random()*N)|0,t0:0.6+k*0.9,label:LABELS[k%LABELS.length]});
  function frame(now){
    var t=(now-start)/1000,appear=reduced?1:ease(t/1.6);
    var ang=t*0.035+0.6,tilt=0.42,ca=Math.cos(ang),sa=Math.sin(ang),ct=Math.cos(tilt),st=Math.sin(tilt);
    var RR=R*(0.94+0.06*appear);
    ctx.clearRect(0,0,W,H);
    for(var i=0;i<N;i++){var p=pts[i],x1=p.x*ca-p.z*sa,z1=p.x*sa+p.z*ca,y2=p.y*ct-z1*st,z2=p.y*st+z1*ct;proj[i]=[x1,y2,z2,p,i]}
    var order=proj.slice().sort(function(a,b){return a[2]-b[2]});
    for(var j=0;j<N;j++){
      var q=order[j],p=q[3],persp=1/(1+q[2]*0.34),depth=(q[2]+1)/2;
      var X=CX+q[0]*RR*persp,Y=CY+q[1]*RR*persp;
      if(X<-10||X>W+10||Y<-10||Y>H+10)continue;
      var a=(0.1+depth*0.85)*OPACITY*appear,rr=(mobile?2:2.6)*(0.35+depth*1.15)*persp*p.s;
      ctx.beginPath();ctx.arc(X,Y,Math.max(0.5,rr),0,Math.PI*2);ctx.fillStyle=rgba(p.c,a);ctx.fill();
    }
    // Halo blanc au centre : le texte reste parfaitement lisible.
    var hr=Math.min(W,H)*(mobile?0.62:0.42),wg=ctx.createRadialGradient(CX,CY,0,CX,CY,hr);
    wg.addColorStop(0,'rgba(255,255,255,0.95)');wg.addColorStop(0.6,'rgba(255,255,255,0.7)');wg.addColorStop(1,'rgba(255,255,255,0)');
    ctx.fillStyle=wg;ctx.beginPath();ctx.arc(CX,CY,hr,0,Math.PI*2);ctx.fill();
    ctx.font='500 '+(mobile?9:10)+'px '+MONO;ctx.textBaseline='middle';
    var placed=[];
    tagged.forEach(function(tg){
      var life=((t-tg.t0)%9)/2.2;if(t<tg.t0||life>1)return;
      var q=proj[tg.i];if(q[2]>0.2){tg.i=(tg.i+37)%N;return}
      var persp=1/(1+q[2]*0.34),X=CX+q[0]*RR*persp,Y=CY+q[1]*RR*persp;
      var side=X<CX?-1:1,lx=X+side*18,ly=Y-14;
      // jamais sur le logo, le texte ou le champ prénom, jamais hors de l'écran
      if((Math.abs(ly-CY)<(mobile?190:200)&&Math.abs(lx-CX)<(mobile?W:260))||ly<24||ly>H-24||X<0||X>W){tg.i=(tg.i+37)%N;return}
      if(placed.some(function(o){return Math.abs(o-ly)<22}))return;
      placed.push(ly);
      var al=Math.sin(Math.PI*life)*0.55;
      ctx.strokeStyle='rgba(69,83,199,'+(al*0.45)+')';ctx.lineWidth=0.7;ctx.beginPath();ctx.moveTo(X,Y);ctx.lineTo(lx,ly);ctx.stroke();
      ctx.beginPath();ctx.arc(X,Y,2.2,0,Math.PI*2);ctx.fillStyle='rgba(232,115,79,'+al+')';ctx.fill();
      ctx.fillStyle='rgba(47,61,168,'+al+')';label(tg.label,lx+side*4,ly,side<0?'right':'left');
    });
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  var panel=document.getElementById('panel'),ask=document.getElementById('ask'),inp=document.getElementById('name');
  ask.addEventListener('submit',function(e){
    e.preventDefault();
    var n=(inp.value||'').trim().replace(/[^A-Za-zÀ-ÖØ-öø-ÿ' -]/g,'').slice(0,30);
    if(!n){inp.focus();return}
    n=n.charAt(0).toUpperCase()+n.slice(1);
    inp.blur();ask.querySelector('button').disabled=true;
    document.getElementById('hn').textContent=n;
    panel.classList.add('hi');
    try{navigator.sendBeacon&&navigator.sendBeacon('/i/evt?k=continue'+(CODE?'&c='+encodeURIComponent(CODE):''))}catch(_){}
    var msg="Hey LEMO, c'est "+n+' !'+(CODE?' (invitation '+CODE+')':'');
    var url=NUM?('https://wa.me/'+NUM+'?text='+encodeURIComponent(msg)):WA;
    // le temps de voir « Hello … Early adopter », puis transfert vers WhatsApp
    setTimeout(function(){document.getElementById('veil').classList.add('on')},HELLO-400);
    setTimeout(function(){location.href=url},HELLO);
  });
  addEventListener('pageshow',function(e){if(e.persisted)document.getElementById('veil').classList.remove('on')});
  document.addEventListener('visibilitychange',function(){if(!document.hidden)document.getElementById('veil').classList.remove('on')});
})();
</script>
<noscript><meta http-equiv="refresh" content="0;url=${esc(wa)}"></noscript>
</body></html>`;
}
