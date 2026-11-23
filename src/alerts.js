// Parcours d'inscription (opt-in) configurable :
// lien / QR code / NFC -> consentement -> questions de départ (choix unique, multiple, jours)
// -> info du matin -> questions libres et retours à tout moment -> question de fin de journée, analysée comme un retour client.
// La configuration de chaque lien est dans collections.config (voir src/optins.js).
import { config as appConfig } from './config.js';
import { query, one } from './db.js';
import { reply, recordInbound } from './conversation.js';
import { sendTemplate } from './kapso.js';
import { answerAlertQuestion, analyzeFeedback } from './llm.js';
import { DEMO_NOTICE, dateLabel } from './cmb-data.js';
import { getConfig, fill, choiceLabel, morningBody, contextBody } from './optins.js';

const YES_RE = /^\s*(oui|ok|okay|d'accord|daccord|j'accepte|jaccepte|go|yes|ouais|bien s[uû]r|avec plaisir)\b/i;
const NO_RE = /^\s*(non|no|pas maintenant|non merci)\b/i;
const SETUP_STATES = ['awaiting_consent', 'choosing', 'choosing_domain', 'choosing_days'];
const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// ---------- Dates (heure de Paris) ----------
export function parisNow(d = new Date()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24 };
}
export function addDays(date, n) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const shortLabel = (date) => capital(dateLabel(date));

export function dayOptions(max = 3, today = parisNow().date) {
  const days = Array.from({ length: max }, (_, i) => addDays(today, i + 1));
  const rows = days.map((d) => ({ id: `days:${d}`, title: shortLabel(d).slice(0, 24), days: [d] }));
  if (max >= 2) rows.push({ id: `days:${days.slice(0, 2).join(',')}`, title: 'Les 2 prochains jours', days: days.slice(0, 2) });
  if (max >= 3) rows.push({ id: `days:${days.join(',')}`, title: `Les ${max} prochains jours`, days });
  return rows;
}

const WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
function parseDays(msg, max) {
  const allowed = dayOptions(max).at(-1).days;
  if (msg.buttonId?.startsWith('days:')) return msg.buttonId.slice(5).split(',').filter((d) => allowed.includes(d));
  const t = norm(msg.body);
  if (/(\d|deux|trois) (prochains )?jours|tous|tout/.test(t)) return allowed;
  if (/demain/.test(t) && !/apres-demain|apres demain/.test(t)) return [allowed[0]];
  return allowed.filter((d) => {
    const dt = new Date(`${d}T12:00:00Z`);
    return t.includes(WEEKDAYS[dt.getUTCDay()]) || new RegExp(`\\b${dt.getUTCDate()}\\b`).test(t);
  });
}

function parseSingle(msg, step) {
  const id = msg.buttonId?.replace(/^(opt|dom):/, '');
  if (id && step.options.some((o) => o.id === id)) return id;
  const t = norm(msg.body);
  const n = Number(t.match(/^\s*(\d+)\s*$/)?.[1]);
  if (n && step.options[n - 1]) return step.options[n - 1].id;
  return step.options.find((o) => t.includes(norm(o.id)) || norm(o.label).split(/[–-]/).some((part) => part.trim() && t.includes(part.trim())))?.id || null;
}

function parseMulti(msg, step) {
  const t = norm(msg.body);
  if (/\b(tout|tous|toutes)\b/.test(t)) return step.options.map((o) => o.id);
  const picked = new Set();
  for (const n of t.match(/\d+/g) || []) if (step.options[Number(n) - 1]) picked.add(step.options[Number(n) - 1].id);
  for (const o of step.options) if (t.includes(norm(o.label))) picked.add(o.id);
  if (msg.buttonId) {
    const id = msg.buttonId.replace(/^opt:/, '');
    if (step.options.some((o) => o.id === id)) picked.add(id);
  }
  return [...picked];
}

// Envoie la question de départ n° index.
async function askStep(phone, cfg, index, opts, prefix = '') {
  const step = cfg.steps[index];
  const q = `${prefix}${step.question}`;
  if (step.type === 'days') {
    return reply(phone, `${q} (${step.max} jours maximum)`, { ...opts, list: { button: 'Choisir les jours', rows: dayOptions(step.max).map(({ id, title }) => ({ id, title })) } });
  }
  if (step.type === 'single' && step.options.length <= 10) {
    return reply(phone, q, { ...opts, list: { button: 'Choisir', rows: step.options.map((o) => ({ id: `opt:${o.id}`, title: o.label, description: o.description })) } });
  }
  const lines = step.options.map((o, i) => `${i + 1}. ${o.label}`).join('\n');
  const how = step.type === 'multi' ? 'Répondez avec un ou plusieurs numéros (ex : 1 et 3), ou « tout ».' : 'Répondez avec le numéro.';
  return reply(phone, `${q}\n\n${lines}\n\n${how}`, opts);
}

