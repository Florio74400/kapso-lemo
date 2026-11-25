// Logique de conversation : routage des messages entrants (client / dirigeant), consentement,
// question ouverte, relance, analyse, désabonnement, bilan WhatsApp.
import crypto from 'node:crypto';
import { config, llmMode } from './config.js';
import { query, one } from './db.js';
import { sendText, sendButtons, sendList, sendCtaUrl, showTyping, sendReaction } from './kapso.js';
import * as alerts from './alerts.js';
import * as onboarding from './onboarding.js';
import { classifyOwnerMessage, decideFollowup, analyzeFeedback } from './llm.js';
import { buildReport } from './report.js';
import { answerForManager } from './insights.js';

export const CODE_RE = /LEMO-[A-HJ-NP-Z2-9]{4}/i;
const STOP_RE = /^\s*(stop|arret|arrêt|desabonner|désabonner|desinscription|désinscription|unsubscribe)\s*[.!]?\s*$/i;
const YES_RE = /^\s*(oui|ok|okay|d'accord|daccord|j'accepte|jaccepte|go|yes|ouais|bien s[uû]r|avec plaisir)\b/i;
const QUESTION_PREFIX = 'Merci ! ';
const THANKS = 'Merci beaucoup pour votre retour, il sera transmis à l’équipe. Bonne journée !';
const NO_RE = /^\s*(non|no|pas maintenant|non merci)\b/i;

export function phoneHash(phone) {
  return crypto.createHmac('sha256', config.appSecret).update(String(phone)).digest('hex');
}

export function waLink(code, kind = 'feedback') {
  const text = encodeURIComponent(kind === 'alerts' ? `Bonjour, je veux recevoir les infos (${code})` : `Bonjour, je souhaite donner mon avis (${code})`);
  return `https://wa.me/${config.whatsappDisplayNumber || 'NUMERO'}?text=${text}`;
}

// --- File d'attente par numéro : les messages d'une même personne sont traités dans l'ordre,
// ceux de personnes différentes en parallèle. (Une seule instance du serveur pour le MVP.)
const queues = new Map();
export function enqueue(key, fn) {
  const prev = queues.get(key) || Promise.resolve();
  const next = prev.then(fn, fn).finally(() => {
    if (queues.get(key) === next) queues.delete(key);
  });
  queues.set(key, next);
  return next;
}
export async function drainQueues() {
  await Promise.allSettled([...queues.values()]);
}

// --- Envoi + journalisation
export async function reply(phone, body, { sessionId = null, companyId = null, buttons = null, list = null, cta = null } = {}) {
  await query(
    `insert into messages (session_id, company_id, direction, role, phone_hash, kind, body) values ($1,$2,'out','lemo',$3,$4,$5)`,
    [sessionId, companyId, phoneHash(phone), buttons || list || cta ? 'interactive' : 'text', cta ? `${body}\n[${cta.text}] ${cta.url}` : body],
  );
  try {
    if (cta) await sendCtaUrl(phone, body, cta.text, cta.url, cta.footer);
    else if (buttons) await sendButtons(phone, body, buttons);
    else if (list) await sendList(phone, body, list.button, list.rows);
    else await sendText(phone, body);
  } catch (err) {
    console.error('[kapso] envoi échoué :', err.message);
  }
}

export async function recordInbound(msg, { sessionId = null, companyId = null, role }) {
  const rows = await query(
    `insert into messages (session_id, company_id, direction, role, wa_message_id, phone_hash, kind, body, transcript)
     values ($1,$2,'in',$3,$4,$5,$6,$7,$8) on conflict (wa_message_id) do nothing returning id`,
    [sessionId, companyId, role, msg.waMessageId, phoneHash(msg.phone), msg.kind, msg.body, msg.transcript],
  );
  return rows.length > 0; // false = doublon déjà traité
}

// ================== Point d'entrée ==================
export async function handleInbound(msg) {
  if (msg.direction !== 'inbound') return 'ignored:outbound'; // nos propres messages ne sont jamais traités comme des réponses
  if (!msg.phone) return 'ignored:no_phone';
  if (config.kapsoPhoneNumberId && msg.phoneNumberId && msg.phoneNumberId !== config.kapsoPhoneNumberId && !config.demoMode) return 'ignored:other_number';
  if (config.allowedNumbers.length && !config.allowedNumbers.includes(msg.phone)) {
    console.warn('[garde-fou] numéro hors liste de test ignoré');
    return 'ignored:not_allowed';
  }
  // anti-doublon au niveau message (en plus de la clé d'idempotence du webhook)
  if (msg.waMessageId) {
    const seen = await one('select 1 from messages where wa_message_id = $1', [msg.waMessageId]);
    if (seen) return 'ignored:duplicate';
  }
  acknowledge(msg); // réaction + « en train d'écrire », sans attendre
  return enqueue(phoneHash(msg.phone), () => route(msg));
}

