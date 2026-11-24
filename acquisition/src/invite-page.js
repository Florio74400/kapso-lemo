// Page d'invitation LEMO, sur le modèle d'Instinct : minimale, tout en « tu ».
// Écran 1 : « Bienvenue, Florio t'invite sur LEMO. » + Commencer
// Écran 2 : le prénom + Continuer
// Puis l'orbe se déplie en onde vocale et WhatsApp s'ouvre aussitôt.
// Aperçu du lien dans WhatsApp : petite vignette (moins de 300 px), titre et phrase courts.
// Le comportement (orbe, parcours, redirection) est dans public/invite.js ; le serveur injecte la configuration.

import fs from 'node:fs';
import crypto from 'node:crypto';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const asset = (f) => crypto.createHash('sha1').update(fs.readFileSync(new URL(`../public/${f}`, import.meta.url))).digest('hex').slice(0, 10);
const JS_VERSION = asset('invite.js'); // chaque mise à jour contourne le cache du navigateur
const THUMB_VERSION = asset('lemo-thumb.png'); // idem pour le cache des aperçus WhatsApp
const logo = fs.readFileSync(new URL('../public/lemo-mark.svg', import.meta.url), 'utf8').replace('fill="#1A1A1A"', 'fill="currentColor" aria-hidden="true"');

export const PREVIEW_DESC = 'Une invitation privée d’un membre LEMO. Vis la data émotionnelle en temps réel, en un message WhatsApp.';