// ---------- Abonnement ----------
export async function currentSubscription(hash) {
  return one(
    `select s.*, c.company_id, c.title, c.question, c.config, co.name as company_name
     from subscriptions s join collections c on c.id = s.collection_id join companies co on co.id = c.company_id
     where s.phone_hash = $1 and (
       (s.state = any($2) and s.updated_at > now() - interval '24 hours')
       or s.state = 'active')
     order by s.updated_at desc limit 1`,
    [hash, SETUP_STATES],
  );
}

export async function startSubscription(msg, hash, col) {
  const cfg = getConfig(col);
  if (col.status !== 'open') {
    if (!(await recordInbound(msg, { role: 'respondent', companyId: col.company_id }))) return 'ignored:duplicate';
    await reply(msg.phone, `Ce service de ${col.company_name} n'est plus disponible. Bonne journée !`, { companyId: col.company_id });
    return 'alerts_closed';
  }
  await query('delete from opt_outs where phone_hash = $1', [hash]); // envoyer le code vaut nouvelle inscription
  const existing = await one(`select id from subscriptions where phone_hash=$1 and collection_id=$2 and state='active'`, [hash, col.id]);
  await query(`update subscriptions set state='ended', phone=null, updated_at=now() where phone_hash=$1 and state = any($2)`, [hash, SETUP_STATES]);
  if (!(await recordInbound(msg, { role: 'respondent', companyId: col.company_id }))) return 'ignored:duplicate';
  const opts = { companyId: col.company_id };

  if (existing) {
    // déjà inscrit : on refait les choix, le consentement est acquis
    await query(`update subscriptions set state='choosing', step=0, choices='{}'::jsonb, days='{}', phone=$2, updated_at=now() where id=$1`, [existing.id, msg.phone]);
    await askStep(msg.phone, cfg, 0, opts, 'Vous êtes déjà inscrit. Modifions vos choix. ');
    return 'alerts_modify';
  }
  await query(`insert into subscriptions (collection_id, phone, phone_hash, state) values ($1,$2,$3,'awaiting_consent')`, [col.id, msg.phone, hash]);
  const eod = cfg.eod_hour != null ? ` Vers ${cfg.eod_hour}h, je vous demanderai comment cela s'est passé.` : '';
  await reply(
    msg.phone,
    `Bonjour ! Je suis l'assistant de *${col.company_name}*.\n\n${fill(cfg.intro, cfg)}${eod}\n\n` +
      `Vos messages sont analysés par une IA pour améliorer le service. Votre numéro est effacé après votre dernier jour. Écrivez STOP à tout moment pour arrêter.\n\nAcceptez-vous ?`,
    { ...opts, buttons: [{ id: 'alert_yes', title: "Oui, j'accepte" }, { id: 'alert_no', title: 'Non merci' }] },
  );
  return 'alerts_started';
}

