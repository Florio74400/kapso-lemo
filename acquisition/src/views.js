// Gabarits HTML du mini-CRM (rendu serveur, sans framework).
export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const EMO_LABEL = { joie: 'Joie', satisfaction: 'Satisfaction', gratitude: 'Gratitude', surprise: 'Surprise', neutre: 'Neutre', deception: 'Déception', frustration: 'Frustration', colere: 'Colère', inquietude: 'Inquiétude', tristesse: 'Tristesse' };
const TONE_LABEL = { positive: 'Positif', neutral: 'Neutre', negative: 'Négatif', mixed: 'Mitigé' };
const URG_LABEL = { none: '', low: 'Faible', medium: 'Moyenne', high: 'Haute' };

const CSS = `
:root{--bg:#f6f5f2;--card:#fff;--ink:#1c1b19;--mute:#6b6860;--line:#e4e1da;--accent:#0f766e;--warn:#b45309;--bad:#b91c1c;--good:#15803d}
@media (prefers-color-scheme:dark){:root{--bg:#141413;--card:#1e1e1c;--ink:#eceae4;--mute:#a19e95;--line:#33322e;--accent:#2dd4bf;--warn:#f59e0b;--bad:#f87171;--good:#4ade80}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}
header{display:flex;justify-content:space-between;align-items:center;padding:14px 20px;border-bottom:1px solid var(--line);background:var(--card)}
header a{color:var(--ink);text-decoration:none;margin-left:16px}header strong{letter-spacing:.04em}
main{max-width:1000px;margin:0 auto;padding:24px 16px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:28px 0 10px}.mute{color:var(--mute)}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px;margin-bottom:12px}
table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);border-radius:10px;overflow:hidden}
th,td{text-align:left;padding:10px 12px;border-bottom:1px solid var(--line);vertical-align:top}th{font-size:12px;text-transform:uppercase;color:var(--mute);font-weight:600}
a{color:var(--accent)}.pill{display:inline-block;padding:1px 8px;border-radius:99px;font-size:12px;border:1px solid var(--line);margin:0 4px 4px 0}
.pill.high{border-color:var(--bad);color:var(--bad)}.pill.medium{border-color:var(--warn);color:var(--warn)}
.pill.positive{color:var(--good)}.pill.negative{color:var(--bad)}.pill.mixed{color:var(--warn)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px}
.kpi{font-size:28px;font-weight:600}
input,textarea,select{width:100%;padding:9px 10px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--ink);font:inherit}
button{padding:9px 14px;border:0;border-radius:8px;background:var(--accent);color:#fff;font:inherit;cursor:pointer}
button.ghost{background:transparent;color:var(--ink);border:1px solid var(--line)}
label{display:block;font-size:13px;color:var(--mute);margin:10px 0 4px}
.banner{padding:10px 14px;border-radius:8px;border:1px dashed var(--warn);color:var(--warn);margin-bottom:16px;font-size:14px}
blockquote{margin:6px 0;padding:6px 12px;border-left:3px solid var(--line);white-space:pre-wrap}
ul{margin:4px 0;padding-left:20px}.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.bar{height:8px;background:var(--accent);border-radius:4px}
.chat{display:flex;flex-direction:column;gap:6px;max-height:520px;overflow:auto;padding:12px;background:var(--bg);border-radius:8px}
.b{max-width:80%;padding:8px 10px;border-radius:10px;white-space:pre-wrap;font-size:14px}
.b.in{align-self:flex-end;background:#dcf8c6;color:#111}.b.out{align-self:flex-start;background:var(--card);border:1px solid var(--line)}
@media (max-width:640px){th:nth-child(n+4),td:nth-child(n+4){display:none}}
`;

