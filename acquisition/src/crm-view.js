// CRM Early adopters, dans l'esprit de la plateforme LEMO : barre latérale, cartes de chiffres, liste claire.
// Pensé d'abord pour le téléphone : sur mobile, la barre latérale devient un menu, chaque personne est une carte
// avec un gros bouton « Écrire sur WhatsApp » (message prêt, modifiable avant l'envoi).
// Les pages Collectes et Réglages gardent leur ancienne mise en page : on ne fait que les lier.

// Icône de l'écran d'accueil (iPhone, Android) et du navigateur : le logo LEMO.
const APP_ICONS = `<link rel="apple-touch-icon" sizes="180x180" href="/public/apple-touch-icon.png">
<link rel="icon" type="image/png" sizes="32x32" href="/public/favicon-32.png">
<link rel="manifest" href="/public/manifest.webmanifest">
<meta name="apple-mobile-web-app-title" content="LEMO"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">`;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const ICON = {
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  menu: '<line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/>',
  chat: '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>',
  chevron: '<polyline points="6 9 12 15 18 9"/>',
};
const icon = (name, size = 18) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name]}</svg>`;

const CSS = `
:root{--ink:#1A1A1A;--mute:#6B6B70;--soft:#9A9AA0;--line:#E9E9EC;--bg:#FFFFFF;--side:#FAFAFA;--hover:#F1F1F3;
  --blue:#2E6BFF;--green:#9FD9C4;--green-ink:#1E8A63;--red:#F2B3B3;--red-ink:#C2412F;--amber:#F5C76B;--wa:#1FA855}
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:var(--bg);color:var(--ink)}
body{font:15px/1.45 -apple-system,BlinkMacSystemFont,"Inter","Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
a{color:inherit;text-decoration:none}
button,textarea{font:inherit;color:inherit}
.shell{display:flex;min-height:100vh;min-height:100dvh}
.side{width:248px;flex:none;background:var(--side);border-right:1px solid var(--line);display:flex;flex-direction:column;padding:18px 12px;position:sticky;top:0;height:100vh;height:100dvh}
.brand{display:flex;align-items:center;justify-content:space-between;padding:4px 12px 18px}
.brand strong{font-size:13px;letter-spacing:.06em;text-transform:uppercase}
.nav a{display:flex;align-items:center;gap:12px;padding:9px 12px;border-radius:8px;color:#333;font-size:15px}
.nav a:hover{background:var(--hover)}
.nav a.on{background:#EDEDF0;font-weight:500}
.nav a svg{color:#555}
.nav .count{margin-left:auto;font-size:12px;color:var(--mute);background:#fff;border:1px solid var(--line);border-radius:99px;padding:0 8px}
.group{margin:22px 12px 6px;font-size:13px;color:var(--mute)}
.me{margin-top:auto;display:flex;align-items:center;gap:10px;padding:10px 12px;border-top:1px solid var(--line)}
.avatar{width:32px;height:32px;border-radius:50%;background:#ECECEF;display:grid;place-items:center;font-size:12px;font-weight:600;color:#444;flex:none}
.me .who{min-width:0;font-size:13px;line-height:1.3}.me .who span{display:block;color:var(--mute);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.me a{margin-left:auto;color:var(--mute);padding:6px;border-radius:6px}.me a:hover{background:var(--hover)}
.main{flex:1;min-width:0;padding:32px 40px 64px}
.top{display:none}
h1{font-size:24px;font-weight:600;letter-spacing:-.01em}
.sub{color:var(--mute);margin-top:4px}
.head{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap}
.ghost{display:inline-flex;align-items:center;gap:8px;border:1px solid var(--line);border-radius:10px;padding:9px 14px;background:#fff;font-size:14px;cursor:pointer}
.ghost:hover{background:var(--hover)}
.stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px;margin-top:24px}
.card{border:1px solid var(--line);border-radius:14px;background:#fff;padding:20px 22px}
.stat .label{color:#444;font-size:15px}
.stat .value{font-size:34px;font-weight:500;letter-spacing:-.02em;margin-top:8px;line-height:1}
.stat .hint{color:var(--mute);font-size:13px;margin-top:8px}
.funnel{margin-top:16px}
.funnel h2,.list-head h2{font-size:16px;font-weight:500}
.frow{display:grid;grid-template-columns:180px 1fr 44px;align-items:center;gap:14px;padding:9px 0;border-bottom:1px solid var(--line);font-size:14px}
.frow:last-child{border-bottom:0}
.bar{height:10px;border-radius:6px;background:var(--blue)}
.frow strong{text-align:right;font-weight:500}
.tabs{display:flex;gap:6px;margin:28px 0 12px;overflow-x:auto;scrollbar-width:none}
.tabs a{white-space:nowrap;padding:7px 14px;border-radius:99px;border:1px solid var(--line);font-size:14px;color:#444;background:#fff}
.tabs a.on{background:var(--ink);border-color:var(--ink);color:#fff}
.tabs a span{color:var(--soft);margin-left:6px}.tabs a.on span{color:#BBB}
.people{border:1px solid var(--line);border-radius:14px;overflow:hidden;background:#fff}
.person{border-bottom:1px solid var(--line)}.person:last-child{border-bottom:0}
.row{display:grid;grid-template-columns:minmax(180px,1.1fr) minmax(0,2fr) 150px auto;gap:18px;align-items:center;padding:16px 20px}
.id{display:flex;align-items:center;gap:12px;min-width:0}
.id .name{font-weight:500}.id .meta{color:var(--mute);font-size:13px}
.moment{font-size:14px;color:#333;min-width:0}
.moment .blind{color:var(--mute);margin-top:2px}
.moment .clip{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.pill{display:inline-flex;align-items:center;gap:7px;font-size:13px;color:#333;white-space:nowrap}
.dot{width:8px;height:8px;border-radius:50%;background:var(--soft)}
.dot.todo{background:var(--blue)}.dot.done{background:var(--green-ink)}.dot.stop{background:var(--red-ink)}.dot.wip{background:var(--amber)}
.actions{display:flex;align-items:center;gap:8px;justify-content:flex-end}
.wa{display:inline-flex;align-items:center;justify-content:center;gap:8px;background:var(--ink);color:#fff;border:0;border-radius:10px;padding:10px 16px;font-size:14px;font-weight:500;cursor:pointer;white-space:nowrap}
.wa:hover{background:#000}
.more{border:1px solid var(--line);background:#fff;border-radius:10px;width:40px;height:40px;display:grid;place-items:center;cursor:pointer;color:#555}
.more svg{transition:transform .2s}.person.open .more svg{transform:rotate(180deg)}
.detail{display:none;padding:4px 20px 22px;background:#FCFCFD;border-top:1px solid var(--line)}
.person.open .detail{display:grid;grid-template-columns:1fr 1fr;gap:20px}
.detail h3{font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--mute);margin:18px 0 8px}
.detail p,.detail pre{font-size:14px;color:#333;white-space:pre-wrap;font-family:inherit}
.quote{border-left:3px solid var(--line);padding-left:12px}
.detail textarea{width:100%;min-height:120px;border:1px solid var(--line);border-radius:10px;padding:12px;font-size:14px;background:#fff;resize:vertical}
.detail .send{margin-top:10px;display:flex;gap:8px;flex-wrap:wrap}
.empty{padding:40px 20px;text-align:center;color:var(--mute)}
.note{color:var(--mute);font-size:13px;margin-top:10px}
.inv{margin-top:2px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.inv form{display:inline}
.chip{border:1px solid var(--line);background:#fff;border-radius:99px;padding:5px 12px;font-size:13px;cursor:pointer}
.chip:hover{background:var(--hover)}
.invitees{color:var(--mute);font-size:13px;margin-top:6px}
.form{max-width:560px;display:grid;gap:18px}
.field label{display:block;font-size:14px;font-weight:500;margin-bottom:6px}
.field input{width:100%;border:1px solid var(--line);border-radius:10px;padding:11px 12px;font:inherit;font-size:15px;background:#fff}
.field input:focus{outline:3px solid rgba(46,107,255,.15);border-color:#999}
.field .help{color:var(--mute);font-size:13px;margin-top:6px}
.saved{color:var(--green-ink);font-size:14px}
.kv{display:grid;grid-template-columns:160px 1fr;gap:8px 16px;font-size:14px}.kv span{color:var(--mute)}
code{font:13px ui-monospace,SFMono-Regular,Menlo,monospace;background:#F4F4F6;border-radius:6px;padding:2px 6px;word-break:break-all}
@media (max-width:1100px){.row{grid-template-columns:minmax(160px,1fr) minmax(0,1.6fr) auto}.row .state{display:none}}
@media (max-width:820px){
  .stats[style*="repeat(2"]{grid-template-columns:1fr!important}
  .side{position:fixed;z-index:20;left:0;top:0;transform:translateX(-100%);transition:transform .25s;box-shadow:0 0 40px rgba(0,0,0,.12)}
  .side.show{transform:none}
  .scrim{display:none;position:fixed;inset:0;background:rgba(0,0,0,.25);z-index:10}.scrim.show{display:block}
  .top{display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:5;background:rgba(255,255,255,.95);backdrop-filter:blur(8px);border-bottom:1px solid var(--line);padding:12px 16px}
  .top strong{font-size:13px;letter-spacing:.06em;text-transform:uppercase}
  .top button{background:none;border:0;padding:6px;cursor:pointer}
  .main{padding:20px 16px 48px}
  h1{font-size:22px}
  .stats{grid-template-columns:1fr 1fr;gap:10px;margin-top:18px}
  .card{padding:16px}
  .stat .value{font-size:28px}
  .frow{grid-template-columns:120px 1fr 36px;font-size:13px}
  .head .ghost{width:100%;justify-content:center}
  .people{border:0;border-radius:0;background:none;display:grid;gap:12px}
  .person{border:1px solid var(--line);border-radius:14px;background:#fff;overflow:hidden}
  .row{grid-template-columns:1fr;gap:12px;padding:16px}
  .row .state{display:flex}
  .actions{justify-content:stretch}.actions .wa{flex:1;padding:13px 16px;font-size:15px}
  .person.open .detail{grid-template-columns:1fr;gap:0}
  .detail{padding:0 16px 18px}
  .kv{grid-template-columns:1fr;gap:2px}.kv span{margin-top:10px}
}
`;

const STEP = {
  awaiting_experience: ['wip', 'Accueilli'],
  awaiting_blindspot: ['wip', 'En cours'],
  awaiting_projection: ['todo', 'À recontacter'],
  experienced: ['todo', 'À recontacter'],
};

function status(m) {
  if (m.opted_out_at) return ['stop', 'STOP, ne plus contacter'];
  if (m.contacted_at) return ['done', `Contacté ${ago(m.contacted_at)}`];
  return STEP[m.state] || ['wip', m.state];
}

export function ago(date, now = Date.now()) {
  const s = Math.max(0, (now - new Date(date).getTime()) / 1000);
  if (s < 60) return "à l'instant";
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`;
  const d = Math.floor(s / 86400);
  return d === 1 ? 'hier' : `il y a ${d} jours`;
}

const initials = (n) => String(n || '?').trim().slice(0, 2).toUpperCase();
const phoneFmt = (p) => (p ? `+${p}`.replace(/^\+33(\d)(\d{2})(\d{2})(\d{2})(\d{2})$/, '+33 $1 $2 $3 $4 $5') : '');

export function defaultMessage(m) {
  return m.report?.founder_message || `Salut ${m.first_name || ''}, c’est Florio, fondateur de LEMO. Merci d’avoir testé LEMO ! Si cela éveille ton intérêt, serais-tu dispo pour en discuter ?`.replace('Salut ,', 'Salut,');
}

// Invitations d'une personne : combien d'invités sont arrivés, combien il en reste, et de quoi en ajouter.
function invitesHtml(m) {
  if (!m.invite_code) return '<p>Débloquées à la fin de son parcours.</p>';
  const left = Math.max(0, m.invites_total - m.invited_count);
  const add = (n) => `<form method="post" action="/early-adopters/${esc(m.id)}/invites"><input type="hidden" name="add" value="${n}"><button class="chip" type="submit">+ ${n}</button></form>`;
  return `<div class="inv"><span><strong>${m.invited_count}</strong> invité${m.invited_count > 1 ? 's' : ''} arrivé${m.invited_count > 1 ? 's' : ''} · <strong>${left}</strong> restante${left > 1 ? 's' : ''} sur ${m.invites_total}</span>${add(1)}${add(5)}</div>
    ${m.invitees ? `<div class="invitees">Invités : ${esc(m.invitees)}</div>` : ''}`;
}

// Campagne créée par la personne (variante B) : la question posée et les retours reçus.
function campaignHtml(c) {
  const done = c.responses.filter((r) => r.state === 'done');
  const live = c.responses.filter((r) => r.state !== 'done' && r.state !== 'stopped').length;
  return `<h3>Campagne · ${esc(c.title)}</h3>
    <p class="quote">${esc(c.question)}</p>
    <p class="invitees">${done.length} réponse${done.length > 1 ? 's' : ''} complète${done.length > 1 ? 's' : ''}${live ? ` · ${live} en cours` : ''} · ${esc(ago(c.created_at))}</p>
    ${done.map((r, i) => `<p style="margin-top:10px"><strong>Retour ${i + 1}</strong><br>${(r.analysis?.lemo_lines || []).filter((l) => !/^d[ée]tail/i.test(l.label)).slice(0, 3).map((l) => `<strong>${esc(l.label)} :</strong> ${esc(l.text)}`).join('<br>')}</p>`).join('')}`;
}

// Test A/B de la fin de parcours : combien voient, cliquent, vont au bout, de chaque côté.
function abHtml(ab) {
  const pct = (n, base) => (base ? `${Math.round((n / base) * 100)} %` : '');
  const rows = (v, steps) => steps.map(([label, n, base]) => `<div class="frow"><span>${label}</span><div><div class="bar" style="width:${Math.max(1.5, (n / Math.max(1, v.shown)) * 100)}%;${base === 'b' ? 'background:#E8856B' : ''}"></div></div><strong>${n}<span class="soft" style="color:var(--soft);font-weight:400;font-size:12px;display:block">${pct(n, v.shown)}</span></strong></div>`).join('');
  return `<h2 style="font-size:16px;font-weight:500;margin-top:28px">Test A/B · fin de parcours</h2>
  <p class="sub" style="font-size:13px">Un parcours sur deux reçoit A, l’autre B. Pourcentages calculés sur les personnes qui ont vu le message.</p>
  <section class="stats" style="grid-template-columns:repeat(2,minmax(0,1fr));margin-top:12px">
    <div class="card"><h2 style="font-size:16px;font-weight:500">A · « Envoyer l’invitation »</h2>
      <p class="sub" style="font-size:13px">5 invitations à transférer, message prêt.</p>
      <div style="margin-top:8px">${rows(ab.A, [['Message vu', ab.A.shown], ['Bouton touché', ab.A.click], ['Invités arrivés', ab.A.arrived], ['Invités allés au bout', ab.A.done], ['Référent contacté', ab.A.referent]])}</div></div>
    <div class="card"><h2 style="font-size:16px;font-weight:500">B · « Créer ma campagne »</h2>
      <p class="sub" style="font-size:13px">Sujet choisi, question rédigée par LEMO, 5 personnes.</p>
      <div style="margin-top:8px">${rows(ab.B, [['Message vu', ab.B.shown, 'b'], ['Bouton touché', ab.B.click, 'b'], ['Campagne créée', ab.B.created, 'b'], ['Campagne transférée', ab.B.forwarded, 'b'], ['Participants arrivés', ab.B.started, 'b'], ['Réponses complètes', ab.B.done, 'b'], ['Référent contacté', ab.B.referent, 'b']])}</div></div>
  </section>`;
}

function personHtml(m) {
  const r = m.report || {};
  const [dot, label] = status(m);
  const canWrite = m.phone && !m.opted_out_at;
  const lines = (r.lemo_lines || []).filter((l) => !/^d[ée]tail/i.test(l.label)).slice(0, 3);
  const moment = m.opted_out_at ? '<span class="blind">Réponses supprimées à sa demande</span>'
    : `<div class="clip">${esc(r.key_moment || m.experience || 'Pas encore raconté')}</div>${r.blind_spot ? `<div class="blind clip">Angle mort : ${esc(r.blind_spot)}</div>` : ''}`;
  return `<article class="person" data-id="${esc(m.id)}">
  <div class="row">
    <div class="id"><div class="avatar">${esc(initials(m.first_name))}</div><div><div class="name">${esc(m.first_name || 'Sans prénom')}</div>
      <div class="meta">${esc(ago(m.updated_at))} · invité par ${esc(m.inviter || 'lien général')}${m.invite_code ? ` · ${m.invited_count}/${m.invites_total} invitations` : ''}${m.variant ? ` · ${m.variant === 'A' ? 'A : invitation' : 'B : campagne'}` : ''}</div></div></div>
    <div class="moment">${moment}</div>
    <div class="state"><span class="pill"><span class="dot ${dot}"></span>${esc(label)}</span></div>
    <div class="actions">
      ${canWrite ? `<button class="wa" type="button" data-send>${icon('chat', 16)} Écrire sur WhatsApp</button>` : ''}
      <button class="more" type="button" data-toggle aria-label="Voir le détail">${icon('chevron', 18)}</button>
    </div>
  </div>
  <div class="detail">
    <div>
      ${m.experience ? `<h3>Son moment</h3><p class="quote">${esc(m.experience)}</p>` : ''}
      ${m.blindspot ? `<h3>${esc(m.followup || 'Relance')}</h3><p class="quote">${esc(m.blindspot)}</p>` : ''}
      ${lines.length ? `<h3>Vu par LEMO${r.thin ? ' · sur un exemple' : ''}</h3><p>${lines.map((l) => `<strong>${esc(l.label)} :</strong> ${esc(l.text)}`).join('<br>')}</p>` : ''}
      ${m.phone ? `<h3>Téléphone</h3><p>${esc(phoneFmt(m.phone))}</p>` : ''}
      <h3>Invitations</h3>${invitesHtml(m)}
      ${(m.campaigns || []).map(campaignHtml).join('')}
    </div>
    <div>
      ${canWrite ? `<h3>Message prêt (modifiable)</h3>
      <textarea data-msg>${esc(defaultMessage(m))}</textarea>
      <div class="send"><button class="wa" type="button" data-send data-phone="${esc(m.phone)}">${icon('chat', 16)} Envoyer depuis mon WhatsApp</button></div>
      <p class="note">Ne cite pas ce qu’il ou elle a confié à LEMO : garde-le pour la discussion de vive voix.</p>` : ''}
    </div>
  </div>
</article>`;
}

// Habillage commun : barre latérale (menu sur mobile), compte en bas, contenu à droite.
export function shell({ company, active, todo = 0, title, body, script = '' }) {
  const nav = `
  <div class="brand"><strong>LEMO</strong><span class="sub" style="font-size:12px;margin:0">Acquisition</span></div>
  <nav class="nav">
    <a class="${active === 'members' ? 'on' : ''}" href="/early-adopters">${icon('users')} Early adopters <span class="count">${todo}</span></a>
  </nav>
  <div class="group">Administration</div>
  <nav class="nav">
    <a class="${active === 'settings' ? 'on' : ''}" href="/settings">${icon('settings')} Réglages</a>
  </nav>
  <div class="me"><div class="avatar">${esc(initials(company.name))}</div><div class="who">${esc(company.name)}<span>${esc(company.admin_email)}</span></div>
    <a href="/logout" title="Sortir" aria-label="Sortir">${icon('logout', 17)}</a></div>`;
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#FFFFFF">${APP_ICONS}<title>${esc(title)} · LEMO</title><style>${CSS}</style></head><body>
<div class="shell">
  <aside class="side" id="side">${nav}</aside>
  <div class="scrim" id="scrim"></div>
  <div style="flex:1;min-width:0">
    <header class="top"><button type="button" id="open" aria-label="Menu">${icon('menu', 22)}</button><strong>LEMO</strong><span style="width:34px"></span></header>
    <main class="main">${body}</main>
  </div>
</div>
<script>
(function(){
  var side=document.getElementById('side'),scrim=document.getElementById('scrim');
  function menu(on){side.classList.toggle('show',on);scrim.classList.toggle('show',on)}
  document.getElementById('open').addEventListener('click',function(){menu(true)});
  scrim.addEventListener('click',function(){menu(false)});
})();
${script}
</script>
</body></html>`;
}

export function earlyAdoptersView({ company, funnel, members, counts, filter, inviteUrl, ab }) {
  const steps = [
    ['Page ouverte', funnel.views],
    ['Prénom saisi', funnel.continues],
    ['« Hey LEMO » envoyé', funnel.hey],
    ['Moment raconté', funnel.told],
    ['Parcours terminé', funnel.reported],
    ['Invités arrivés', funnel.invited],
  ];
  const top = Math.max(1, ...steps.map((x) => x[1]));
  const tabs = [['todo', 'À recontacter'], ['wip', 'En cours'], ['done', 'Contactés'], ['all', 'Tous']];
  const body = `
      <div class="head">
        <div><h1>Early adopters</h1><p class="sub">Les personnes arrivées par invitation, et celles à recontacter.</p></div>
        <button class="ghost" type="button" id="copy" data-url="${esc(inviteUrl)}">${icon('link', 16)} Copier mon lien d’invitation</button>
      </div>
      <section class="stats">
        <div class="card stat"><div class="label">À recontacter</div><div class="value">${counts.todo}</div><div class="hint">parcours terminés, pas encore contactés</div></div>
        <div class="card stat"><div class="label">Parcours terminés</div><div class="value">${funnel.reported}</div><div class="hint">sur ${funnel.hey} arrivés sur WhatsApp</div></div>
        <div class="card stat"><div class="label">Contactés</div><div class="value">${counts.done}</div><div class="hint">depuis cette page</div></div>
        <div class="card stat"><div class="label">Invités arrivés</div><div class="value">${funnel.invited}</div><div class="hint">grâce aux liens personnels</div></div>
      </section>
      <section class="card funnel"><h2>Du lien à la conversation</h2><div style="margin-top:8px">
        ${steps.map(([l, n]) => `<div class="frow"><span>${l}</span><div><div class="bar" style="width:${Math.max(1.5, (n / top) * 100)}%"></div></div><strong>${n}</strong></div>`).join('')}
      </div></section>
      ${ab ? abHtml(ab) : ''}
      <nav class="tabs">${tabs.map(([k, l]) => `<a href="?f=${k}" class="${filter === k ? 'on' : ''}">${l}<span>${counts[k]}</span></a>`).join('')}</nav>
      <section class="people">${members.length ? members.map(personHtml).join('') : '<div class="empty">Personne ici pour l’instant.</div>'}</section>
`;
  return shell({ company, active: 'members', todo: counts.todo, title: 'Early adopters', body, script: `(function(){
  document.getElementById('copy').addEventListener('click',function(e){
    var b=e.currentTarget,u=b.getAttribute('data-url');
    (navigator.clipboard?navigator.clipboard.writeText(u):Promise.reject()).then(function(){b.lastChild.textContent=' Lien copié'},function(){prompt('Ton lien d’invitation',u)});
  });
  document.querySelectorAll('.person').forEach(function(p){
    var t=p.querySelector('[data-toggle]');
    if(t)t.addEventListener('click',function(){p.classList.toggle('open')});
    p.querySelectorAll('[data-send]').forEach(function(btn){
      btn.addEventListener('click',function(){
        var box=p.querySelector('[data-msg]');
        if(!p.classList.contains('open')&&!btn.hasAttribute('data-phone')){p.classList.add('open');box&&box.focus();return}
        var phone=(p.querySelector('[data-phone]')||btn).getAttribute('data-phone');
        fetch('/early-adopters/'+p.getAttribute('data-id')+'/contacted',{method:'POST',keepalive:true}).catch(function(){});
        location.href='https://wa.me/'+phone+'?text='+encodeURIComponent(box?box.value:'');
      });
    });
  });
})();` });
}


export function settingsView({ company, settings, saved, todo }) {
  const body = `<div class="head"><div><h1>Réglages</h1><p class="sub">Où tu reçois les alertes, et ton numéro.</p></div></div>
  <form class="card form" method="post" action="/settings" style="margin-top:24px">
    ${saved ? '<p class="saved">Enregistré.</p>' : ''}
    <div class="field"><label for="alert_email">E-mail d’alerte</label>
      <input id="alert_email" name="alert_email" type="email" value="${esc(settings.alert_email || '')}" placeholder="toi@exemple.fr" autocomplete="email">
      <p class="help">Un e-mail à chaque parcours terminé : prénom et qui l’a invité, jamais ce que la personne a confié.${settings.email_ready ? '' : ' L’envoi démarre une fois la clé Resend ajoutée sur Railway (variable RESEND_API_KEY).'}</p></div>
    <div class="field"><label for="owner_phone">Ton numéro WhatsApp</label>
      <input id="owner_phone" name="owner_phone" inputmode="tel" value="${esc((company.owner_phones || [])[0] || '')}" placeholder="33612345678">
      <p class="help">Format international, sans le +. Sert à retrouver ton lien d’invitation personnel.</p></div>
    <div><button class="wa" type="submit">Enregistrer</button></div>
  </form>
  <section class="card" style="margin-top:16px;max-width:560px">
    <h2 style="font-size:16px;font-weight:500;margin-bottom:12px">Notifications sur ton téléphone</h2>
    <div class="kv"><span>Appli</span><div>ntfy (gratuite, sans compte)</div>
      <span>Sujet à suivre</span><div>${settings.ntfy_topic ? `<code>${esc(settings.ntfy_topic)}</code>` : 'non configuré'}</div></div>
  </section>
  <section class="card" style="margin-top:16px;max-width:560px">
    <h2 style="font-size:16px;font-weight:500;margin-bottom:12px">Compte</h2>
    <div class="kv"><span>Identifiant</span><div>${esc(company.admin_email)}</div>
      <span>Mot de passe</span><div>variable ADMIN_PASSWORD sur Railway</div>
      <span>Invitations</span><div>${settings.invites_per_member} par nouvel early adopter, à ajuster personne par personne</div></div>
  </section>`;
  return shell({ company, active: 'settings', todo, title: 'Réglages', body });
}

// Page de connexion aux couleurs de LEMO.
export function loginView({ error = '', logo }) {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#FFFFFF">${APP_ICONS}<title>Connexion · LEMO</title>
<style>
@font-face{font-family:'Montserrat';font-style:normal;font-weight:100 900;font-display:swap;src:url(/public/montserrat.woff2) format('woff2')}
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;background:#fff;color:#1A1A1A}
body{font-family:'Montserrat',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;-webkit-font-smoothing:antialiased;display:flex;align-items:center;justify-content:center;padding:24px}
.box{width:100%;max-width:360px;text-align:center}
.logo{color:#1A1A1A;display:inline-block}.logo svg{height:34px;width:auto;display:block}
h1{margin-top:36px;font-size:24px;font-weight:600;letter-spacing:-.02em}
p.sub{margin-top:8px;color:#555;font-size:14px}
form{margin-top:28px;display:grid;gap:10px;text-align:left}
label{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
input{width:100%;height:50px;border:1px solid #D8D8D8;border-radius:10px;padding:0 16px;font:500 16px 'Montserrat',sans-serif;color:#1A1A1A;outline:3px solid transparent;transition:border-color .16s,outline-color .16s}
input::placeholder{color:#767676;font-weight:400}
input:focus{border-color:#1A1A1A;outline-color:rgba(107,124,255,.18)}
button{margin-top:6px;height:50px;border:0;border-radius:6px;background:#1A1A1A;color:#fff;font:500 15px 'Montserrat',sans-serif;cursor:pointer;transition:background .14s}
button:hover{background:#6B7CFF}
.err{margin-top:14px;color:#C44033;font-size:14px}
</style></head><body>
<main class="box">
  <span class="logo" aria-label="LEMO">${logo}</span>
  <h1>Connexion</h1>
  <p class="sub">Ton espace early adopters.</p>
  <form method="post" action="/login">
    <label for="email">E-mail</label><input id="email" name="email" type="email" placeholder="E-mail" required autocomplete="username">
    <label for="password">Mot de passe</label><input id="password" name="password" type="password" placeholder="Mot de passe" required autocomplete="current-password">
    <button type="submit">Se connecter</button>
  </form>
  ${error ? `<p class="err">${esc(error)}</p>` : ''}
</main>
</body></html>`;
}


// Page ouverte par un participant (lien transféré par un dirigeant) : aperçu WhatsApp clair, puis WhatsApp aussitôt.
export function campaignPage({ campaign: c, wa, base }) {
  const vous = c.register === 'vous';
  const title = vous ? `${c.leader || 'On'} vous demande votre avis` : `${c.leader || 'On'} te demande ton avis`;
  const desc = 'Deux petites questions, une minute, sur WhatsApp. Par écrit ou en vocal.';
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#FFFFFF">${APP_ICONS}<title>${esc(title)}</title>
<meta property="og:type" content="website"><meta property="og:site_name" content="LEMO">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(base)}/public/lemo-thumb.png"><meta property="og:image:width" content="200"><meta property="og:image:height" content="200">
<meta name="twitter:card" content="summary">
<style>
@font-face{font-family:'Montserrat';font-style:normal;font-weight:100 900;font-display:swap;src:url(/public/montserrat.woff2) format('woff2')}
*{box-sizing:border-box;margin:0;padding:0}html,body{height:100%;background:#fff;color:#1A1A1A}
body{font-family:'Montserrat',-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center}
h1{font-size:22px;font-weight:600;letter-spacing:-.02em;margin-top:10px}p{color:#555;margin-top:10px;font-size:15px}
a.b{display:inline-block;margin-top:26px;background:#1A1A1A;color:#fff;text-decoration:none;border-radius:6px;padding:14px 22px;font-weight:500}
</style></head><body><main>
<h1>${esc(title)}</h1><p>${esc(desc)}</p><a class="b" href="${esc(wa)}">Ouvrir WhatsApp</a>
</main><script>location.replace(${JSON.stringify(wa).replace(/</g, '\\u003c')})</script></body></html>`;
}