export async function continueSetup(msg, hash, sub) {
  if (!(await recordInbound(msg, { role: 'respondent', companyId: sub.company_id }))) return 'ignored:duplicate';
  const cfg = getConfig(sub);
  const text = (msg.body || '').trim();
  const opts = { companyId: sub.company_id };

  if (sub.state === 'awaiting_consent') {
    if (msg.buttonId === 'alert_yes' || YES_RE.test(text)) {
      await query(`update subscriptions set state='choosing', step=0, updated_at=now() where id=$1`, [sub.id]);
      await askStep(msg.phone, cfg, 0, opts, 'Parfait ! ');
      return 'alerts_consented';
    }
    if (msg.buttonId === 'alert_no' || NO_RE.test(text)) {
      await query(`update subscriptions set state='declined', phone=null, updated_at=now() where id=$1`, [sub.id]);
      await reply(msg.phone, 'Pas de souci, aucune donnée ne sera conservée. Bonne journée !', opts);
      return 'alerts_declined';
    }
    await reply(msg.phone, 'Pour continuer, répondez simplement OUI (ou STOP pour arrêter).', opts);
    return 'alerts_consent_reminder';
  }

  // Question de départ en cours
  const index = sub.step || 0;
  const step = cfg.steps[index];
  const choices = { ...(typeof sub.choices === 'string' ? JSON.parse(sub.choices) : sub.choices || {}) };
  let value;
  if (step.type === 'days') value = parseDays(msg, step.max);
  else if (step.type === 'multi') value = parseMulti(msg, step);
  else value = parseSingle(msg, step);
  if (!value || (Array.isArray(value) && !value.length)) {
    await askStep(msg.phone, cfg, index, opts, 'Je n’ai pas compris. ');
    return 'alerts_step_retry';
  }
  choices[step.key] = value;

  if (index + 1 < cfg.steps.length) {
    await query(`update subscriptions set choices=$2, step=$3, updated_at=now() where id=$1`, [sub.id, JSON.stringify(choices), index + 1]);
    const ack = step.type === 'single' ? `*${choiceLabel(cfg, step.key, value)}*, noté. ` : 'Noté. ';
    await askStep(msg.phone, cfg, index + 1, opts, ack);
    return 'alerts_step_done';
  }

  // Dernière question : activation
  const daysStep = cfg.steps.find((s) => s.type === 'days');
  const days = daysStep ? choices[daysStep.key] : [addDays(parisNow().date, 1)];
  const domain = choices.domain || null; // compatibilité tableau de bord / anciennes données
  await query(`update subscriptions set choices=$2, days=$3, domain=$4, state='active', step=$5, updated_at=now() where id=$1`, [sub.id, JSON.stringify(choices), days, domain, index + 1]);
  const summary = cfg.steps
    .filter((s) => s.type !== 'days')
    .map((s) => [].concat(choices[s.key]).map((id) => choiceLabel(cfg, s.key, id)).join(', '))
    .filter(Boolean);
  const eod = cfg.eod_hour != null ? `, et je vous demanderai vers ${cfg.eod_hour}h comment cela s'est passé` : '';
  await reply(
    msg.phone,
    `C'est noté : ${summary.length ? `*${summary.join(' · ')}*, ` : ''}${days.map(dateLabel).join(', ')}.\n\n` +
      `Vous recevrez les infos vers ${cfg.morning_hour}h${eod}. ` +
      `D'ici là, posez-moi vos questions ici. Et n'hésitez pas à nous faire un retour à tout moment, sur ce qui va comme sur ce qui ne va pas : tout est lu par l'équipe. Pour modifier, utilisez à nouveau le lien ou le QR code.`,
    opts,
  );
  return 'alerts_active';
}

// ---------- Questions libres et retours spontanés ----------
async function infosFor(collectionId, days) {
  return query(`select day, body from daily_info where collection_id=$1 and day = any($2) order by created_at`, [collectionId, days]);
}

export async function answerQuestion(msg, hash, sub) {
  if (!(await recordInbound(msg, { role: 'respondent', companyId: sub.company_id }))) return 'ignored:duplicate';
  const cfg = getConfig(sub);
  const question = (msg.kind === 'audio' ? msg.transcript : msg.body)?.trim();
  if (!question) {
    await reply(msg.phone, 'Je ne peux lire que du texte ou des messages vocaux. Quelle est votre question ?', { companyId: sub.company_id });
    return 'question_unreadable';
  }
  const today = parisNow().date;
  const days = [...new Set([today, ...sub.days.filter((d) => d >= today)])].slice(0, 4);
  const choices = typeof sub.choices === 'string' ? JSON.parse(sub.choices) : sub.choices || {};
  if (!choices.domain && sub.domain) choices.domain = sub.domain;
  const context = contextBody(cfg, choices, days, await infosFor(sub.collection_id, days));
  let res;
  try {
    res = await answerAlertQuestion({ question, context, company: sub.company_name, service: sub.title, topics: cfg.topics, fallback: cfg.fallback });
  } catch (err) {
    console.error('[ia] réponse question :', err.message);
    res = { kind: 'question', answer: `Je ne peux pas répondre pour le moment. Le plus simple est de ${cfg.fallback}.`, topic: 'autre', answerable: false };
  }
  const demo = cfg.source.endsWith('_demo') ? `\n${DEMO_NOTICE}` : '';
  await reply(msg.phone, res.kind === 'feedback' ? res.answer : `${res.answer}${demo}`, { companyId: sub.company_id });
  // Un retour spontané est enregistré et analysé comme un retour client (émotion, irritants, urgence).
  if (res.kind !== 'question') await saveSpontaneousFeedback(sub, hash, question, msg.kind === 'audio' ? question : null);
  if (res.kind === 'feedback') return 'feedback_received';
  await query(
    `insert into questions (collection_id, subscription_id, phone_hash, domain, question, topic, answerable, answer, simulated) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [sub.collection_id, sub.id, hash, sub.domain, question, res.topic, res.answerable, res.answer, !appConfig.anthropicApiKey],
  );
  return 'question_answered';
}

async function saveSpontaneousFeedback(sub, hash, text, transcript) {
  try {
    const analysis = await analyzeFeedback({ title: `${sub.title} (retour spontané)`, exchange: [{ role: 'client', text }] });
    const s = await one(`insert into sessions (collection_id, phone_hash, state, completed_at) values ($1,$2,'done',now()) returning id`, [sub.collection_id, hash]);
    await query(
      `insert into feedbacks (session_id, collection_id, verbatim, transcript, analysis, emotion, sentiment, urgency, simulated) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [s.id, sub.collection_id, text, transcript, JSON.stringify(analysis), analysis.emotion, analysis.tone, analysis.urgency, !appConfig.anthropicApiKey],
    );
  } catch (err) {
    console.error('[ia] retour spontané :', err.message);
  }
}

