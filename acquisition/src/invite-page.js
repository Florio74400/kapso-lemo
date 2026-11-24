// Page d'invitation LEMO : aperçu WhatsApp (Open Graph) + courte expérience animée, puis ouverture de WhatsApp.
// Animation inspirée de la sphère de la couverture du pitch : les données convergent, la sphère respire,
// puis on plonge dedans. Sobre, fluide sur téléphone, sans dépendance externe.
import fs from 'node:fs';

const logoSvg = fs.readFileSync(new URL('../public/lemo-logo.svg', import.meta.url), 'utf8');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function invitePage({ wa, base, delayMs = 4000 }) {
  const title = 'Vous êtes invité sur LEMO';
  const desc = "Invitation privée d'un membre LEMO. Rien à installer : la conversation s'ouvre directement sur WhatsApp.";
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
<meta property="og:url" content="${esc(base)}/i">
<meta name="twitter:card" content="summary">
<link rel="preload" href="/public/montserrat.woff2" as="font" type="font/woff2" crossorigin>
<style>
@font-face{font-family:'Montserrat';font-style:normal;font-weight:100 900;font-display:swap;src:url(/public/montserrat.woff2) format('woff2')}
:root{--ink:#1A1A1A;--g700:#555;--g500:#888;--blue:#6B7CFF;--blue-print:#4553C7;--warm:#E8856B}
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;background:#fff;color:var(--ink)}
body{font-family:"Montserrat","Helvetica Neue",Arial,sans-serif;font-weight:300;-webkit-font-smoothing:antialiased;overflow:hidden}
canvas{position:fixed;inset:0;width:100%;height:100%;display:block}
.veil{position:fixed;inset:0;background:#fff;opacity:0;pointer-events:none;transition:opacity .6s ease}
.veil.on{opacity:1}
header{position:fixed;top:max(22px,env(safe-area-inset-top));left:24px;right:24px;display:flex;justify-content:space-between;align-items:center;z-index:3}
.logo{height:26px;color:var(--ink)}.logo svg{height:26px;width:auto;display:block}
.tag{font-size:11px;font-weight:600;letter-spacing:.22em;text-transform:uppercase;color:var(--g500)}
.copy{position:fixed;z-index:3;left:24px;right:24px;bottom:max(28px,env(safe-area-inset-bottom));opacity:0;transform:translateY(10px);animation:rise .9s .25s cubic-bezier(.2,.7,.2,1) forwards}
.bar{width:48px;height:3px;background:linear-gradient(90deg,var(--blue-print),var(--warm))}
.kicker{margin-top:16px;font-size:11px;font-weight:600;letter-spacing:.24em;text-transform:uppercase;color:var(--blue-print)}
h1{margin-top:10px;font-size:27px;line-height:1.12;letter-spacing:-.025em;font-weight:700}
h1 .light{display:block;font-weight:300;color:var(--g500);font-size:.8em;margin-top:2px}
@media (max-height:700px){.hint{display:none}.cta{margin-top:14px}h1{font-size:24px}}
.status{margin-top:16px;font-size:14px;color:var(--g700);min-height:1.4em;transition:opacity .35s}
.progress{margin-top:12px;height:2px;background:#EEE;border-radius:2px;overflow:hidden}
.progress i{display:block;height:100%;width:0;background:linear-gradient(90deg,var(--blue-print),var(--warm));transition:width linear}
.cta{display:inline-flex;align-items:center;gap:10px;margin-top:20px;padding:14px 26px;border-radius:999px;background:linear-gradient(90deg,var(--blue-print),var(--warm));color:#fff;font-weight:600;font-size:15px;text-decoration:none;box-shadow:0 8px 24px rgba(69,83,199,.22);transition:transform .2s}
.cta:active{transform:scale(.98)}.cta svg{width:18px;height:18px}
.hint{margin-top:10px;font-size:12px;color:var(--g500)}
@keyframes rise{to{opacity:1;transform:none}}
@media (min-width:900px){
  header{top:48px;left:72px;right:72px}.logo,.logo svg{height:34px}.tag{font-size:12px}
  .copy{left:72px;right:auto;bottom:auto;top:50%;width:min(520px,40vw);transform:translateY(calc(-50% + 10px));animation-name:riseD}
  @keyframes riseD{to{opacity:1;transform:translateY(-50%)}}
  h1{font-size:52px;margin-top:16px}h1 .light{font-size:1em}.kicker{font-size:13px;margin-top:22px}.bar{width:64px;height:4px}
  .status{font-size:16px;margin-top:22px}.cta{font-size:16px;padding:15px 30px}
}
@media (prefers-reduced-motion:reduce){.copy{animation:none;opacity:1;transform:none}@media (min-width:900px){.copy{transform:translateY(-50%)}}}
</style>
</head><body>
<canvas id="cv" aria-hidden="true"></canvas>
<header><div class="logo">${logoSvg}</div><div class="tag">Invitation privée</div></header>
<main class="copy">
  <div class="bar"></div>
  <div class="kicker">Vous êtes invité</div>
  <h1>Bienvenue dans LEMO.<span class="light">Le registre des moments vécus.</span></h1>
  <p class="status" id="status" aria-live="polite">Connexion au moteur…</p>
  <div class="progress"><i id="prog"></i></div>
  <a class="cta" id="go" href="${esc(wa)}">Ouvrir la conversation <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></a>
  <p class="hint">WhatsApp s'ouvre automatiquement. Rien à installer.</p>
</main>
<div class="veil" id="veil"></div>
<script>
(function(){
  var WA=${JSON.stringify(wa)}, DELAY=${Number(delayMs)};
  var reduced=window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;
  var cv=document.getElementById('cv'),ctx=cv.getContext('2d');
  var W,H,DPR,CX,CY,R,mobile;
  var INK=['#2F3DA8','#4553C7','#6B7CFF','#E8734F'];
  function rgba(c,a){var r=parseInt(c.slice(1,3),16),g=parseInt(c.slice(3,5),16),b=parseInt(c.slice(5,7),16);return 'rgba('+r+','+g+','+b+','+a+')'}
  function layout(){
    DPR=Math.min(window.devicePixelRatio||1,2);W=innerWidth;H=innerHeight;mobile=W<900;
    cv.width=W*DPR;cv.height=H*DPR;ctx.setTransform(DPR,0,0,DPR,0,0);
    if(mobile){
      // la sphère occupe l'espace libre entre l'en-tête et le texte, sans jamais le chevaucher
      var top=document.querySelector('header').getBoundingClientRect().bottom+16;
      var bottom=document.querySelector('.copy').getBoundingClientRect().top-24;
      var avail=Math.max(120,bottom-top);
      CX=W/2;CY=top+avail/2;R=Math.min(W*0.38,avail*0.42);
    }else{CX=W*0.68;CY=H*0.5;R=Math.min(H*0.3,W*0.2)}
  }
  layout();addEventListener('resize',layout);
  if(document.fonts&&document.fonts.ready)document.fonts.ready.then(layout);
  // Sphère de points (même principe que la couverture du pitch), chaque point arrive de l'extérieur.
  var N=mobile?1300:2400,pts=[];
  for(var i=0;i<N;i++){
    var shell=Math.random()<0.6,r=shell?(0.93+Math.random()*0.07):Math.pow(Math.random(),0.42);
    var y=1-(i+0.5)/N*2,rad=Math.sqrt(Math.max(0,1-y*y)),th=Math.PI*(1+Math.sqrt(5))*i;
    var a=Math.random()*Math.PI*2,d=1.6+Math.random()*2.4;
    pts.push({x:Math.cos(th)*rad*r,y:y*r,z:Math.sin(th)*rad*r,c:INK[(Math.random()*4)|0],s:0.5+Math.random(),
      sx:Math.cos(a)*d,sy:Math.sin(a)*d,delay:Math.random()*0.45});
  }
  function ease(t){return t<0?0:t>1?1:1-Math.pow(1-t,3)}
  function easeIn(t){return t<0?0:t>1?1:t*t*t}
  var start=performance.now(),proj=new Array(N);
  function frame(now){
    var t=(now-start)/1000,T=DELAY/1000;
    var dive=reduced?0:easeIn((t-(T-1.0))/1.0);
    var k=1+dive*4.5,RR=R*k,ang=t*0.22+dive*0.8,tilt=0.4;
    var ca=Math.cos(ang),sa=Math.sin(ang),ct=Math.cos(tilt),st=Math.sin(tilt);
    ctx.clearRect(0,0,W,H);
    // halo qui respire
    var breath=0.07+0.03*Math.sin(t*2.2);
    var g=ctx.createRadialGradient(CX,CY,0,CX,CY,RR*1.7);
    g.addColorStop(0,rgba('#6B7CFF',breath*(1-dive)));g.addColorStop(0.55,rgba('#6B7CFF',breath*0.3*(1-dive)));g.addColorStop(1,rgba('#6B7CFF',0));
    ctx.fillStyle=g;ctx.beginPath();ctx.arc(CX,CY,RR*1.7,0,Math.PI*2);ctx.fill();
    for(var i=0;i<N;i++){
      var p=pts[i],x1=p.x*ca-p.z*sa,z1=p.x*sa+p.z*ca,y2=p.y*ct-z1*st,z2=p.y*st+z1*ct;
      proj[i]=[x1,y2,z2,p];
    }
    proj.sort(function(a,b){return a[2]-b[2]});
    for(var j=0;j<N;j++){
      var q=proj[j],p=q[3];
      var persp=1/(1+q[2]*0.34),depth=(q[2]+1)/2;
      var u=reduced?1:ease((t-p.delay)/1.4);
      var tx=CX+q[0]*RR*persp,ty=CY+q[1]*RR*persp;
      var X=tx+(1-u)*p.sx*R*1.2,Y=ty+(1-u)*p.sy*R*1.2;
      var rad=(mobile?2.1:2.6)*(0.35+depth*1.15)*persp*p.s*(1+dive*1.5);
      var alpha=(0.1+depth*0.85)*1.25*(0.25+0.75*u)*(1-dive*0.85);
      ctx.beginPath();ctx.arc(X,Y,Math.max(0.5,rad),0,Math.PI*2);ctx.fillStyle=rgba(p.c,Math.min(1,alpha));ctx.fill();
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  // Textes d'état et barre de progression
  var st=document.getElementById('status'),prog=document.getElementById('prog');
  var steps=[[0,'Connexion au moteur…'],[DELAY*0.35,'Lecture des moments vécus…'],[DELAY*0.7,'Ouverture de votre conversation…']];
  steps.forEach(function(s){setTimeout(function(){st.style.opacity=0;setTimeout(function(){st.textContent=s[1];st.style.opacity=1},180)},s[0])});
  requestAnimationFrame(function(){prog.style.transitionDuration=DELAY+'ms';prog.style.width='100%'});
  // Ouverture automatique de WhatsApp ; le bouton reste disponible si le navigateur la bloque.
  var opened=false;
  function open(){if(opened)return;opened=true;document.getElementById('veil').classList.add('on');setTimeout(function(){location.href=WA},350)}
  setTimeout(open,DELAY-350);
  document.getElementById('go').addEventListener('click',function(){opened=true});
  // Retour sur la page après WhatsApp : on rend la page à nouveau visible.
  addEventListener('pageshow',function(e){if(e.persisted){document.getElementById('veil').classList.remove('on')}});
  document.addEventListener('visibilitychange',function(){if(!document.hidden)document.getElementById('veil').classList.remove('on')});
})();
</script>
<noscript><meta http-equiv="refresh" content="0;url=${esc(wa)}"></noscript>
</body></html>`;
}