// Choix de la réaction selon le contenu (mots-clés, instantané, sans IA).
// Un message négatif reçoit une réaction d'écoute, jamais un sourire.
const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
export function reactionFor(text) {
  const t = norm(text);
  if (!t.trim()) return '👍';
  if (/probleme|panne|attente|queue|bloque|colere|inadmissible|decu|deception|nul|scandale|dangereux|peur|malaise|ferme|arrete|pas content|dommage|gache|bouscul|accident|blesse/.test(t)) return '🙏';
  if (/^(hey|salut|bonjour|bonsoir|hello|coucou|hi)\b/.test(t.trim())) return '👋';
  if (/neige|poudreuse|flocon|enneige/.test(t)) return '❄️';
  if (/soleil|grand beau|ciel bleu|ensoleille/.test(t)) return '☀️';
  if (/vent|tempete|rafale/.test(t)) return '🌬️';
  if (/\bski|piste|glisse|schuss/.test(t)) return '⛷️';
  if (/merci|bravo|genial|super|top|parfait|magnifique|incroyable|adore|excellent|trop bien|content/.test(t)) return '😊';
  return '👍';
}

function acknowledge(msg) {
  if (!msg.waMessageId) return;
  const text = msg.kind === 'audio' ? msg.transcript : msg.body;
  if (msg.kind === 'text' && STOP_RE.test((text || '').trim())) return; // pas de réaction à un désabonnement
  showTyping(msg.waMessageId).catch((e) => console.error('[kapso] indicateur de saisie :', e.message));
  sendReaction(msg.phone, msg.waMessageId, reactionFor(text)).catch((e) => console.error('[kapso] réaction :', e.message));
}

async function route(msg) {
  const hash = phoneHash(msg.phone);
  const text = (msg.body || '').trim();

  // 0. Outil d'acquisition : accueil des early adopters (« Hey LEMO, c'est Florio ! »), puis leur première expérience
  if (onboarding.HEY_RE.test(text)) return onboarding.welcome(msg);
  const newMember = await onboarding.inProgress(msg.phone);
  if (newMember && !STOP_RE.test(text)) {
    if (newMember.state === 'awaiting_blindspot') return onboarding.receiveBlindspot(msg, newMember);
    return onboarding.receiveExperience(msg, newMember);
  }

  // 1. Désabonnement
  if (msg.kind === 'text' && STOP_RE.test(text)) return optOut(msg, hash);

  // 2. Un code de collecte = démarrage explicite d'un retour (vaut nouvelle inscription)
  const code = text.match(CODE_RE)?.[0]?.toUpperCase();
  if (code) {
    const col = await one(
      `select c.*, co.name as company_name, co.retention_days from collections c join companies co on co.id = c.company_id where c.code = $1`,
      [code],
    );
    if (col?.kind === 'alerts') return alerts.startSubscription(msg, hash, col);
    if (col) return startSession(msg, hash, col);
  }

  // 3. Conversation client en cours
  const session = await one(
    `select s.*, c.question, c.title, c.company_id from sessions s join collections c on c.id = s.collection_id
     where s.phone_hash = $1 and s.state in ('awaiting_consent','awaiting_answer','awaiting_followup')
       and s.updated_at > now() - interval '24 hours'
     order by s.updated_at desc limit 1`,
    [hash],
  );
  if (session) return continueSession(msg, hash, session);

  // 4. Abonné aux alertes remontées : choix en cours, ou question libre
  const sub = await alerts.currentSubscription(hash);
  if (sub && sub.state !== 'active') return alerts.continueSetup(msg, hash, sub);

  // 5. Dirigeant (s'il est aussi abonné, seules ses demandes de dirigeant lui sont réservées)
  // Dirigeant (owner_phones) ou lecteur (reader_phones : direction, marketing... lecture seule)
  const company = await one(
    `select *, ($1 = any(owner_phones)) as is_owner from companies where $1 = any(owner_phones) or $1 = any(reader_phones) limit 1`,
    [msg.phone],
  );
  if (company) {
    if (!sub) return ownerMessage(msg, company);
    const intent = await classifyOwnerMessage((msg.kind === 'audio' ? msg.transcript : msg.body) || '').catch(() => null);
    if (intent && ['create_collection', 'report', 'list', 'ask_data'].includes(intent.intent)) return ownerMessage(msg, company, intent);
  }
  if (sub) return alerts.answerQuestion(msg, hash, sub);

  // 5. Personne désinscrite : silence total
  if (await one('select 1 from opt_outs where phone_hash = $1', [hash])) {
    await recordInbound(msg, { role: 'unknown' });
    return 'ignored:opted_out';
  }

  // 6. Inconnu
  if (!(await recordInbound(msg, { role: 'unknown' }))) return 'ignored:duplicate';
  const recent = await one(`select 1 from sessions where phone_hash = $1 and state = 'done' and completed_at > now() - interval '24 hours'`, [hash]);
  await reply(
    msg.phone,
    recent
      ? 'Merci, votre retour a bien été enregistré. Bonne journée !'
      : "Bonjour ! Ce numéro sert à recueillir des avis clients. Pour donner votre avis, utilisez le lien ou le QR code fourni par l'établissement.",
  );
  return 'unknown';
}