// ---------- Envois programmés ----------
// WhatsApp n'autorise un message libre que dans les 24 h qui suivent le dernier message de la personne.
// Au-delà : message modèle approuvé (si configuré), sinon l'envoi est sauté et compté.
async function windowOpen(hash) {
  return Boolean(await one(`select 1 from messages where phone_hash=$1 and direction='in' and created_at > now() - interval '23 hours 45 minutes' limit 1`, [hash]));
}

async function scheduledSend(sub, body, { template, params, sessionId = null }) {
  if (await windowOpen(sub.phone_hash)) {
    await reply(sub.phone, body, { companyId: sub.company_id, sessionId });
    return 'sent';
  }
  if (template) {
    await query(`insert into messages (session_id, company_id, direction, role, phone_hash, kind, body) values ($1,$2,'out','lemo',$3,'template',$4)`, [sessionId, sub.company_id, sub.phone_hash, body]);
    await sendTemplate(sub.phone, template, params).catch((e) => console.error('[kapso] template :', e.message));
    return 'template';
  }
  await query(`update subscriptions set skipped_window = skipped_window + 1 where id=$1`, [sub.id]);
  return 'skipped';
}

export async function sendMorning(sub, date) {
  const cfg = getConfig(sub);
  const choices = typeof sub.choices === 'string' ? JSON.parse(sub.choices) : sub.choices || {};
  if (!choices.domain && sub.domain) choices.domain = sub.domain;
  const body = morningBody(cfg, choices, date, await infosFor(sub.collection_id, [date]));
  if (!body) return 'no_info';
  return scheduledSend(sub, body, { template: process.env.ALERT_MORNING_TEMPLATE, params: [sub.title, dateLabel(date)] });
}

export async function sendEndOfDay(sub) {
  const cfg = getConfig(sub);
  const body = `Bonsoir ! ${cfg.eod_question || sub.question}`;
  if (!(await windowOpen(sub.phone_hash)) && !process.env.ALERT_EOD_TEMPLATE) {
    await query(`update subscriptions set skipped_window = skipped_window + 1 where id=$1`, [sub.id]);
    return 'skipped';
  }
  // la réponse sera traitée comme un retour client (relance éventuelle, analyse, émotions)
  await query(`update sessions set state='declined', phone=null where phone_hash=$1 and state in ('awaiting_consent','awaiting_answer','awaiting_followup')`, [sub.phone_hash]);
  const s = await one(`insert into sessions (collection_id, phone, phone_hash, state) values ($1,$2,$3,'awaiting_answer') returning id`, [sub.collection_id, sub.phone, sub.phone_hash]);
  return scheduledSend(sub, body, { template: process.env.ALERT_EOD_TEMPLATE, params: [sub.title], sessionId: s.id });
}

const SUB_COLUMNS = `s.*, c.company_id, c.config, c.title, c.question`;
const hourOf = (cfg, key, fallback) => (cfg[key] === undefined ? fallback : cfg[key]);