export function layout({ title, body, company, banner }) {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · LEMO Mini</title><style>${CSS}</style></head><body>
<header><strong>LEMO Mini</strong><nav>${company ? `<span class="mute">${esc(company.name)}</span><a href="/">Collectes</a><a href="/settings">Réglages</a>${banner?.demo ? '<a href="/demo">Simulateur</a>' : ''}<a href="/logout">Sortir</a>` : ''}</nav></header>
<main>${banner?.text ? `<div class="banner">${banner.text}</div>` : ''}${body}</main></body></html>`;
}

export function loginPage(error) {
  return `<div class="card" style="max-width:380px;margin:40px auto"><h1>Connexion</h1>
<form method="post" action="/login"><label>E-mail</label><input name="email" type="email" required autocomplete="username">
<label>Mot de passe</label><input name="password" type="password" required autocomplete="current-password">
${error ? `<p style="color:var(--bad)">${esc(error)}</p>` : ''}<p><button>Se connecter</button></p></form></div>`;
}

export function dashboardPage({ collections, presets = {} }) {
  const rows = collections
    .map(
      (c) => `<tr><td><a href="/collections/${c.id}">${esc(c.title)}</a><div class="mute">${esc(c.code)}</div></td>
<td>${c.n}</td><td>${c.alerts ? `<span class="pill high">${c.alerts} alerte(s)</span>` : ''}</td>
<td>${c.status === 'open' ? 'Ouverte' : 'Close'}</td><td class="mute">${new Date(c.created_at).toLocaleDateString('fr-FR')}</td></tr>`,
    )
    .join('');
  return `<h1>Collectes</h1><p class="mute">Créez une collecte ici ou en écrivant à LEMO sur WhatsApp.</p>
<table><tr><th>Collecte</th><th>Réponses</th><th>Alertes</th><th>Statut</th><th>Créée</th></tr>${rows || '<tr><td colspan="5" class="mute">Aucune collecte.</td></tr>'}</table>
<h2>Nouvelle collecte</h2><form class="card" method="post" action="/collections">
<label>Type</label><select name="kind"><option value="feedback">Retours clients (question ouverte)</option>${Object.entries(presets).map(([id, p]) => `<option value="${esc(id)}">Lien d'inscription : ${esc(p.label)}</option>`).join('')}</select>
<label>Sujet (court)</label><input name="title" placeholder="votre séjour" maxlength="80">
<label>Question ouverte posée aux clients (pour les alertes : question de fin de journée, laisser vide pour la valeur par défaut)</label><textarea name="question" rows="2" maxlength="300" placeholder="Comment avez-vous vécu votre séjour ? Racontez-nous librement, par écrit ou en vocal."></textarea>
<p><button>Créer la collecte</button></p></form>`;
}

function list(items) {
  return items?.length ? `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : '<p class="mute">Rien de notable.</p>';
}

function bars(items, labels = {}) {
  if (!items.length) return '<p class="mute">Pas encore de données.</p>';
  const max = Math.max(...items.map((i) => i.count));
  return items
    .map((i) => `<div class="row" style="margin:4px 0"><span style="width:130px">${esc(labels[i.label] || i.label)}</span><div class="bar" style="width:${Math.round((i.count / max) * 60) + 4}%"></div><span class="mute">${i.count}</span></div>`)
    .join('');
}

const TOPIC_LABEL = { ouverture_remontees: 'Ouverture des remontées', horaires: 'Horaires', meteo_neige: 'Météo et neige', forfaits_tarifs: 'Forfaits et tarifs', acces_parking_navettes: 'Accès, parking, navettes', securite: 'Sécurité', restauration_services: 'Restauration et services', fermetures: 'Fermetures', attente_tunnel: "Temps d'attente", travaux: 'Travaux', meteo_equipements: 'Météo et équipements', peage_tarifs: 'Péage et tarifs', itineraire: 'Itinéraire', acces: 'Accès', tarifs: 'Tarifs', services: 'Services', autre: 'Autre' };

