// Serveur LEMO Mini : webhook Kapso + mini-CRM + simulateur (mode démo).
import crypto from 'node:crypto';
import express from 'express';
import QRCode from 'qrcode';
import { config, llmMode, kapsoLive } from './config.js';
import { initDb, query, one, dbKind } from './db.js';
import { verifySignature, sign, extractMessages } from './kapso.js';
import { handleInbound, createCollection, waLink, phoneHash, drainQueues } from './conversation.js';
import { buildReport } from './report.js';
import { startJobs } from './jobs.js';
import * as V from './views.js';
import { invitePage } from './invite-page.js';
import { cardPng } from './card.js';
import { dashboardPng } from './dashboard-card.js';
import { alertStats, sendNow, addDailyInfo } from './alerts.js';
import { PRESETS, presetConfig } from './optins.js';

// ---------------- Webhook ----------------
// 1) vérifie la signature, 2) enregistre l'événement (anti-doublon par X-Idempotency-Key),
// 3) répond 200 tout de suite, 4) traite en arrière-plan.
export async function receiveWebhook(rawBody, headers) {
  if (!verifySignature(rawBody, headers['x-webhook-signature'])) return { status: 401 };
  const event = headers['x-webhook-event'] || '';
  let payload;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return { status: 400 };
  }
  const key = headers['x-idempotency-key'] || crypto.createHash('sha256').update(rawBody).digest('hex');
  const row = await one(
    `insert into webhook_events (idempotency_key, payload) values ($1,$2) on conflict (idempotency_key) do nothing returning id`,
    [key, JSON.stringify({ event, payload })],
  );
  if (!row) return { status: 200, duplicate: true };
  const done = processEvent(row.id, event, payload);
  return { status: 200, done };
}

export async function processEvent(id, event, payload) {
  try {
    if (event === 'whatsapp.message.received') {
      for (const m of extractMessages(payload)) await handleInbound(m);
    }
    await query(`update webhook_events set status='done' where id=$1`, [id]);
  } catch (err) {
    console.error('[webhook] traitement échoué :', err);
    await query(`update webhook_events set status='error', error=$2 where id=$1`, [id, String(err.message).slice(0, 500)]);
  }
}

// ---------------- Authentification admin ----------------
export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}
function checkPassword(pw, stored) {
  const [, salt, hash] = String(stored).split('$');
  if (!salt || !hash) return false;
  const h = crypto.scryptSync(pw, Buffer.from(salt, 'hex'), 64);
  return crypto.timingSafeEqual(h, Buffer.from(hash, 'hex'));
}
function makeToken(companyId) {
  const exp = Date.now() + 12 * 3600 * 1000;
  const data = `${companyId}.${exp}`;
  return `${data}.${crypto.createHmac('sha256', config.appSecret).update(data).digest('hex')}`;
}
function readToken(token) {
  const [id, exp, sig] = String(token || '').split('.');
  if (!id || !exp || !sig) return null;
  const expected = crypto.createHmac('sha256', config.appSecret).update(`${id}.${exp}`).digest('hex');
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  return Number(exp) > Date.now() ? id : null;
}
function cookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=').map(decodeURIComponent)).filter((p) => p[0]));
}

const loginAttempts = new Map();