// ================== Parcours client ==================
async function startSession(msg, hash, col) {
  if (col.status !== 'open') {
    if (!(await recordInbound(msg, { role: 'respondent', companyId: col.company_id }))) return 'ignored:duplicate';
    await reply(msg.phone, `Merci ! La collecte d'avis de ${col.company_name} est terminée. Bonne journée.`, { companyId: col.company_id });
    return 'collection_closed';
  }
  // l'envoi volontaire d'un code annule un ancien désabonnement
  await query('delete from opt_outs where phone_hash = $1', [hash]);
  // on clôt une éventuelle conversation précédente inachevée
  await query(`update sessions set state='declined', phone=null, updated_at=now() where phone_hash=$1 and state in ('awaiting_consent','awaiting_answer','awaiting_followup')`, [hash]);
  const s = await one(
    `insert into sessions (collection_id, phone, phone_hash, state) values ($1,$2,$3,'awaiting_consent') returning id`,
    [col.id, msg.phone, hash],
  );
  if (!(await recordInbound(msg, { sessionId: s.id, companyId: col.company_id, role: 'respondent' }))) return 'ignored:duplicate';
  await reply(
    msg.phone,
    `Bonjour ! Je suis l'assistant de *${col.company_name}*. Nous aimerions connaître votre ressenti sur ${col.title}. Cela prend moins d'une minute, par écrit ou en vocal.\n\n` +
      `Vos réponses sont analysées par une IA et transmises à ${col.company_name} sans votre numéro, qui est effacé à la fin de l'échange. Elles sont conservées ${col.retention_days} jours maximum. Écrivez STOP à tout moment pour arrêter.\n\nAcceptez-vous ?`,
    { sessionId: s.id, companyId: col.company_id, buttons: [{ id: 'consent_yes', title: "Oui, j'accepte" }, { id: 'consent_no', title: 'Non merci' }] },
  );
  return 'session_started';
}

async function continueSession(msg, hash, s) {
  if (!(await recordInbound(msg, { sessionId: s.id, companyId: s.company_id, role: 'respondent' }))) return 'ignored:duplicate';
  await query('update sessions set last_inbound_at = now(), updated_at = now() where id = $1', [s.id]);
  const text = (msg.body || '').trim();

  if (s.state === 'awaiting_consent') {
    if (msg.buttonId === 'consent_yes' || YES_RE.test(text)) {
      await query(`update sessions set state='awaiting_answer', updated_at=now() where id=$1`, [s.id]);
      await reply(msg.phone, `${QUESTION_PREFIX}${s.question}`, { sessionId: s.id, companyId: s.company_id });
      return 'consented';
    }
    if (msg.buttonId === 'consent_no' || NO_RE.test(text)) {
      await query(`update sessions set state='declined', phone=null, updated_at=now(), completed_at=now() where id=$1`, [s.id]);
      await query(`delete from messages where session_id=$1 and direction='in'`, [s.id]);
      await reply(msg.phone, 'Pas de souci, aucune donnée ne sera conservée. Bonne journée !', { companyId: s.company_id });
      return 'declined';
    }
    await reply(msg.phone, 'Pour continuer, répondez simplement OUI (ou STOP pour arrêter).', { sessionId: s.id, companyId: s.company_id });
    return 'consent_reminder';
  }

  // Réponse texte ou vocale
  const answer = msg.kind === 'audio' ? msg.transcript : text;
  if (!answer) {
    await reply(
      msg.phone,
      msg.kind === 'audio' ? "Je n'ai pas réussi à écouter votre vocal. Pouvez-vous l'écrire en quelques mots ?" : 'Je ne peux lire que du texte ou des messages vocaux. Pouvez-vous répondre en quelques mots ?',
      { sessionId: s.id, companyId: s.company_id },
    );
    return 'unreadable';
  }

  if (s.state === 'awaiting_answer') {
    let f = { ask_followup: false, question: null };
    try {
      f = await decideFollowup({ question: s.question, answer });
    } catch (err) {
      console.error('[ia] relance :', err.message);
    }
    if (f.ask_followup && f.question) {
      await query(`update sessions set state='awaiting_followup', followup_question=$2, updated_at=now() where id=$1`, [s.id, f.question]);
      await reply(msg.phone, f.question, { sessionId: s.id, companyId: s.company_id });
      return 'followup_asked';
    }
  }
  return finalize(s.id, msg.phone);
}