function alertsBlock(col, a) {
  const q = (list) =>
    list.length
      ? list.slice(0, 30).map((x) => `<div class="row" style="border-bottom:1px solid var(--line);padding:6px 0"><span class="pill">${esc(TOPIC_LABEL[x.topic] || x.topic)}</span>${x.answerable === false ? '<span class="pill high">sans réponse</span>' : ''}<span style="flex:1">${esc(x.question)}</span><span class="mute">${new Date(x.created_at).toLocaleString('fr-FR')}</span></div>`).join('')
      : '<p class="mute">Aucune question pour l\'instant.</p>';
  return `<h2>Inscrits : ${esc(a.cfg.label || 'lien d’inscription')}</h2>
<div class="grid"><div class="card"><div class="mute">Abonnés actifs</div><div class="kpi">${a.active}</div><div class="mute">${a.subscribers} au total</div></div>
<div class="card"><div class="mute">Questions posées</div><div class="kpi">${a.questions.length}</div><div class="mute">${a.unanswered.length} sans réponse</div></div>
<div class="card"><div class="mute">Envois non faits (fenêtre 24 h fermée)</div><div class="kpi" style="color:${a.skipped ? 'var(--warn)' : 'inherit'}">${a.skipped}</div></div></div>
<div class="grid">${a.byStep.map((s) => `<div class="card"><b>${esc(s.title)}</b>${bars(s.items)}</div>`).join('')}<div class="card"><b>Jours demandés</b>${bars(a.byDay)}</div><div class="card"><b>Sujets des questions</b>${bars(a.topics, TOPIC_LABEL)}</div></div>
<h2>Infos du jour de l'équipe</h2><div class="card"><p class="mute">Ajoutées au message du matin et utilisées par l'IA pour répondre aux questions de ce jour-là.</p>
<form method="post" action="/collections/${col.id}/daily-info" class="row"><input type="date" name="day" value="${esc(a.tomorrow)}" style="width:auto"><input name="body" maxlength="500" placeholder="Ex : Télécabine de Bochard fermée jusqu'à 11h (vent)" style="flex:1;min-width:220px"><button>Ajouter</button></form>
${a.infos.length ? a.infos.map((i) => `<div class="row" style="border-bottom:1px solid var(--line);padding:6px 0"><span class="pill">${esc(i.day)}</span><span style="flex:1">${esc(i.body)}</span><span class="mute">${esc(i.source)}</span></div>`).join('') : '<p class="mute">Aucune info saisie.</p>'}</div>
<div class="card"><b>Test immédiat</b><p class="mute">Les envois automatiques partent vers ${a.cfg.morning_hour}h (info du matin)${a.cfg.eod_hour != null ? ` et ${a.cfg.eod_hour}h (question de fin de journée)` : ''}, heure de Paris. Pour une démo, déclenchez-les maintenant :</p>
<div class="row"><form method="post" action="/collections/${col.id}/send-now"><input type="hidden" name="type" value="morning"><button>Envoyer l'info du matin</button></form>
<form method="post" action="/collections/${col.id}/send-now"><input type="hidden" name="type" value="eod"><button class="ghost">Envoyer la question de fin de journée</button></form></div></div>
<h2>Questions sans réponse : ce qui manque à votre communication</h2><div class="card">${q(a.unanswered)}</div>
<h2>Dernières questions</h2><div class="card">${q(a.questions)}</div>`;
}