export function invitePage({ wa, waNumber = '', base, inviter, code = null }) {
  const title = `${inviter} t'invite sur LEMO`;
  // JSON dans une balise script : on neutralise « < » pour qu'aucune valeur ne puisse fermer la balise.
  const cfg = JSON.stringify({ wa, waNumber: String(waNumber), code: code || '' }).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#FFFFFF">
<title>${esc(title)}</title>
<meta name="description" content="${esc(PREVIEW_DESC)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="LEMO">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(PREVIEW_DESC)}">
<meta property="og:image" content="${esc(base)}/public/lemo-thumb.png?v=${THUMB_VERSION}">
<meta property="og:image:width" content="200"><meta property="og:image:height" content="200">
<meta property="og:url" content="${esc(base)}/i${code ? `/${esc(code)}` : ''}">
<meta name="twitter:card" content="summary">
<link rel="preload" href="/public/montserrat.woff2" as="font" type="font/woff2" crossorigin>
<style>
@font-face{font-family:'Montserrat';font-style:normal;font-weight:100 900;font-display:swap;src:url(/public/montserrat.woff2) format('woff2')}
:root{--ink:#1A1A1A;--grey-700:#555555;--grey-300:#D8D8D8;--white:#FFFFFF;--accent:#6B7CFF;--red:#C44033;
  --r-button:6px;--r-input:10px;--font:'Montserrat',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;--ease-out:cubic-bezier(.22,1,.36,1)}
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%}
body{font-family:var(--font);color:var(--ink);background:var(--white);-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
button,input{font:inherit;color:inherit}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap}
.page{min-height:100vh;min-height:100dvh;display:flex;flex-direction:column}
.top{display:flex;align-items:center;padding:max(20px,env(safe-area-inset-top)) 24px 0;height:64px}
.logo{display:block;color:var(--ink)}.logo svg{display:block;height:18px;width:auto}
.stage{flex:1;display:flex;align-items:center;justify-content:center;padding:8px 24px 64px}
.col{width:100%;max-width:360px;display:flex;flex-direction:column;align-items:center;text-align:center}
.orb{display:block;width:clamp(176px,18vw,232px);aspect-ratio:1/1;margin-bottom:28px}
.screens{display:grid;grid-template-columns:minmax(0,1fr);width:100%;min-height:150px}
.screen{grid-area:1/1;min-width:0;display:flex;flex-direction:column;align-items:center;transition:opacity 320ms var(--ease-out),transform 420ms var(--ease-out),filter 320ms ease}
.screen.is-out{opacity:0;transform:translateY(-10px);filter:blur(3px);pointer-events:none}
.screen.is-pre{opacity:0;transform:translateY(10px)}
.screen[hidden]{display:none}
.title{text-wrap:balance;font-size:clamp(22px,1vw + 18px,27px);line-height:1.3;font-weight:600;letter-spacing:-.02em}
.cta{margin-top:28px;width:100%;display:flex;align-items:center;justify-content:center;height:48px;font-size:14px;font-weight:500;border-radius:var(--r-button);border:1px solid var(--ink);background:var(--ink);color:var(--white);cursor:pointer;transition:background-color 140ms ease,border-color 140ms ease}
.cta:hover{background:var(--accent);border-color:var(--accent)}
.cta:focus-visible,.btn:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.field{width:100%;display:flex;align-items:center;gap:8px;padding:4px 4px 4px 16px;background:var(--white);border:1px solid var(--grey-300);border-radius:var(--r-input);outline:3px solid transparent;transition:border-color 160ms ease,outline-color 160ms ease}
.field:focus-within{border-color:var(--ink);outline-color:rgba(107,124,255,.18)}
.field.is-error{border-color:var(--red);outline-color:rgba(196,64,51,.12);animation:shake 360ms var(--ease-out)}
.field input{flex:1;min-width:0;height:48px;border:0;outline:0;background:transparent;font-size:16px;font-weight:500;color:var(--ink);caret-color:var(--accent)}
.field input::placeholder{color:#767676;font-weight:400}
.btn{flex:none;text-decoration:none;display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:16px 22px 16px 24px;font-size:14px;font-weight:500;line-height:1;border-radius:var(--r-button);border:1px solid var(--ink);background:var(--ink);color:var(--white);cursor:pointer;white-space:nowrap;transition:background-color 140ms ease,border-color 140ms ease}
.btn:hover{background:var(--accent);border-color:var(--accent)}
.btn svg{transition:transform 200ms var(--ease-out)}.btn:hover svg{transform:translateX(2px)}
.btn.ghost{background:transparent;color:var(--ink);border-color:var(--grey-300);padding:10px 18px;font-size:13px}
.fallback{opacity:0;pointer-events:none;transition:opacity 360ms var(--ease-out)}
.fallback.is-visible{opacity:1;pointer-events:auto}
@media (max-width:359px){.btn{padding:16px}.btn svg{display:none}.field{padding-left:12px}}
@keyframes shake{0%,100%{transform:translateX(0)}20%{transform:translateX(-6px)}40%{transform:translateX(5px)}60%{transform:translateX(-3px)}80%{transform:translateX(2px)}}
@media (min-width:768px){.top{padding:28px 32px 0;height:72px}}
@media (prefers-reduced-motion:reduce){.screen,.fallback{transition-duration:1ms!important}.field.is-error{animation:none}}
</style>
</head>
<body>
<div class="page">
  <header class="top"><a class="logo" href="#" id="home" aria-label="LEMO">${logo}</a></header>
  <main class="stage">
    <div class="col">
      <canvas class="orb" id="orb" aria-hidden="true"></canvas>
      <div class="screens">
        <section class="screen" id="s1" aria-labelledby="t1">
          <h1 class="title" id="t1">Bienvenue, ${esc(inviter)}<br>t'invite sur LEMO.</h1>
          <button class="cta" id="start" type="button">Commencer</button>
        </section>
        <section class="screen is-pre" id="s2" hidden>
          <form class="field" id="form" novalidate>
            <label class="sr" for="prenom">Ton prénom</label>
            <input id="prenom" name="prenom" type="text" placeholder="Ton prénom" autocomplete="given-name" autocapitalize="words" spellcheck="false" enterkeyhint="go" maxlength="40" required>
            <button class="btn" type="submit">Continuer
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
            </button>
          </form>
        </section>
        <section class="screen is-pre" id="s3" hidden aria-live="polite">
          <a class="btn ghost fallback" id="fallback" href="#">Ouvrir WhatsApp</a>
        </section>
      </div>
    </div>
  </main>
</div>
<script id="cfg" type="application/json">${cfg}</script>
<script src="/public/invite.js?v=${JS_VERSION}" defer></script>
<noscript><meta http-equiv="refresh" content="0;url=${esc(wa)}"></noscript>
</body>
</html>`;
}
