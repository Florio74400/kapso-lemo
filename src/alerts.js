// Parcours "alertes remontées" :
// QR code / NFC -> consentement -> choix du domaine -> choix des jours (3 jours max)
// -> info du matin (8h) -> questions libres à tout moment -> question de fin de journée (16h), analysée comme un retour client.
import { config } from './config.js';
import { query, one } from './db.js';
import { reply, recordInbound } from './conversation.js';
import { sendTemplate } from './kapso.js';
import { answerAlertQuestion } from './llm.js';
import { DOMAINS, DEMO_NOTICE, domainById, matchDomain, morningText, contextFor, dateLabel } from './cmb-data.js';

const YES_RE = /^\s*(oui|ok|okay|d'accord|daccord|j'accepte|jaccepte|go|yes|ouais|bien s[uû]r|avec plaisir)\b/i;
const NO_RE = /^\s*(non|no|pas maintenant|non merci)\b/i;
const MAX_DAYS = 3;
const MORNING_HOUR = Number(process.env.MORNING_HOUR || 8);
const EOD_HOUR = Number(process.env.EOD_HOUR || 16);

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
const shortLabel = (date) => {
  const l = dateLabel(date);
  return l.charAt(0).toUpperCase() + l.slice(1);
};

export function dayOptions(today = parisNow().date) {
  const days = [1, 2, 3].map((n) => addDays(today, n));
  return [
    ...days.map((d) => ({ id: `days:${d}`, title: shortLabel(d).slice(0, 24), days: [d] })),
    { id: `days:${days[0]},${days[1]}`, title: 'Les 2 prochains jours', days: [days[0], days[1]] },
    { id: `days:${days.join(',')}`, title: 'Les 3 prochains jours', days },
  ];
}

const WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
function parseDays(msg, today) {
  const allowed = dayOptions(today).at(-1).days; // les 3 prochains jours
  if (msg.buttonId?.startsWith('days:')) return msg.buttonId.slice(5).split(',').filter((d) => allowed.includes(d));
  const t = (msg.body || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (/(3|trois) (prochains )?jours|tous/.test(t)) return allowed;
  if (/demain/.test(t) && !/apres-demain|apres demain/.test(t)) return [allowed[0]];
  return allowed.filter((d) => {
    const dt = new Date(`${d}T12:00:00Z`);
    return t.includes(WEEKDAYS[dt.getUTCDay()]) || new RegExp(`\\b${dt.getUTCDate()}\\b`).test(t);
  });
}

// ---------- Abonnement ----------
export async function currentSubscription(hash) {
  return one(
    `select s.*, c.company_id, c.title, c.question, co.name as company_name
     from subscriptions s join collections c on c.id = s.collection_id join companies co on co.id = c.company_id
     where s.phone_hash = $1 and (
       (s.state in ('awaiting_consent','choosing_domain','choosing_days') and s.updated_at > now() - interval '24 hours')
       or s.state = 'active')
     order by s.updated_at desc limit 1`,
    [hash],
  );
}

function domainList() {
  return { button: 'Choisir', rows: DOMAINS.map((d) => ({ id: `dom:${d.id}`, title: d.name, description: `Horaires ${d.hours}` })) };
}
function daysList() {
  return { button: 'Choisir les jours', rows: dayOptions().map(({ id, title }) => ({ id, title })) };
}

export async function startSubscription(msg, hash, col) {
  if (col.status !== 'open') {
    if (!(await recordInbound(msg, { role: 'respondent', companyId: col.company_id }))) return 'ignored:duplicate';
    await reply(msg.phone, `Ce service d'alertes de ${col.company_name} n'est plus disponible. Bonne journée !`, { companyId: col.company_id });
    return 'alerts_closed';
  }
  await query('delete from opt_outs where phone_hash = $1', [hash]); // scanner le code vaut nouvelle inscription
  const existing = await one(`select id from subscriptions where phone_hash=$1 and collection_id=$2 and state='active'`, [hash, col.id]);
  await query(`update subscriptions set state='ended', phone=null, updated_at=now() where phone_hash=$1 and state in ('awaiting_consent','choosing_domain','choosing_days')`, [hash]);
  if (!(await recordInbound(msg, { role: 'respondent', companyId: col.company_id }))) return 'ignored:duplicate';

  if (existing) {
    // déjà abonné : on lui permet de modifier ses choix, le consentement est déjà acquis
    await query(`update subscriptions set state='choosing_domain', phone=$2, days='{}', updated_at=now() where id=$1`, [existing.id, msg.phone]);
    await reply(msg.phone, 'Vous êtes déjà inscrit. Modifions vos choix : quel domaine vous intéresse ?', { companyId: col.company_id, list: domainList() });
    return 'alerts_modify';
  }
  await query(`insert into subscriptions (collection_id, phone, phone_hash, state) values ($1,$2,$3,'awaiting_consent')`, [col.id, msg.phone, hash]);
  await reply(
    msg.phone,
    `Bonjour ! Je suis l'assistant de *${col.company_name}*.\n\n` +
      `Je peux vous envoyer chaque matin vers ${MORNING_HOUR}h l'état des remontées de votre domaine, pour les jours de votre choix (${MAX_DAYS} jours maximum), et répondre à vos questions. ` +
      `Vers ${EOD_HOUR}h, je vous demanderai comment s'est passée votre journée.\n\n` +
      `Vos messages sont analysés par une IA pour améliorer le service. Votre numéro est effacé après votre dernier jour. Écrivez STOP à tout moment pour arrêter.\n\nAcceptez-vous ?`,
    { companyId: col.company_id, buttons: [{ id: 'alert_yes', title: "Oui, j'accepte" }, { id: 'alert_no', title: 'Non merci' }] },
  );
  return 'alerts_started';
}

export async function continueSetup(msg, hash, sub) {
  if (!(await recordInbound(msg, { role: 'respondent', companyId: sub.company_id }))) return 'ignored:duplicate';
  const text = (msg.body || '').trim();
  const opts = { companyId: sub.company_id };

  if (sub.state === 'awaiting_consent') {
    if (msg.buttonId === 'alert_yes' || YES_RE.test(text)) {
      await query(`update subscriptions set state='choosing_domain', updated_at=now() where id=$1`, [sub.id]);
      await reply(msg.phone, 'Parfait ! Quel domaine vous intéresse ?', { ...opts, list: domainList() });
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

  if (sub.state === 'choosing_domain') {
    const domain = msg.buttonId?.startsWith('dom:') ? domainById(msg.buttonId.slice(4)) : matchDomain(text);
    if (!domain) {
      await reply(msg.phone, 'Je n’ai pas reconnu le domaine. Choisissez dans la liste :', { ...opts, list: domainList() });
      return 'alerts_domain_retry';
    }
    await query(`update subscriptions set domain=$2, state='choosing_days', updated_at=now() where id=$1`, [sub.id, domain.id]);
    await reply(msg.phone, `*${domain.name}*, noté. Pour quels jours voulez-vous les infos ? (${MAX_DAYS} jours maximum)`, { ...opts, list: daysList() });
    return 'alerts_domain_chosen';
  }

  if (sub.state === 'choosing_days') {
    const days = parseDays(msg, parisNow().date);
    if (!days.length) {
      await reply(msg.phone, 'Je n’ai pas compris les jours. Choisissez dans la liste :', { ...opts, list: daysList() });
      return 'alerts_days_retry';
    }
    await query(`update subscriptions set days=$2, state='active', updated_at=now() where id=$1`, [sub.id, days]);
    await reply(
      msg.phone,
      `C'est noté : *${domainById(sub.domain).name}*, ${days.map(dateLabel).join(', ')}.\n\n` +
        `Vous recevrez l'état des remontées vers ${MORNING_HOUR}h, et je vous demanderai vers ${EOD_HOUR}h comment s'est passée votre journée. ` +
        `D'ici là, posez-moi vos questions ici. Pour modifier, scannez à nouveau le QR code.`,
      opts,
    );
    return 'alerts_active';
  }
  return 'alerts_noop';
}

// ---------- Questions libres ----------
export async function answerQuestion(msg, hash, sub) {
  if (!(await recordInbound(msg, { role: 'respondent', companyId: sub.company_id }))) return 'ignored:duplicate';
  const question = (msg.kind === 'audio' ? msg.transcript : msg.body)?.trim();
  if (!question) {
    await reply(msg.phone, 'Je ne peux lire que du texte ou des messages vocaux. Quelle est votre question ?', { companyId: sub.company_id });
    return 'question_unreadable';
  }
  const today = parisNow().date;
  const days = [...new Set([today, ...sub.days.filter((d) => d >= today)])].slice(0, MAX_DAYS + 1);
  let res;
  try {
    res = await answerAlertQuestion({ question, context: contextFor(sub.domain, days), company: sub.company_name });
  } catch (err) {
    console.error('[ia] réponse question :', err.message);
    res = { answer: 'Je ne peux pas répondre pour le moment. Renseignez-vous aux caisses du domaine.', topic: 'autre', answerable: false };
  }
  await query(
    `insert into questions (collection_id, subscription_id, phone_hash, domain, question, topic, answerable, answer, simulated) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [sub.collection_id, sub.id, hash, sub.domain, question, res.topic, res.answerable, res.answer, !config.anthropicApiKey],
  );
  await reply(msg.phone, `${res.answer}\n${DEMO_NOTICE}`, { companyId: sub.company_id });
  return 'question_answered';
}

// ---------- Envois programmés ----------
// WhatsApp n'autorise un message libre que dans les 24 h qui suivent le dernier message du client.
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
  return scheduledSend(sub, morningText(sub.domain, date), {
    template: process.env.ALERT_MORNING_TEMPLATE,
    params: [domainById(sub.domain).name, dateLabel(date)],
  });
}

export async function sendEndOfDay(sub) {
  const domain = domainById(sub.domain).name;
  const body = `Bonsoir ! Comment s'est passée votre journée à ${domain} ? Racontez-nous en quelques mots, par écrit ou en vocal.`;
  if (!(await windowOpen(sub.phone_hash)) && !process.env.ALERT_EOD_TEMPLATE) {
    await query(`update subscriptions set skipped_window = skipped_window + 1 where id=$1`, [sub.id]);
    return 'skipped';
  }
  // la réponse sera traitée comme un retour client (relance éventuelle, analyse, émotions)
  await query(`update sessions set state='declined', phone=null where phone_hash=$1 and state in ('awaiting_consent','awaiting_answer','awaiting_followup')`, [sub.phone_hash]);
  const s = await one(`insert into sessions (collection_id, phone, phone_hash, state) values ($1,$2,$3,'awaiting_answer') returning id`, [sub.collection_id, sub.phone, sub.phone_hash]);
  return scheduledSend(sub, body, { template: process.env.ALERT_EOD_TEMPLATE, params: [domain], sessionId: s.id });
}

const SUB_COLUMNS = `s.*, c.company_id`;

export async function runAlerts(now = parisNow()) {
  const results = { morning: 0, eod: 0, ended: 0 };
  if (now.hour >= MORNING_HOUR && now.hour < 12) {
    const subs = await query(
      `update subscriptions s set morning_sent = array_append(morning_sent, $1) from collections c
       where c.id = s.collection_id and s.state='active' and $1 = any(s.days) and not ($1 = any(s.morning_sent)) returning ${SUB_COLUMNS}`,
      [now.date],
    );
    for (const sub of subs) if ((await sendMorning(sub, now.date)) !== 'skipped') results.morning++;
  }
  if (now.hour >= EOD_HOUR && now.hour < 21) {
    const subs = await query(
      `update subscriptions s set eod_sent = array_append(eod_sent, $1) from collections c
       where c.id = s.collection_id and s.state='active' and $1 = any(s.days) and not ($1 = any(s.eod_sent)) returning ${SUB_COLUMNS}`,
      [now.date],
    );
    for (const sub of subs) if ((await sendEndOfDay(sub)) !== 'skipped') results.eod++;
  }
  // fin d'abonnement : le lendemain du dernier jour choisi, on efface le numéro
  const ended = await query(
    `update subscriptions set state='ended', phone=null, updated_at=now()
     where (state='active' and not exists (select 1 from unnest(days) d where d >= $1))
        or (state in ('awaiting_consent','choosing_domain','choosing_days') and updated_at < now() - interval '24 hours')
     returning id`,
    [now.date],
  );
  results.ended = ended.length;
  return results;
}

// Déclenchement manuel depuis le tableau de bord (démo) : envoie tout de suite aux abonnés actifs.
export async function sendNow(collectionId, type) {
  const today = parisNow().date;
  const subs = await query(`select s.*, c.company_id from subscriptions s join collections c on c.id=s.collection_id where s.collection_id=$1 and s.state='active'`, [collectionId]);
  const out = { sent: 0, skipped: 0 };
  for (const sub of subs) {
    const day = sub.days.find((d) => d >= today) || sub.days[sub.days.length - 1];
    const r = type === 'eod' ? await sendEndOfDay(sub) : await sendMorning(sub, day);
    r === 'skipped' ? out.skipped++ : out.sent++;
  }
  return out;
}

// Statistiques pour le tableau de bord.
export async function alertStats(collectionId) {
  const subs = await query(`select domain, days, state, skipped_window from subscriptions where collection_id=$1 and state in ('active','ended')`, [collectionId]);
  const byDomain = new Map();
  const byDay = new Map();
  for (const s of subs) {
    if (s.domain) byDomain.set(s.domain, (byDomain.get(s.domain) || 0) + 1);
    for (const d of s.days) byDay.set(d, (byDay.get(d) || 0) + 1);
  }
  const questions = await query(`select question, topic, answerable, domain, created_at from questions where collection_id=$1 order by created_at desc`, [collectionId]);
  const topics = new Map();
  for (const q of questions) topics.set(q.topic, (topics.get(q.topic) || 0) + 1);
  const sortDesc = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]).map(([label, count]) => ({ label, count }));
  return {
    subscribers: subs.length,
    active: subs.filter((s) => s.state === 'active').length,
    skipped: subs.reduce((n, s) => n + s.skipped_window, 0),
    byDomain: sortDesc(byDomain).map((x) => ({ ...x, label: domainById(x.label)?.name || x.label })),
    byDay: [...byDay.entries()].sort().map(([d, count]) => ({ label: shortLabel(d), count })),
    topics: sortDesc(topics),
    questions,
    unanswered: questions.filter((q) => q.answerable === false),
  };
}