export function collectionPage({ col, report, feedbacks, link, synthesisError, alertData = null, notice = null }) {
  const fb = feedbacks
    .map((f) => {
      const a = typeof f.analysis === 'string' ? JSON.parse(f.analysis) : f.analysis;
      return `<div class="card" id="f-${f.id}"><div class="row">
<span class="pill ${esc(f.sentiment)}">${esc(TONE_LABEL[f.sentiment] || f.sentiment)}</span><span class="pill">${esc(EMO_LABEL[f.emotion] || f.emotion)}</span>
${f.urgency !== 'none' ? `<span class="pill ${esc(f.urgency)}">Urgence ${esc(URG_LABEL[f.urgency])}</span>` : ''}
${a.topics.map((t) => `<span class="pill">${esc(t)}</span>`).join('')}
${f.simulated ? '<span class="pill">analyse simulée</span>' : ''}<span class="mute" style="margin-left:auto">${new Date(f.created_at).toLocaleString('fr-FR')}</span></div>
<p><strong>${esc(a.summary)}</strong></p>
<blockquote>${esc(f.verbatim)}</blockquote>${f.transcript ? '<p class="mute">Contient un message vocal (transcrit).</p>' : ''}
<div class="grid"><div><b>Points positifs</b>${list(a.positives)}</div><div><b>Irritants</b>${list(a.irritants)}</div><div><b>Suggestions</b>${list(a.suggestions)}</div></div>
${a.urgency_reason ? `<p style="color:var(--bad)">${esc(a.urgency_reason)}</p>` : ''}</div>`;
    })
    .join('');

  const s = report.synthesis;
  const synth = report.belowThreshold
    ? `<p class="mute">Synthèse disponible à partir de ${report.threshold} répondants (seuil de confidentialité). Actuellement : ${report.n}.</p>`
    : synthesisError
      ? `<p style="color:var(--bad)">${esc(synthesisError)}</p>`
      : `<div class="grid"><div><b>Points positifs</b>${list(s.positives)}</div><div><b>Problèmes principaux</b>${list(s.problems)}</div><div><b>Actions recommandées</b>${list(s.actions)}</div></div>
${s.insight ? `<p><b>Découverte :</b> ${esc(s.insight)}</p>` : ''}
<form method="post" action="/collections/${col.id}/synthesis"><button class="ghost">Régénérer</button></form>`;

  const alerts = feedbacks.filter((f) => f.urgency === 'high' || f.urgency === 'medium');
  return `<p><a href="/">&larr; Collectes</a></p><h1>${esc(col.title)}</h1><p class="mute">${esc(col.code)} · « ${esc(col.question)} »</p>
<div class="grid"><div class="card"><div class="mute">Réponses</div><div class="kpi">${report.n}</div></div>
<div class="card"><div class="mute">Alertes</div><div class="kpi" style="color:${alerts.length ? 'var(--bad)' : 'inherit'}">${alerts.length}</div></div>
<div class="card"><div class="mute">Statut</div><div class="kpi" style="font-size:20px">${col.status === 'open' ? 'Ouverte' : 'Close'}</div>
<form method="post" action="/collections/${col.id}/status"><button class="ghost">${col.status === 'open' ? 'Clore' : 'Rouvrir'}</button></form></div></div>
${notice ? `<div class="banner">${esc(notice)}</div>` : ''}<h2>Partager</h2><div class="card row"><img src="/collections/${col.id}/qr.png" width="140" height="140" alt="QR code de la collecte" style="background:#fff;border-radius:8px">
<div style="flex:1;min-width:240px"><label>Lien WhatsApp</label><input readonly value="${esc(link)}" onclick="this.select()"><p class="mute">Chaque client qui ouvre ce lien démarre sa propre conversation. Les réponses ne se mélangent pas.</p></div></div>
${alerts.length ? `<h2>Alertes</h2>${alerts.map((f) => `<div class="card"><span class="pill ${esc(f.urgency)}">Urgence ${esc(URG_LABEL[f.urgency])}</span> <a href="#f-${f.id}">${esc((typeof f.analysis === 'string' ? JSON.parse(f.analysis) : f.analysis).summary)}</a></div>`).join('')}` : ''}
${alertData ? alertsBlock(col, alertData) : ''}
<h2>${alertData ? 'Retours de fin de journée : synthèse' : 'Synthèse'}</h2><div class="card">${synth}</div>
<div class="grid"><div class="card"><b>Émotions</b>${bars(report.emotions, EMO_LABEL)}</div><div class="card"><b>Sujets</b>${bars(report.topics)}</div></div>
<h2>Retours (${report.n})</h2>${fb || '<p class="mute">Aucun retour pour l\'instant.</p>'}`;
}

export function settingsPage({ company, saved }) {
  return `<h1>Réglages</h1>${saved ? '<p style="color:var(--good)">Enregistré.</p>' : ''}
<form class="card" method="post" action="/settings">
<label>Numéros WhatsApp des dirigeants (format international, séparés par des virgules)</label>
<input name="owner_phones" value="${esc(company.owner_phones.join(', '))}" placeholder="33612345678">
<p class="mute">Ces numéros peuvent créer des collectes et demander un bilan en écrivant à LEMO.</p>
<label>Lecteurs : direction, marketing, exploitation (format international, séparés par des virgules)</label>
<input name="reader_phones" value="${esc((company.reader_phones || []).join(', '))}" placeholder="33611223344">
<p class="mute">Ces numéros peuvent interroger les retours clients sur WhatsApp (« Y a-t-il eu des problèmes aujourd'hui à la Flégère ? ») et demander un bilan, sans pouvoir créer de collecte.</p>
<label>Seuil de confidentialité (répondants minimum avant synthèse)</label><input name="privacy_threshold" type="number" min="1" max="100" value="${company.privacy_threshold}">
<label>Conservation des retours (jours)</label><input name="retention_days" type="number" min="1" max="730" value="${company.retention_days}">
<p><button>Enregistrer</button></p></form>`;
}

