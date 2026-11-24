// Page d'invitation LEMO : aperçu WhatsApp (Open Graph), 3 secondes d'expérience, puis ouverture de WhatsApp.
// Trois variantes visuelles (paramètre ?v=1|2|3), toutes centrées, sphère de données à 50 % d'opacité :
//   1. Constellation : des points s'étiquettent (verbatims, émotions, tendances), le texte est au cœur de la sphère.
//   2. Balayage : une ligne de lecture parcourt la sphère et révèle des valeurs ; compteur de moments analysés.
//   3. Noyau : anneau de mesure qui tourne en sens inverse, avec des indicateurs qui défilent.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function invitePage({ wa, waNumber = '', base, variant = 1, delayMs = 3000 }) {
  const v = [1, 2, 3].includes(Number(variant)) ? Number(variant) : 1;
  const title = 'Vous êtes invité sur LEMO';
  const desc = "Invitation privée d'un membre LEMO.";
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
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;background:#fff;color:#1A1A1A;overflow:hidden}
body{font-family:"Montserrat","Helvetica Neue",Arial,sans-serif;-webkit-font-smoothing:antialiased}
canvas{position:fixed;inset:0;width:100%;height:100%;display:block}
.text{position:fixed;left:0;right:0;text-align:center;z-index:2;opacity:0;animation:in 1.2s .35s ease forwards}
.kicker{font-size:10px;font-weight:600;letter-spacing:.38em;text-transform:uppercase;color:#4553C7;padding-left:.38em}
.title{margin-top:8px;font-size:17px;font-weight:600;letter-spacing:-.01em}
.counter{margin-top:14px;font:500 10px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:.12em;color:#888}
.veil{position:fixed;inset:0;background:#fff;opacity:0;pointer-events:none;transition:opacity .4s ease;z-index:5}
.veil.on{opacity:1}
.ask{margin-top:22px;display:flex;gap:8px;justify-content:center;flex-wrap:wrap;opacity:0;transform:translateY(6px);transition:opacity .6s ease,transform .6s ease;pointer-events:none}
.ask.on{opacity:1;transform:none;pointer-events:auto}
.ask input{font:500 15px "Montserrat",Arial,sans-serif;width:200px;padding:12px 18px;border:1px solid #DADBE6;border-radius:999px;background:rgba(255,255,255,.9);color:#1A1A1A;outline:none;text-align:center;-webkit-appearance:none}
.ask input:focus{border-color:#6B7CFF;box-shadow:0 0 0 4px rgba(107,124,255,.12)}
.ask button{font:600 15px "Montserrat",Arial,sans-serif;padding:12px 22px;border:0;border-radius:999px;color:#fff;background:linear-gradient(90deg,#4553C7,#E8856B);cursor:pointer}
.ask button:disabled{opacity:.5}
.hello{display:none}.hello.on{display:block;animation:in .7s ease forwards;opacity:0}
.hello .title{font-size:22px}.hello .sub{margin-top:8px;font-size:14px;color:#555;line-height:1.5;padding:0 24px}
@keyframes in{to{opacity:1}}
@media (min-width:900px){.kicker{font-size:11px}.title{font-size:20px}}
@media (prefers-reduced-motion:reduce){.text{animation:none;opacity:1}}
</style>
</head><body>
<canvas id="cv" aria-hidden="true"></canvas>
<div class="text" id="text"><div id="intro"><div class="kicker">Invitation</div><div class="title">Bienvenue dans LEMO</div>${v === 2 ? '<div class="counter" id="counter">MOMENTS ANALYSÉS 0</div>' : ''}
<form class="ask" id="ask" autocomplete="on"><input id="name" name="given-name" autocomplete="given-name" placeholder="Ton prénom" maxlength="30" required aria-label="Ton prénom"><button type="submit">Continuer</button></form></div>
<div class="hello" id="hello"><div class="kicker">Early adopter</div><div class="title">Hello <span id="hn"></span>,</div><div class="sub">tu as reçu une invitation personnelle early adopter.</div></div></div>
<div class="veil" id="veil"></div>
<script>
(function(){
  var WA=${JSON.stringify(wa)},NUM=${JSON.stringify(String(waNumber))},DELAY=${Number(delayMs)},V=${v};
  var reduced=window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;
  var cv=document.getElementById('cv'),ctx=cv.getContext('2d'),txt=document.getElementById('text');
  var W,H,DPR,CX,CY,R,mobile;
  var INK=['#2F3DA8','#4553C7','#6B7CFF','#E8734F'];
  var OPACITY=0.5;
  var MONO='ui-monospace,SFMono-Regular,Menlo,Consolas,monospace';
  function rgba(c,a){var r=parseInt(c.slice(1,3),16),g=parseInt(c.slice(3,5),16),b=parseInt(c.slice(5,7),16);return 'rgba('+r+','+g+','+b+','+a+')'}
  function layout(){
    DPR=Math.min(window.devicePixelRatio||1,2);W=innerWidth;H=innerHeight;mobile=W<700;
    cv.width=W*DPR;cv.height=H*DPR;ctx.setTransform(DPR,0,0,DPR,0,0);
    CX=W/2;
    if(V===1){CY=H/2;R=Math.min(W,H)*(mobile?0.36:0.3);txt.style.top='50%';txt.style.transform='translateY(-50%)'}
    else{CY=H*0.45;R=V===3?Math.min(W*(mobile?0.27:0.3),H*0.24):Math.min(W*0.34,H*0.26);txt.style.top=(CY+R+(V===3?R*0.32+28:36))+'px';txt.style.transform='none'}
  }
  layout();addEventListener('resize',layout);
  var N=mobile?1100:2000,pts=[];
  for(var i=0;i<N;i++){
    var shell=Math.random()<0.6,r=shell?(0.93+Math.random()*0.07):Math.pow(Math.random(),0.42);
    var y=1-(i+0.5)/N*2,rad=Math.sqrt(Math.max(0,1-y*y)),th=Math.PI*(1+Math.sqrt(5))*i;
    pts.push({x:Math.cos(th)*rad*r,y:y*r,z:Math.sin(th)*rad*r,c:INK[(Math.random()*4)|0],s:0.5+Math.random()});
  }
  // Ce que représente chaque point : un verbatim, une émotion, une tendance.
  var LABELS=['verbatim #48 213','joie · 0,82','tendance +14 %','attente −6 min','intensité 0,77','frustration · 0,31','1 284 moments / h','satisfaction +9 %','vocal · 00:21','surprise · 0,64','signal faible ↑','NPS 61','gratitude · 0,88','irritant ↓ 12 %','verbatim #48 219','émotion dominante : joie'];
  function ease(t){return t<0?0:t>1?1:1-Math.pow(1-t,3)}
  // Écrit une étiquette sans jamais dépasser les bords de l'écran.
  function label(str,x,y,align){var w=ctx.measureText(str).width,m=12,l=align==='right'?x-w:align==='center'?x-w/2:x;l=Math.max(m,Math.min(W-m-w,l));ctx.textAlign='left';ctx.fillText(str,l,y)}
  function fmt(n){return Math.round(n).toString().replace(/\\B(?=(\\d{3})+(?!\\d))/g,' ')}
  var start=performance.now(),proj=new Array(N),T=DELAY/1000;
  // Points étiquetés (variante 1) : choisis sur la face avant, apparition échelonnée.
  var tagged=[];for(var k=0;k<(mobile?5:8);k++)tagged.push({i:(Math.random()*N)|0,t0:0.3+k*(mobile?0.42:0.26),label:LABELS[k%LABELS.length]});
  function frame(now){
    var t=(now-start)/1000;
    var appear=reduced?1:ease(t/1.1);
    var ang=t*0.05+0.6,tilt=0.42,ca=Math.cos(ang),sa=Math.sin(ang),ct=Math.cos(tilt),st=Math.sin(tilt);
    var RR=R*(0.94+0.06*appear);
    ctx.clearRect(0,0,W,H);
    var g=ctx.createRadialGradient(CX,CY,0,CX,CY,RR*1.6);
    g.addColorStop(0,rgba('#6B7CFF',0.06*appear));g.addColorStop(1,rgba('#6B7CFF',0));
    ctx.fillStyle=g;ctx.beginPath();ctx.arc(CX,CY,RR*1.6,0,Math.PI*2);ctx.fill();
    var scanY=CY-RR+(RR*2)*((t-0.2)/(T-0.5)); // variante 2
    for(var i=0;i<N;i++){var p=pts[i],x1=p.x*ca-p.z*sa,z1=p.x*sa+p.z*ca,y2=p.y*ct-z1*st,z2=p.y*st+z1*ct;proj[i]=[x1,y2,z2,p,i]}
    var order=proj.slice().sort(function(a,b){return a[2]-b[2]});
    for(var j=0;j<N;j++){
      var q=order[j],p=q[3],persp=1/(1+q[2]*0.34),depth=(q[2]+1)/2;
      var X=CX+q[0]*RR*persp,Y=CY+q[1]*RR*persp;
      var a=(0.1+depth*0.85)*OPACITY*appear,rr=(mobile?1.7:2.2)*(0.35+depth*1.15)*persp*p.s;
      if(V===2){var d=Math.abs(Y-scanY);if(d<10){a=Math.min(1,a+0.5*(1-d/10));rr*=1.25}}
      ctx.beginPath();ctx.arc(X,Y,Math.max(0.5,rr),0,Math.PI*2);ctx.fillStyle=rgba(p.c,a);ctx.fill();
    }
    ctx.font='500 '+(mobile?9:10)+'px '+MONO;ctx.textBaseline='middle';
    if(V===1){
      // halo blanc derrière le texte central
      var wg=ctx.createRadialGradient(CX,CY,0,CX,CY,RR*0.62);wg.addColorStop(0,'rgba(255,255,255,0.92)');wg.addColorStop(1,'rgba(255,255,255,0)');
      ctx.fillStyle=wg;ctx.beginPath();ctx.arc(CX,CY,RR*0.62,0,Math.PI*2);ctx.fill();
      tagged.forEach(function(tg){
        var life=(t-tg.t0)/1.5;if(life<0||life>1)return;
        var q=proj[tg.i];if(q[2]>0.2){tg.i=(tg.i+37)%N;return}
        var persp=1/(1+q[2]*0.34),X=CX+q[0]*RR*persp,Y=CY+q[1]*RR*persp;
        var al=Math.sin(Math.PI*life)*0.9,side=X<CX?-1:1,lx=X+side*(18+RR*0.08),ly=Y-14;
        ctx.strokeStyle='rgba(69,83,199,'+(al*0.45)+')';ctx.lineWidth=0.7;ctx.beginPath();ctx.moveTo(X,Y);ctx.lineTo(lx,ly);ctx.stroke();
        ctx.beginPath();ctx.arc(X,Y,2.4,0,Math.PI*2);ctx.fillStyle='rgba(232,115,79,'+al+')';ctx.fill();
        ctx.fillStyle='rgba(47,61,168,'+al+')';label(tg.label,lx+side*4,ly,side<0?'right':'left');
      });
    }
    if(V===2){
      if(scanY>CY-RR&&scanY<CY+RR){
        var half=Math.sqrt(Math.max(0,RR*RR-(scanY-CY)*(scanY-CY)));
        var lg=ctx.createLinearGradient(CX-half,0,CX+half,0);lg.addColorStop(0,'rgba(69,83,199,0)');lg.addColorStop(0.5,'rgba(69,83,199,0.55)');lg.addColorStop(1,'rgba(232,133,107,0)');
        ctx.strokeStyle=lg;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(CX-half-20,scanY);ctx.lineTo(CX+half+20,scanY);ctx.stroke();
        ctx.fillStyle='rgba(47,61,168,0.75)';
        if(mobile){label(LABELS[(Math.floor(t*5))%LABELS.length],CX+half,scanY-12,'right');label((0.4+0.5*Math.abs(Math.sin(t*3))).toFixed(2).replace('.',','),CX-half,scanY-12,'left')}
        else{label(LABELS[(Math.floor(t*5))%LABELS.length],CX+half+28,scanY,'left');label((0.4+0.5*Math.abs(Math.sin(t*3))).toFixed(2).replace('.',','),CX-half-28,scanY,'right')}
      }
      var ce=document.getElementById('counter');if(ce)ce.textContent='MOMENTS ANALYSÉS  '+fmt(128405*ease(t/(T-0.3)));
    }
    if(V===3){
      var ringR=RR*1.22,rot=-t*0.12;
      ctx.strokeStyle='rgba(69,83,199,'+(0.25*appear)+')';ctx.lineWidth=0.8;ctx.beginPath();ctx.arc(CX,CY,ringR,0,Math.PI*2);ctx.stroke();
      for(var m=0;m<120;m++){
        var an=rot+m*Math.PI*2/120,len=m%10===0?9:4;
        ctx.strokeStyle='rgba(69,83,199,'+((m%10===0?0.55:0.22)*appear)+')';
        ctx.beginPath();ctx.moveTo(CX+Math.cos(an)*ringR,CY+Math.sin(an)*ringR);ctx.lineTo(CX+Math.cos(an)*(ringR+len),CY+Math.sin(an)*(ringR+len));ctx.stroke();
      }
      var arc=Math.min(1,t/(T-0.3));
      ctx.strokeStyle='rgba(232,115,79,'+(0.8*appear)+')';ctx.lineWidth=1.6;ctx.beginPath();ctx.arc(CX,CY,ringR,-Math.PI/2,-Math.PI/2+arc*Math.PI*2);ctx.stroke();
      var stats=[['ÉMOTIONS',fmt(9*ease(t/1.8))],['VERBATIMS',fmt(48213*ease(t/2.2))],['TENDANCES',fmt(312*ease(t/2))],['SIGNAUX',fmt(27*ease(t/1.6))]];
      for(var s=0;s<4;s++){
        var aa=rot*0.5+s*Math.PI/2+Math.PI/4,px=CX+Math.cos(aa)*(ringR+26),py=CY+Math.sin(aa)*(ringR+26);
        ctx.fillStyle='rgba(47,61,168,'+(0.75*appear)+')';
        label(stats[s][0]+' '+stats[s][1],px,py,Math.cos(aa)<0?'right':'left');
      }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  // Prénom : le formulaire apparaît après l'introduction animée.
  var ask=document.getElementById('ask'),inp=document.getElementById('name');
  setTimeout(function(){ask.classList.add('on')},reduced?0:1800);
  ask.addEventListener('submit',function(e){
    e.preventDefault();
    var n=(inp.value||'').trim().replace(/[^A-Za-zÀ-ÖØ-öø-ÿ' -]/g,'').slice(0,30);
    if(!n){inp.focus();return}
    n=n.charAt(0).toUpperCase()+n.slice(1);
    inp.blur();ask.querySelector('button').disabled=true;
    document.getElementById('hn').textContent=n;
    document.getElementById('intro').style.display='none';
    document.getElementById('hello').classList.add('on');
    var url=NUM?('https://wa.me/'+NUM+'?text='+encodeURIComponent("Hey LEMO, c'est "+n+' !')):WA;
    // le temps de lire le message, puis ouverture de WhatsApp
    setTimeout(function(){document.getElementById('veil').classList.add('on')},2300);
    setTimeout(function(){location.href=url},2700);
  });
  addEventListener('pageshow',function(e){if(e.persisted)document.getElementById('veil').classList.remove('on')});
  document.addEventListener('visibilitychange',function(){if(!document.hidden)document.getElementById('veil').classList.remove('on')});
})();
</script>
<noscript><meta http-equiv="refresh" content="0;url=${esc(wa)}"></noscript>
</body></html>`;
}