export async function runAlerts(now = parisNow()) {
  const results = { morning: 0, eod: 0, ended: 0 };
  // Chaque lien a ses propres horaires : on ne traite que les collectes dont c'est l'heure.
  const cols = await query(`select id, config from collections where kind='alerts' and status='open'`);
  const morningIds = [];
  const eodIds = [];
  for (const c of cols) {
    const cfg = getConfig(c);
    const m = hourOf(cfg, 'morning_hour', 8);
    const e = hourOf(cfg, 'eod_hour', null);
    if (now.hour >= m && now.hour < m + 4) morningIds.push(c.id);
    if (e != null && now.hour >= e && now.hour < e + 4) eodIds.push(c.id);
  }
  if (morningIds.length) {
    const subs = await query(
      `update subscriptions s set morning_sent = array_append(morning_sent, $1) from collections c
       where c.id = s.collection_id and s.collection_id = any($2) and s.state='active' and $1 = any(s.days) and not ($1 = any(s.morning_sent)) returning ${SUB_COLUMNS}`,
      [now.date, morningIds],
    );
    for (const sub of subs) if (['sent', 'template'].includes(await sendMorning(sub, now.date))) results.morning++;
  }
  if (eodIds.length) {
    const subs = await query(
      `update subscriptions s set eod_sent = array_append(eod_sent, $1) from collections c
       where c.id = s.collection_id and s.collection_id = any($2) and s.state='active' and $1 = any(s.days) and not ($1 = any(s.eod_sent)) returning ${SUB_COLUMNS}`,
      [now.date, eodIds],
    );
    for (const sub of subs) if (['sent', 'template'].includes(await sendEndOfDay(sub))) results.eod++;
  }
  // fin d'abonnement : le lendemain du dernier jour choisi, on efface le numéro
  const ended = await query(
    `update subscriptions set state='ended', phone=null, updated_at=now()
     where (state='active' and not exists (select 1 from unnest(days) d where d >= $1))
        or (state = any($2) and updated_at < now() - interval '24 hours')
     returning id`,
    [now.date, SETUP_STATES],
  );
  results.ended = ended.length;
  return results;
}

// Déclenchement manuel depuis le tableau de bord (démo) : envoie tout de suite aux abonnés actifs.
export async function sendNow(collectionId, type) {
  const today = parisNow().date;
  const subs = await query(`select ${SUB_COLUMNS} from subscriptions s join collections c on c.id=s.collection_id where s.collection_id=$1 and s.state='active'`, [collectionId]);
  const out = { sent: 0, skipped: 0, noInfo: 0 };
  for (const sub of subs) {
    const day = sub.days.find((d) => d >= today) || sub.days[sub.days.length - 1];
    const r = type === 'eod' ? await sendEndOfDay(sub) : await sendMorning(sub, day);
    if (r === 'skipped') out.skipped++;
    else if (r === 'no_info') out.noInfo++;
    else out.sent++;
  }
  return out;
}

export async function addDailyInfo(collectionId, day, body, source = 'admin') {
  return one(`insert into daily_info (collection_id, day, body, source) values ($1,$2,$3,$4) returning *`, [collectionId, day, body, source]);
}

// Statistiques pour le tableau de bord.
export async function alertStats(col) {
  const cfg = getConfig(col);
  const subs = await query(`select choices, domain, days, state, skipped_window from subscriptions where collection_id=$1 and state in ('active','ended')`, [col.id]);
  const sortDesc = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]).map(([label, count]) => ({ label, count }));
  const byStep = cfg.steps
    .filter((s) => s.type !== 'days')
    .map((s) => {
      const m = new Map();
      for (const sub of subs) {
        const c = typeof sub.choices === 'string' ? JSON.parse(sub.choices) : sub.choices || {};
        const v = c[s.key] ?? (s.key === 'domain' ? sub.domain : null);
        for (const id of [].concat(v ?? [])) m.set(choiceLabel(cfg, s.key, id), (m.get(choiceLabel(cfg, s.key, id)) || 0) + 1);
      }
      return { title: s.question, items: sortDesc(m) };
    });
  const byDay = new Map();
  for (const s of subs) for (const d of s.days) byDay.set(d, (byDay.get(d) || 0) + 1);
  const questions = await query(`select question, topic, answerable, created_at from questions where collection_id=$1 order by created_at desc`, [col.id]);
  const topics = new Map();
  for (const q of questions) topics.set(q.topic, (topics.get(q.topic) || 0) + 1);
  const infos = await query(`select day, body, source, created_at from daily_info where collection_id=$1 order by day desc, created_at desc limit 30`, [col.id]);
  return {
    cfg,
    subscribers: subs.length,
    active: subs.filter((s) => s.state === 'active').length,
    skipped: subs.reduce((n, s) => n + s.skipped_window, 0),
    byStep,
    byDay: [...byDay.entries()].sort().map(([d, count]) => ({ label: shortLabel(d), count })),
    topics: sortDesc(topics),
    questions,
    unanswered: questions.filter((q) => q.answerable === false),
    infos,
    tomorrow: addDays(parisNow().date, 1),
  };
}