export function demoPage({ collections, ownerPhone }) {
  return `<h1>Simulateur WhatsApp</h1>
<p class="mute">Simule des conversations sans numéro WhatsApp : chaque message passe par le même webhook signé que Kapso. Changez de numéro pour jouer plusieurs clients en parallèle.</p>
<div class="card"><div class="row"><div style="flex:1;min-width:200px"><label>Votre numéro (simulé)</label><input id="phone" value="33600000001"></div>
<div style="flex:1;min-width:200px"><label>Raccourcis</label><select id="preset">
<option value="">—</option><option value="owner">Jouer le dirigeant (${esc(ownerPhone)})</option>
${collections.map((c) => `<option value="code:${esc(c.code)}">Ouvrir le lien de « ${esc(c.title)} »</option>`).join('')}</select></div></div>
<div class="chat" id="chat" style="margin-top:12px"></div>
<form id="f" class="row" style="margin-top:10px"><input id="text" placeholder="Votre message…" autocomplete="off" style="flex:1">
<label style="margin:0;display:flex;gap:6px;align-items:center;width:auto"><input type="checkbox" id="audio" style="width:auto"> vocal</label><button>Envoyer</button></form></div>
<script>
const $=id=>document.getElementById(id);
async function refresh(){const r=await fetch('/demo/thread?phone='+encodeURIComponent($('phone').value));const msgs=await r.json();
$('chat').innerHTML=msgs.map(m=>'<div class="b '+m.direction+'">'+(m.kind==='audio'?'[vocal] ':'')+(m.body||m.transcript||'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))+'</div>').join('');$('chat').scrollTop=1e9;}
async function send(text,button){await fetch('/demo/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone:$('phone').value,text,audio:$('audio').checked,button})});$('audio').checked=false;setTimeout(refresh,300);setTimeout(refresh,1500);setTimeout(refresh,4000);}
$('f').onsubmit=e=>{e.preventDefault();const t=$('text').value.trim();if(!t)return;$('text').value='';send(t);};
$('preset').onchange=e=>{const v=e.target.value;if(v==='owner'){$('phone').value='${esc(ownerPhone)}';refresh();}else if(v.startsWith('code:')){send('Bonjour, je souhaite donner mon avis ('+v.slice(5)+')');}e.target.value='';};
$('phone').onchange=refresh;refresh();setInterval(refresh,3000);
</script>`;
}

// Page d'invitation : balises Open Graph pour l'aperçu WhatsApp, puis redirection vers la conversation.
export function invitePage({ wa, base }) {
  const title = 'Vous êtes invité sur LEMO';
  const desc = "Invitation privée d'un membre LEMO. Rien à installer : la conversation s'ouvre directement sur WhatsApp.";
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="LEMO">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(base)}/public/lemo-invite.png">
<meta property="og:image:width" content="600"><meta property="og:image:height" content="600">
<meta property="og:url" content="${esc(base)}/i">
<meta name="twitter:card" content="summary">
<meta http-equiv="refresh" content="0;url=${esc(wa)}">
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;font:16px system-ui,sans-serif;background:#fff;color:#111;text-align:center}
img{width:160px}a{display:inline-block;margin-top:24px;padding:12px 22px;border-radius:999px;background:#111;color:#fff;text-decoration:none}</style>
</head><body><div><img src="/public/lemo-invite.png" alt="LEMO"><p>Ouverture de WhatsApp…</p><a href="${esc(wa)}">Ouvrir la conversation</a></div>
<script>location.replace(${JSON.stringify(wa)});</script></body></html>`;
}
