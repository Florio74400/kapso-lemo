// Page d'invitation LEMO (refonte du 24/11/2026, maquette de Florio) : aperçu WhatsApp (Open Graph),
// écran « Invitation » (prénom -> Continuer), puis « Bonjour <prénom>. » et ouverture de WhatsApp.
// Le comportement (orbe, parcours, redirection) est dans public/invite.js ; le serveur injecte la configuration.

import fs from 'node:fs';
import crypto from 'node:crypto';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// Version du script dans l'URL : chaque mise à jour contourne le cache du navigateur.
const JS_VERSION = crypto.createHash('sha1').update(fs.readFileSync(new URL('../public/invite.js', import.meta.url))).digest('hex').slice(0, 10);

export function invitePage({ wa, waNumber = '', base, inviter = null, code = null }) {
  const title = inviter ? `${inviter} t'invite sur LEMO` : 'Vous êtes invité sur LEMO';
  const desc = "Invitation privée d'un membre LEMO.";
  const sub = inviter ? `Invitation personnelle de ${inviter}` : 'Invitation personnelle';
  // JSON dans une balise script : on neutralise « < » pour qu'aucune valeur ne puisse fermer la balise.
  const cfg = JSON.stringify({ wa, waNumber: String(waNumber), code: code || '' }).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#FFFFFF">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
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
:root{
  /* Tokens LEMO (design system) */
  --ink:#1A1A1A; --grey-700:#555555; --grey-500:#888888; --grey-300:#D8D8D8; --white:#FFFFFF;
  --accent:#6B7CFF; --warm:#E8856B; --soft:#B8A9D9; --red:#C44033;
  --r-button:6px; --r-input:10px; --r-pill:100px;
  --font:'Montserrat',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
  --ease-out:cubic-bezier(.22,1,.36,1);
  --ease-in-out:cubic-bezier(.65,0,.35,1);
}
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%}
body{font-family:var(--font);color:var(--ink);background:var(--white);-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
button,input{font:inherit;color:inherit}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap}

/* ---------- Shell ---------- */
.page{min-height:100vh;min-height:100dvh;display:flex;flex-direction:column}
.top{display:flex;align-items:center;justify-content:space-between;padding:max(20px,env(safe-area-inset-top)) 24px 0;height:64px}
.logo{display:block;color:var(--ink);border-radius:4px}
.logo svg{display:block;height:18px;width:auto}
.stage{flex:1;display:flex;align-items:center;justify-content:center;padding:8px 24px 32px}
.col{width:100%;max-width:360px;display:flex;flex-direction:column;align-items:center;text-align:center}
.bottom{display:flex;justify-content:space-between;gap:16px;padding:0 24px max(20px,env(safe-area-inset-bottom));font-size:12px;line-height:16px;color:var(--grey-700)}
.bottom a{color:var(--grey-700);text-decoration:none;transition:color 140ms ease}
.bottom a:hover{color:var(--ink)}
@media (min-width:768px){
  .top{padding:28px 32px 0;height:72px}
  .bottom{padding:0 32px 28px}
}

/* ---------- Orbe ---------- */
.orb{display:block;width:clamp(176px,18vw,232px);aspect-ratio:1/1;margin-bottom:28px}

/* ---------- Écrans (empilés dans la même cellule pour le fondu croisé) ---------- */
.screens{display:grid;grid-template-columns:minmax(0,1fr);align-items:start;width:100%;min-height:296px} /* hauteur fixe : l'orbe ne bouge pas au changement d'écran */
.screen{grid-area:1/1;min-width:0;display:flex;flex-direction:column;align-items:center;transition:opacity 320ms var(--ease-out),transform 420ms var(--ease-out),filter 320ms ease}
.screen.is-out{opacity:0;transform:translateY(-10px);filter:blur(3px);pointer-events:none}
.screen[hidden]{display:none}

.eyebrow{font-size:11px;line-height:1;font-weight:600;letter-spacing:.18em;text-transform:uppercase;color:var(--grey-700)}
.pill{display:inline-flex;align-items:center;gap:8px;padding:6px 14px;border:1px solid var(--grey-300);border-radius:var(--r-pill)}
.dot{width:6px;height:6px;border-radius:50%;background:var(--accent);flex:none}
.title{text-wrap:balance;margin-top:16px;font-size:clamp(30px,1.2vw + 25px,36px);line-height:1.1;font-weight:700;letter-spacing:-.035em;color:var(--ink)}
.title .muted{color:var(--grey-500)}
.lede{text-wrap:balance;margin-top:12px;max-width:320px;font-size:15px;line-height:1.55;font-weight:400;color:var(--grey-700)}