// Clôture : remerciement immédiat, puis analyse. Idempotent (une seule analyse par session).
export async function finalize(sessionId, phone = null) {
  const claimed = await one(
    `update sessions set state='analyzing', updated_at=now() where id=$1 and state in ('awaiting_answer','awaiting_followup','analyzing') returning id`,
    [sessionId],
  );
  if (!claimed) return 'already_final';
  const s = await one(`select s.*, c.title, c.company_id from sessions s join collections c on c.id=s.collection_id where s.id=$1`, [sessionId]);
  if (phone) await reply(phone, THANKS, { sessionId, companyId: s.company_id });
  return analyzeSession(s);
}

export async function analyzeSession(s) {
  const msgs = await query(`select role, body, transcript from messages where session_id=$1 order by seq`, [s.id]);
  // L'échange utile commence à la question ouverte (après le consentement) et exclut le remerciement final.
  const qIdx = msgs.findIndex((m) => m.role === 'lemo' && m.body?.startsWith(QUESTION_PREFIX));
  const exchange = msgs
    .slice(qIdx >= 0 ? qIdx : 0)
    .filter((m) => !(m.role === 'lemo' && m.body === THANKS))
    .map((m) => ({ role: m.role === 'respondent' ? 'client' : 'lemo', text: m.role === 'respondent' ? m.transcript || m.body : m.body?.replace(QUESTION_PREFIX, '') }))
    .filter((e) => e.text);
  const verbatim = exchange.filter((e) => e.role === 'client').map((e) => e.text).join('\n');
  const transcript = msgs.filter((m) => m.role === 'respondent' && m.transcript).map((m) => m.transcript).join('\n') || null;
  if (!verbatim) {
    await query(`update sessions set state='done', phone=null, completed_at=now(), updated_at=now() where id=$1`, [s.id]);
    return 'empty';
  }

  let analysis;
  try {
    analysis = await analyzeFeedback({ title: s.title, exchange });
  } catch (err) {
    console.error('[ia] analyse échouée, nouvel essai plus tard :', err.message);
    return 'analysis_failed';
  }
  await query(
    `insert into feedbacks (session_id, collection_id, verbatim, transcript, analysis, emotion, sentiment, urgency, simulated)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict (session_id) do nothing`,
    [s.id, s.collection_id, verbatim, transcript, JSON.stringify(analysis), analysis.emotion, analysis.tone, analysis.urgency, llmMode() === 'simulated'],
  );
  // minimisation : le numéro en clair est effacé dès que l'échange est terminé
  await query(`update sessions set state='done', phone=null, completed_at=now(), updated_at=now() where id=$1`, [s.id]);
  return 'done';
}

async function optOut(msg, hash) {
  await query('insert into opt_outs (phone_hash) values ($1) on conflict do nothing', [hash]);
  if (await onboarding.optOutMember(hash)) {
    await reply(msg.phone, "C'est noté : tu ne recevras plus de messages de LEMO, et tes réponses ont été supprimées. Écris « Hey LEMO » si tu changes d'avis.");
    return 'opted_out';
  }
  const active = await query(
    `update sessions set state='opted_out', phone=null, updated_at=now(), completed_at=now()
     where phone_hash=$1 and state in ('awaiting_consent','awaiting_answer','awaiting_followup') returning id`,
    [hash],
  );
  for (const a of active) await query('delete from messages where session_id=$1', [a.id]);
  await query(`update subscriptions set state='opted_out', phone=null, updated_at=now() where phone_hash=$1 and state not in ('ended','declined','opted_out')`, [hash]);
  await recordInbound(msg, { role: 'unknown' });
  await reply(msg.phone, "C'est noté : vous ne recevrez plus de messages de notre part et vos réponses en cours ont été supprimées.");
  return 'opted_out';
}

// ================== Parcours dirigeant ==================
export function newCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c = 'LEMO-';
  for (let i = 0; i < 4; i++) c += alphabet[crypto.randomInt(alphabet.length)];
  return c;
}