export function createApp() {
  const app = express();
  app.disable('x-powered-by');

  app.get('/health', (_req, res) => res.json({ ok: true, db: dbKind(), ai: llmMode(), whatsapp: kapsoLive() ? 'kapso' : 'simulated' }));

  // ---------------- Lien d'invitation ----------------
  // Page d'aperçu (logo + titre) lue par WhatsApp quand le lien est partagé, puis redirection
  // immédiate vers la conversation WhatsApp avec « Hey LEMO ! » prérempli. Rien à installer.
  app.use('/public', express.static(new URL('../public', import.meta.url).pathname, { maxAge: '7d' }));
  // Schéma personnalisé envoyé sur WhatsApp à la fin de la première expérience (adresse non devinable).
  // « Vue dirigeant » fictive envoyée à la fin du parcours (même image pour tous).
  app.get('/v/dirigeant.png', (_req, res) => res.set('Content-Type', 'image/png').set('Cache-Control', 'public, max-age=86400').send(dashboardPng()));
  app.get('/m/:file', async (req, res) => {
    const token = req.params.file.replace(/\.png$/, '');
    const m = token.length >= 12 ? await one(`select first_name, report from members where card_token=$1`, [token]) : null;
    if (!m?.report) return res.status(404).send('Introuvable');
    const report = typeof m.report === 'string' ? JSON.parse(m.report) : m.report;
    res.set('Content-Type', 'image/png').set('Cache-Control', 'public, max-age=86400').send(cardPng(report, m.first_name));
  });

  // Suivi de l'entonnoir : clic sur « Continuer » (le prénom n'est pas enregistré ici).
  app.post('/i/evt', async (req, res) => {
    const code = String(req.query.c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12) || null;
    if (req.query.k === 'continue') await query(`insert into invite_events (kind, code) values ('continue',$1)`, [code]).catch(() => {});
    res.sendStatus(204);
  });

  // Lien général (/i : « Florio t'invite sur LEMO ») ou lien personnel d'un membre (/i/CODE : « Marc t'invite sur LEMO »).
  app.get(['/i', '/i/:code'], async (req, res) => {
    let code = null;
    let inviter = null;
    if (req.params.code) {
      const m = await one(`select first_name, invite_code from members where invite_code=$1`, [req.params.code.toUpperCase()]);
      if (m) ({ invite_code: code, first_name: inviter } = m);
    }
    // les robots d'aperçu (WhatsApp, réseaux) ne comptent pas comme des visites
    if (!/whatsapp|facebookexternalhit|bot|crawler|preview/i.test(req.get('user-agent') || '')) {
      await query(`insert into invite_events (kind, code) values ('view',$1)`, [code]).catch(() => {});
    }
    const wa = `https://wa.me/${config.whatsappDisplayNumber}?text=${encodeURIComponent('Hey LEMO !')}`;
    res.send(invitePage({ wa, waNumber: config.whatsappDisplayNumber, base: config.publicUrl, inviter: inviter || config.founderName, code }));
  });

  app.post('/webhooks/kapso', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
    const r = await receiveWebhook(req.body, req.headers);
    res.sendStatus(r.status);
  });

  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());

  // Protection CSRF simple : les POST doivent venir de notre propre origine.
  app.use((req, res, next) => {
    if (req.method !== 'POST') return next();
    const origin = req.headers.origin;
    if (origin && new URL(origin).host !== req.headers.host) return res.sendStatus(403);
    next();
  });

  app.get('/login', (_req, res) => res.send(V.layout({ title: 'Connexion', body: V.loginPage() })));
  app.post('/login', async (req, res) => {
    const ip = req.ip;
    const a = loginAttempts.get(ip) || { n: 0, t: Date.now() };
    if (Date.now() - a.t > 15 * 60 * 1000) Object.assign(a, { n: 0, t: Date.now() });
    if (a.n >= 10) return res.status(429).send(V.layout({ title: 'Connexion', body: V.loginPage('Trop de tentatives, réessayez dans 15 minutes.') }));
    const c = await one('select * from companies where lower(admin_email)=lower($1)', [req.body.email || '']);
    if (!c || !checkPassword(req.body.password || '', c.admin_password_hash)) {
      a.n++;
      loginAttempts.set(ip, a);
      return res.status(401).send(V.layout({ title: 'Connexion', body: V.loginPage('Identifiants incorrects.') }));
    }
    loginAttempts.delete(ip);
    const secure = config.publicUrl.startsWith('https') ? '; Secure' : '';
    res.setHeader('Set-Cookie', `lemo_session=${encodeURIComponent(makeToken(c.id))}; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200${secure}`);
    res.redirect('/');
  });
  app.get('/logout', (_req, res) => {
    res.setHeader('Set-Cookie', 'lemo_session=; Path=/; Max-Age=0');
    res.redirect('/login');
  });

  // Toutes les routes suivantes exigent une session ; chaque entreprise ne voit que ses données.
  const auth = async (req, res, next) => {
    const id = readToken(cookies(req).lemo_session);
    const company = id ? await one('select * from companies where id=$1', [id]) : null;
    if (!company) return res.redirect('/login');
    req.company = company;
    next();
  };
  const banner = () => ({
    demo: config.demoMode && !kapsoLive(),
    text: [
      config.demoMode && !kapsoLive() ? 'Mode démo : aucun message WhatsApp réel n’est envoyé. Utilisez le <a href="/demo">simulateur</a>.' : '',
      llmMode() === 'simulated' ? 'Analyse IA simulée (pas de clé Claude configurée) : résultats indicatifs uniquement.' : '',
    ]
      .filter(Boolean)
      .join(' '),
  });
  const page = (req, title, body) => V.layout({ title, body, company: req.company, banner: banner() });

  const ownCollection = (req) => one('select * from collections where id=$1 and company_id=$2', [req.params.id, req.company.id]);

  app.get('/', auth, async (req, res) => {
    const collections = await query(
      `select c.*, (select count(*)::int from feedbacks f where f.collection_id=c.id) as n,
              (select count(*)::int from feedbacks f where f.collection_id=c.id and f.urgency in ('high','medium')) as alerts
       from collections c where c.company_id=$1 order by c.created_at desc`,
      [req.company.id],
    );
    res.send(page(req, 'Collectes', V.dashboardPage({ collections, presets: PRESETS })));
  });

  app.post('/collections', auth, async (req, res) => {
    // "feedback" = question ouverte ; sinon nom d'un modèle de lien d'inscription (src/optins.js)
    const preset = PRESETS[req.body.kind] ? req.body.kind : null;
    const kind = preset ? 'alerts' : 'feedback';
    const cfg = preset ? presetConfig(preset) : null;
    const title = String(req.body.title || '').trim().slice(0, 80) || cfg?.title || '';
    const question = String(req.body.question || '').trim().slice(0, 300) || cfg?.eod_question || 'Comment avez-vous vécu votre expérience ? Racontez-nous librement, par écrit ou en vocal.';
    if (!title || !question) return res.redirect('/');
    if (cfg && req.body.question?.trim()) cfg.eod_question = question;
    const col = await createCollection(req.company.id, title, question, kind, cfg);
    res.redirect(`/collections/${col.id}`);
  });

  app.get('/collections/:id', auth, async (req, res) => {
    const col = await ownCollection(req);
    if (!col) return res.sendStatus(404);
    let report;
    let synthesisError = null;
    try {
      report = await buildReport(col, req.company);
    } catch (err) {
      console.error('[synthèse]', err.message);
      synthesisError = 'La synthèse n’a pas pu être générée. Réessayez.';
      report = { ...(await import('./report.js').then((m) => m.collectionStats(col.id))), threshold: req.company.privacy_threshold, belowThreshold: false, synthesis: null };
    }
    const feedbacks = await query('select * from feedbacks where collection_id=$1 order by created_at desc', [col.id]);
    const alertData = col.kind === 'alerts' ? await alertStats(col) : null;
    res.send(page(req, col.title, V.collectionPage({ col, report, feedbacks, link: waLink(col.code, col.kind), synthesisError, alertData, notice: req.query.notice })));
  });

  app.get('/collections/:id/qr.png', auth, async (req, res) => {
    const col = await ownCollection(req);
    if (!col) return res.sendStatus(404);
    res.type('png').send(await QRCode.toBuffer(waLink(col.code, col.kind), { width: 400, margin: 1 }));
  });

  app.post('/collections/:id/status', auth, async (req, res) => {
    const col = await ownCollection(req);
    if (!col) return res.sendStatus(404);
    await query('update collections set status=$2 where id=$1', [col.id, col.status === 'open' ? 'closed' : 'open']);
    res.redirect(`/collections/${col.id}`);
  });

  app.post('/collections/:id/send-now', auth, async (req, res) => {
    const col = await ownCollection(req);
    if (!col || col.kind !== 'alerts') return res.sendStatus(404);
    const r = await sendNow(col.id, req.body.type === 'eod' ? 'eod' : 'morning');
    const notice = `${r.sent} message(s) envoyé(s)${r.skipped ? `, ${r.skipped} non envoyé(s) : fenêtre WhatsApp de 24 h fermée` : ''}${r.noInfo ? `, ${r.noInfo} sans info du jour à envoyer` : ''}.`;
    res.redirect(`/collections/${col.id}?notice=${encodeURIComponent(notice)}`);
  });

  app.post('/collections/:id/daily-info', auth, async (req, res) => {
    const col = await ownCollection(req);
    if (!col || col.kind !== 'alerts') return res.sendStatus(404);
    const day = /^\d{4}-\d{2}-\d{2}$/.test(req.body.day || '') ? req.body.day : null;
    const body = String(req.body.body || '').trim().slice(0, 500);
    if (day && body) await addDailyInfo(col.id, day, body);
    res.redirect(`/collections/${col.id}?notice=${encodeURIComponent(day && body ? 'Info du jour enregistrée.' : 'Date ou texte manquant.')}`);
  });

  app.post('/collections/:id/synthesis', auth, async (req, res) => {
    const col = await ownCollection(req);
    if (!col) return res.sendStatus(404);
    await buildReport(col, req.company, { force: true }).catch((e) => console.error(e.message));
    res.redirect(`/collections/${col.id}`);
  });

  app.get('/early-adopters', auth, async (req, res) => {
    const funnel = await one(`select
      (select count(*)::int from invite_events where kind='view') as views,
      (select count(*)::int from invite_events where kind='continue') as continues,
      (select count(*)::int from members) as hey,
      (select count(*)::int from members where experience is not null) as told,
      (select count(*)::int from members where report is not null) as reported,
      (select count(*)::int from members where invited_by is not null) as invited`);
    const members = await query(`select m.*, i.first_name as inviter, (select count(*)::int from members x where x.invited_by=m.id) as invited_count
      from members m left join members i on i.id=m.invited_by order by m.updated_at desc limit 300`);
    for (const m of members) if (typeof m.report === 'string') m.report = JSON.parse(m.report);
    res.send(page(req, 'Early adopters', V.earlyAdoptersPage({ funnel, members })));
  });

  app.get('/settings', auth, (req, res) => res.send(page(req, 'Réglages', V.settingsPage({ company: req.company, saved: req.query.saved }))));
  app.post('/settings', auth, async (req, res) => {
    const phones = String(req.body.owner_phones || '').split(',').map((p) => p.replace(/[^0-9]/g, '')).filter((p) => p.length >= 8);
    const threshold = Math.min(100, Math.max(1, Number(req.body.privacy_threshold) || 5));
    const retention = Math.min(730, Math.max(1, Number(req.body.retention_days) || 90));
    const readers = String(req.body.reader_phones || '').split(',').map((p) => p.replace(/[^0-9]/g, '')).filter((p) => p.length >= 8);
    await query('update companies set owner_phones=$2, privacy_threshold=$3, retention_days=$4, reader_phones=$5 where id=$1', [req.company.id, phones, threshold, retention, readers]);
    res.redirect('/settings?saved=1');
  });

  // ---------------- Simulateur (mode démo, jamais quand Kapso est branché) ----------------
  if (config.demoMode && !kapsoLive()) {
    const secret = config.kapsoWebhookSecret || (config.kapsoWebhookSecret = crypto.randomBytes(16).toString('hex'));
    app.get('/demo', auth, async (req, res) => {
      const collections = await query(`select * from collections where company_id=$1 and status='open' order by created_at desc`, [req.company.id]);
      res.send(page(req, 'Simulateur', V.demoPage({ collections, ownerPhone: req.company.owner_phones[0] || '33600000000' })));
    });
    app.post('/demo/send', auth, async (req, res) => {
      const phone = String(req.body.phone || '').replace(/[^0-9]/g, '');
      const text = String(req.body.text || '');
      const body = Buffer.from(JSON.stringify(fakeInbound({ phone, text, audio: Boolean(req.body.audio) })));
      const r = await receiveWebhook(body, {
        'x-webhook-signature': sign(body, secret),
        'x-webhook-event': 'whatsapp.message.received',
        'x-idempotency-key': crypto.randomUUID(),
      });
      res.sendStatus(r.status);
    });
    app.get('/demo/thread', auth, async (req, res) => {
      const phone = String(req.query.phone || '').replace(/[^0-9]/g, '');
      res.json(await query('select direction, kind, body, transcript from messages where phone_hash=$1 order by seq desc limit 60', [phoneHash(phone)]).then((r) => r.reverse()));
    });
  }

  return app;
}