/* ---------- Champ + bouton (bouton imbriqué, rayons 10 / 6) ---------- */
.field{margin-top:28px;width:100%;display:flex;align-items:center;gap:8px;padding:4px 4px 4px 16px;background:var(--white);border:1px solid var(--grey-300);border-radius:var(--r-input);outline:3px solid transparent;transition:border-color 160ms ease,outline-color 160ms ease}
.field:focus-within{border-color:var(--ink);outline-color:rgba(107,124,255,.18)}
.field.is-error{border-color:var(--red);outline-color:rgba(196,64,51,.12);animation:shake 360ms var(--ease-out)}
.field input{flex:1;min-width:0;height:48px;border:0;outline:0;background:transparent;font-size:16px;font-weight:500;letter-spacing:-.005em;color:var(--ink);caret-color:var(--accent)}
.field input::placeholder{color:#767676;font-weight:400}
.btn{flex:none;text-decoration:none;display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:16px 22px 16px 24px;font-size:14px;font-weight:500;line-height:1;border-radius:var(--r-button);border:1px solid var(--ink);background:var(--ink);color:var(--white);cursor:pointer;white-space:nowrap;transition:background-color 140ms ease,border-color 140ms ease}
.btn:hover{background:var(--accent);border-color:var(--accent)}
.btn:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.btn svg{transition:transform 200ms var(--ease-out)}
.btn:hover svg{transform:translateX(2px)}
.btn.ghost{background:transparent;color:var(--ink);border-color:var(--grey-300);padding:10px 18px;font-size:13px}
.btn.ghost:hover{background:transparent;border-color:var(--ink)}
.note{margin-top:14px;font-size:12px;line-height:16px;color:var(--grey-700);min-height:16px}
.note.is-error{color:var(--red)}
@media (max-width:359px){.btn{padding:16px}.btn svg{display:none}.field{padding-left:12px}}
@keyframes shake{0%,100%{transform:translateX(0)}20%{transform:translateX(-6px)}40%{transform:translateX(5px)}60%{transform:translateX(-3px)}80%{transform:translateX(2px)}}

/* ---------- Écran 2 ---------- */
.reveal{opacity:0;transform:translateY(10px);transition:opacity 520ms var(--ease-out),transform 620ms var(--ease-out);transition-delay:var(--d,0ms)}
.is-in .reveal{opacity:1;transform:none}
.name{white-space:pre}
.ch{display:inline-block;opacity:0;transform:translateY(.32em);filter:blur(6px);transition:opacity 520ms var(--ease-out),transform 640ms var(--ease-out),filter 520ms ease;transition-delay:calc(220ms + var(--i) * 38ms)}
.is-in .ch{opacity:1;transform:none;filter:none}

.status{margin-top:28px;display:flex;flex-direction:column;align-items:center;gap:12px;min-height:84px}
.status-label{font-size:13px;line-height:16px;font-weight:500;color:var(--grey-700)}
.track{width:136px;height:2px;border-radius:2px;background:var(--grey-300);overflow:hidden}
.fill{height:100%;width:100%;background:var(--ink);transform:scaleX(0);transform-origin:left center}
.fill.is-running{transform:scaleX(1);transition:transform var(--dur,2400ms) cubic-bezier(.4,0,.2,1)}
.fallback{opacity:0;transform:translateY(6px);pointer-events:none;transition:opacity 360ms var(--ease-out),transform 420ms var(--ease-out)}
.fallback.is-visible{opacity:1;transform:none;pointer-events:auto}
.status.is-done .track{display:none}
.link{margin-top:20px;background:none;border:0;padding:4px 2px;font-size:12px;line-height:16px;color:var(--grey-700);cursor:pointer;text-decoration:underline;text-decoration-color:var(--grey-300);text-underline-offset:3px;transition:color 140ms ease,text-decoration-color 140ms ease}
.link:hover{color:var(--ink);text-decoration-color:var(--ink)}
.link:focus-visible,.logo:focus-visible,.bottom a:focus-visible{outline:2px solid var(--accent);outline-offset:3px}

@media (prefers-reduced-motion:reduce){
  .screen,.reveal,.ch,.fallback{transition-duration:1ms!important;transition-delay:0ms!important}
  .field.is-error{animation:none}
}
</style>
</head>
<body>
<div class="page">

  <header class="top">
    <a class="logo" href="#" id="home" aria-label="Lemo, accueil">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 864 278" fill="currentColor" fill-rule="evenodd" aria-hidden="true"><path d="M743 272C705 268 671 241 659 206C658 203 656 197 655 192C653 180 654 159 657 147C667 111 696 83 735 75C756 71 783 74 802 82C834 97 856 128 859 163C862 201 846 235 815 256C801 265 787 270 769 272C758 273 754 273 743 272ZM63 266C39 260 20 243 11 221C5 206 5 205 5 101L5 6L32 6L58 6L59 106L60 205L63 210C64 213 67 216 70 217L75 220L114 221L152 221L152 245L152 268L111 268C74 268 70 268 63 266ZM226 266C186 260 154 232 145 197C142 186 141 170 143 157C146 134 154 117 169 101C180 89 194 81 211 76C219 74 223 74 236 74C253 74 259 74 271 78C300 87 320 115 326 151C327 162 327 184 326 187L325 190L261 190L198 190L198 192C199 200 210 214 220 218C232 224 235 224 270 224L303 224L303 246L303 268L269 268C246 268 232 267 226 266ZM333 204C334 136 333 139 339 124C344 111 356 97 368 88C377 83 390 77 400 75C412 73 437 73 446 75C460 79 474 86 484 94C488 98 490 99 490 98C491 98 494 95 497 93C516 78 540 71 567 74C582 75 589 77 598 81C608 85 615 90 623 97C634 108 642 122 645 138C647 147 647 153 647 208L647 268L622 268L596 268L596 207L596 146L593 141C589 133 581 125 573 121C567 118 566 118 556 118C546 118 545 118 539 121C530 125 524 130 520 138L516 144L516 206L516 268L490 268L464 268L464 208C464 150 464 148 462 143C458 131 449 123 437 119C428 116 416 117 408 120C400 124 391 133 387 140L384 146L384 207L384 268L358 268L333 268L333 204ZM769 227C787 223 800 209 806 190C807 182 808 167 806 158C804 149 798 137 791 131C780 120 770 116 753 117C744 118 742 118 736 121C723 127 714 137 709 151C707 158 707 160 707 172C707 181 707 187 708 190C712 204 722 218 733 223C743 229 757 230 769 227ZM275 151C272 128 259 116 236 116C228 116 227 116 221 119C217 120 212 123 210 125C206 129 200 140 198 148C197 150 197 153 196 154C196 155 205 155 236 155L276 155L275 151Z"/></svg>
    </a>
  </header>

  <main class="stage">
    <div class="col">
      <canvas class="orb" id="orb" aria-hidden="true"></canvas>

      <div class="screens">
        <!-- ===== Écran 1 : Invitation ===== -->
        <section class="screen" id="s1" aria-labelledby="t1">
          <p class="eyebrow">${esc(sub)}</p>
          <h1 class="title" id="t1">Bienvenue.</h1>
          <p class="lede">Indiquez votre prénom. La suite se passe sur WhatsApp, en vocal ou à l'écrit.</p>
          <form class="field" id="form" novalidate>
            <label class="sr" for="prenom">Prénom</label>
            <input id="prenom" name="prenom" type="text" placeholder="Votre prénom" autocomplete="given-name" autocapitalize="words" spellcheck="false" enterkeyhint="go" maxlength="40" required aria-describedby="note">
            <button class="btn" type="submit">Continuer
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
            </button>
          </form>
          <p class="note" id="note" aria-live="polite">Vous pourrez arrêter à tout moment.</p>
        </section>

        <!-- ===== Écran 2 : Bonjour ===== -->
        <section class="screen" id="s2" aria-labelledby="t2" hidden>
          <span class="eyebrow pill reveal" style="--d:60ms"><span class="dot" aria-hidden="true"></span>Early adopter</span>
          <h1 class="title" id="t2"><span class="muted reveal" style="--d:140ms;display:inline-block">Bonjour</span> <span class="name" id="name"></span></h1>
          <p class="lede reveal" style="--d:520ms">Merci. La conversation continue sur WhatsApp.</p>
          <div class="status reveal" id="status" style="--d:640ms" aria-live="polite">
            <span class="status-label" id="statusLabel">Ouverture de WhatsApp</span>
            <div class="track" aria-hidden="true"><div class="fill" id="fill"></div></div>
            <a class="btn ghost fallback" id="fallback" href="#">Ouvrir WhatsApp</a>
          </div>
          <div class="reveal" style="--d:760ms"><button class="link" id="edit" type="button">Pas <span id="nameInline"></span> ? Modifier le prénom</button></div>
        </section>
      </div>
    </div>
  </main>

  <footer class="bottom">
    <span>lemohq.com</span>
    <a href="#">Confidentialité</a>
  </footer>
</div>

<script id="cfg" type="application/json">${cfg}</script>
<script src="/public/invite.js?v=${JS_VERSION}" defer></script>
<noscript><meta http-equiv="refresh" content="0;url=${esc(wa)}"></noscript>
</body>
</html>`;
}