export async function createCollection(companyId, title, question, kind = 'feedback', config = null) {
  for (let i = 0; i < 5; i++) {
    const code = newCode();
    const row = await one(
      `insert into collections (company_id, code, title, question, kind, config) values ($1,$2,$3,$4,$5,$6) on conflict (code) do nothing returning *`,
      [companyId, code, title, question, kind, config ? JSON.stringify(config) : null],
    );
    if (row) return row;
  }
  throw new Error('Impossible de générer un code unique');
}

async function ownerMessage(msg, company, knownIntent = null) {
  if (!(await recordInbound(msg, { companyId: company.id, role: 'owner' }))) return 'ignored:duplicate';
  const text = msg.kind === 'audio' ? msg.transcript : msg.body;
  if (!text) {
    await reply(msg.phone, "Je n'ai pas compris ce message. Écrivez par exemple : « Je veux savoir ce que mes clients ont pensé de leur séjour ».", { companyId: company.id });
    return 'owner_unreadable';
  }
  let intent = knownIntent;
  try {
    intent ??= await classifyOwnerMessage(text);
  } catch (err) {
    console.error('[ia] intention :', err.message);
    await reply(msg.phone, 'Petit souci technique, réessayez dans un instant.', { companyId: company.id });
    return 'owner_error';
  }

  // Question libre sur les données ("Y a-t-il eu des problèmes aujourd'hui à la Flégère ?")
  if (intent.intent === 'ask_data' || (intent.intent === 'other' && /\?/.test(text))) {
    let answer;
    try {
      answer = await answerForManager({ company, question: text, period: intent.period });
    } catch (err) {
      console.error('[ia] question direction :', err.message);
      answer = 'Je ne peux pas analyser les données pour le moment. Réessayez dans un instant.';
    }
    await reply(msg.phone, answer, { companyId: company.id });
    return 'data_answered';
  }

  if (intent.intent === 'create_collection' && !company.is_owner) {
    await reply(msg.phone, 'La création de collectes est réservée au dirigeant. Vous pouvez en revanche me poser toutes vos questions sur les retours clients.', { companyId: company.id });
    return 'reader_forbidden';
  }

  if (intent.intent === 'create_collection' && intent.collection_title && intent.collection_question) {
    const col = await createCollection(company.id, intent.collection_title, intent.collection_question);
    await reply(
      msg.phone,
      `Collecte créée : *${col.title}* (${col.code})\n\nQuestion posée à vos clients :\n« ${col.question} »\n\nLien à partager (WhatsApp, e-mail, QR code) :\n${waLink(col.code)}\n\nQR code et résultats : ${config.publicUrl}/collections/${col.id}\n\nDemandez-moi « le bilan » quand vous voulez.`,
      { companyId: company.id },
    );
    return 'collection_created';
  }

  if (intent.intent === 'report') {
    const col = intent.collection_code
      ? await one('select * from collections where company_id=$1 and code=$2', [company.id, intent.collection_code.toUpperCase()])
      : await one('select * from collections where company_id=$1 order by created_at desc limit 1', [company.id]);
    if (!col) {
      await reply(msg.phone, "Vous n'avez pas encore de collecte. Dites-moi ce que vous voulez savoir de vos clients.", { companyId: company.id });
      return 'report_none';
    }
    const report = await buildReport(col, company);
    await reply(msg.phone, report.whatsappText, { companyId: company.id });
    return 'report_sent';
  }

  if (intent.intent === 'list') {
    const cols = await query(
      `select c.code, c.title, c.status, (select count(*)::int from feedbacks f where f.collection_id=c.id) as n
       from collections c where company_id=$1 order by created_at desc limit 10`,
      [company.id],
    );
    await reply(
      msg.phone,
      cols.length ? 'Vos collectes :\n' + cols.map((c) => `- ${c.code} · ${c.title} · ${c.n} retour(s)${c.status === 'closed' ? ' · close' : ''}`).join('\n') : "Aucune collecte pour l'instant.",
      { companyId: company.id },
    );
    return 'list_sent';
  }

  await reply(
    msg.phone,
    (company.is_owner ? "Je peux :\n- créer une collecte : « Je veux savoir ce que mes clients ont pensé de leur séjour »\n" : 'Je peux :\n') +
      "- répondre à vos questions sur les retours : « Y a-t-il eu des problèmes aujourd'hui à la Flégère ? »\n- faire le bilan : « Fais-moi le bilan de ma collecte »\n- lister vos collectes : « Mes collectes »",
    { companyId: company.id },
  );
  return 'owner_help';
}