// Construit un payload identique à un webhook Kapso v2 "whatsapp.message.received".
export function fakeInbound({ phone, text, audio = false, buttonId = null }) {
  const id = `wamid.demo.${crypto.randomUUID()}`;
  const message = audio
    ? { id, timestamp: String(Math.floor(Date.now() / 1000)), type: 'audio', from: phone, audio: { id: 'media_demo' }, kapso: { direction: 'inbound', status: 'received', has_media: true, transcript: { text } } }
    : buttonId
      ? { id, timestamp: String(Math.floor(Date.now() / 1000)), type: 'interactive', from: phone, interactive: { type: 'button_reply', button_reply: { id: buttonId, title: text } }, kapso: { direction: 'inbound', status: 'received', content: text } }
      : { id, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', from: phone, text: { body: text }, kapso: { direction: 'inbound', status: 'received', has_media: false, content: text } };
  return { message, conversation: { id: `conv_${phone}`, phone_number: phone, phone_number_id: config.kapsoPhoneNumberId || 'demo' }, is_new_conversation: false, phone_number_id: config.kapsoPhoneNumberId || 'demo' };
}

// Création du premier compte entreprise depuis les variables d'environnement
// (ADMIN_EMAIL, ADMIN_PASSWORD, COMPANY_NAME, OWNER_PHONE). Sans effet si le compte existe déjà.
async function bootstrapAdmin() {
  const email = (process.env.ADMIN_EMAIL || '').trim();
  const password = (process.env.ADMIN_PASSWORD || '').trim();
  if (!email || !password) return;
  if (password.length < 10) return console.error('[admin] ADMIN_PASSWORD trop court (10 caractères minimum), compte non créé');
  if (await one('select 1 from companies where lower(admin_email)=lower($1)', [email])) return;
  const phones = (process.env.OWNER_PHONE || '').split(',').map((p) => p.replace(/[^0-9]/g, '')).filter(Boolean);
  await query(`insert into companies (name, admin_email, admin_password_hash, owner_phones) values ($1,$2,$3,$4)`, [
    (process.env.COMPANY_NAME || 'Mon entreprise').trim(),
    email,
    hashPassword(password),
    phones,
  ]);
  console.log('[admin] compte entreprise créé');
}

export async function start() {
  await initDb();
  if (config.demoMode) {
    const { seedDemo } = await import('../scripts/seed-demo.js');
    await seedDemo();
  }
  await bootstrapAdmin();
  if (process.env.DEMO_VERBATIMS_FOR) {
    const { seedDemoVerbatims } = await import('../scripts/demo-verbatims/index.js');
    await seedDemoVerbatims(process.env.DEMO_VERBATIMS_FOR).catch((e) => console.error('[démo] chargement :', e.message));
  }
  // reprise des webhooks enregistrés mais non traités (ex : redémarrage)
  for (const e of await query(`select id, payload from webhook_events where status='pending' order by created_at`)) {
    const p = typeof e.payload === 'string' ? JSON.parse(e.payload) : e.payload;
    await processEvent(e.id, p.event, p.payload);
  }
  startJobs();
  const app = createApp();
  return app.listen(config.port, () => {
    console.log(`LEMO Mini sur ${config.publicUrl}  |  base: ${dbKind()}  |  IA: ${llmMode()}  |  WhatsApp: ${kapsoLive() ? 'Kapso' : 'simulé'}`);
  });
}

export { drainQueues };

if (import.meta.url === `file://${process.argv[1]}`) start();
