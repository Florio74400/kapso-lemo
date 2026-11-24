// Outil d'acquisition : accueil des early adopters arrivés par le lien d'invitation.
// « Hey LEMO, c'est Florio ! » -> présentation -> événement marquant -> relance angle mort -> schéma + comparaison J+4
// -> « où brancherais-tu LEMO chez toi ? » -> projection personnalisée, invitations débloquées, alerte au fondateur.
import crypto from 'node:crypto';
import { config } from './config.js';
import { query, one } from './db.js';
import { reply, recordInbound, phoneHash } from './conversation.js';
import { sendImage } from './kapso.js';
import { blindSpotQuestion, experienceReport, leadFromProjection } from './llm.js';
import { signalCount, richness } from './card.js';

export const INVITES_PER_MEMBER = 3;
const PAUSE_MS = Number(process.env.ONBOARDING_PAUSE_MS ?? 900); // rythme entre les messages, comme une vraie conversation
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

export const HEY_RE = /^\s*hey\s+lemo\b/i;

// Prénom depuis le message prérempli (« Hey LEMO, c'est Florio ! »), sinon nom du profil WhatsApp.
export function firstNameFrom(text, profileName) {
  const m = (text || '').match(/c['’]?\s*est\s+([\p{L}][\p{L}'’\- ]{0,29})/iu);
  const raw = (m?.[1] || profileName || '').trim().split(/\s+/)[0] || '';
  const clean = raw.replace(/[^\p{L}'’-]/gu, '').slice(0, 30);
  return clean ? clean.charAt(0).toUpperCase() + clean.slice(1).toLowerCase() : null;
}

const INVITE_RE = /\(invitation\s+([A-Z0-9]{6})\)/i;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans 0/O ni 1/I
const newInviteCode = () => Array.from(crypto.randomBytes(6), (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');

export async function welcome(msg) {
  if (!(await recordInbound(msg, { role: 'unknown' }))) return 'ignored:duplicate';
  const name = firstNameFrom(msg.body, msg.profileName);
  const hash = phoneHash(msg.phone);
  // Arrivé par le lien personnel d'un membre ? (dans la limite de ses invitations)
  const code = msg.body?.match(INVITE_RE)?.[1]?.toUpperCase();
  const inviter = code
    ? await one(
        `select m.id from members m where m.invite_code=$1 and m.phone_hash<>$2
         and (select count(*) from members x where x.invited_by=m.id) < m.invites_total`,
        [code, hash],
      )
    : null;
  await query(
    `insert into members (phone_hash, phone, first_name, invites_total, invited_by) values ($1,$2,$3,$4,$5)
     on conflict (phone_hash) do update set phone=excluded.phone, first_name=coalesce(excluded.first_name, members.first_name),
       invited_by=coalesce(members.invited_by, excluded.invited_by), state='awaiting_experience', updated_at=now()`,
    [hash, msg.phone, name, INVITES_PER_MEMBER, inviter?.id || null],
  );
  const lines = [
    `Hello${name ? ` ${name}` : ''}. Je suis LEMO, le moteur d'analyse émotionnelle en temps réel : avant, pendant et après chaque expérience.`,
    `Accès sur invitation uniquement. Tes ${INVITES_PER_MEMBER} invitations se débloquent après ta première expérience.`,
    'Pour commencer : peux-tu me décrire un événement marquant de ta journée ? Par écrit ou en vocal.',
  ];
  for (const [i, line] of lines.entries()) {
    if (i) await pause(PAUSE_MS);
    await reply(msg.phone, line);
  }
  return 'onboarding_welcome';
}

// Membre au milieu du parcours (événement marquant ou relance) ?
export async function inProgress(phone) {
  return one(`select * from members where phone_hash=$1 and state in ('awaiting_experience','awaiting_blindspot','awaiting_projection')`, [phoneHash(phone)]);
}

const spoken = (msg) => (msg.kind === 'audio' ? msg.transcript : msg.body)?.trim();

// Étape 1 : l'événement marquant -> relance sur un angle mort.
export async function receiveExperience(msg, member) {
  if (!(await recordInbound(msg, { role: 'respondent' }))) return 'ignored:duplicate';
  const text = spoken(msg);
  if (!text) {
    await reply(msg.phone, "Je n'ai pas pu lire ce message. Raconte-moi ce moment par écrit ou en vocal.");
    return 'onboarding_unreadable';
  }
  const { question } = await blindSpotQuestion({ experience: text, firstName: member.first_name });
  await query(`update members set experience=$2, followup=$3, state='awaiting_blindspot', updated_at=now() where id=$1`, [member.id, text, question]);
  await reply(msg.phone, question);
  return 'onboarding_experience';
}

// La citation affichée doit exister mot pour mot dans ce que la personne a dit.
const norm = (s) => String(s || '').toLowerCase().replace(/[’']/g, "'").replace(/[«»"“”.,;:!?…]/g, ' ').replace(/\s+/g, ' ').trim();
export function verifiedQuote(quote, ...sources) {
  const q = norm(quote);
  return q.length >= 8 && sources.some((s) => norm(s).includes(q)) ? String(quote).trim().replace(/^[«"“\s]+|[»"”\s]+$/g, '') : null;
}

// Étape 2 : la réponse à la relance -> schéma « ton moment vu par LEMO » + comparaison avec une enquête à J+4 + question de projection.
export async function receiveBlindspot(msg, member) {
  if (!(await recordInbound(msg, { role: 'respondent' }))) return 'ignored:duplicate';
  const answer = spoken(msg);
  if (!answer) {
    await reply(msg.phone, "Je n'ai pas pu lire ce message. Tu peux me répondre par écrit ou en vocal.");
    return 'onboarding_unreadable';
  }
  const report = await experienceReport({ experience: member.experience, followup: member.followup, answer });
  report.quote = verifiedQuote(report.quote, member.experience, answer);
  const token = crypto.randomBytes(12).toString('base64url');
  await query(`update members set blindspot=$2, report=$3, card_token=$4, state='awaiting_projection', updated_at=now() where id=$1`, [member.id, answer, JSON.stringify(report), token]);
  const n = signalCount(report);

  await sendCard(msg.phone, `${config.publicUrl}/m/${token}.png`, 'Ton moment, vu par LEMO.');
  await pause(PAUSE_MS);
  await reply(
    msg.phone,
    [
      '*Avec une enquête de satisfaction à J+4*',
      `Un questionnaire quatre jours plus tard, qui demande un effort. Réponse type : « ${report.survey_score}/10 · ${report.survey_comment} »`,
      `*Avec LEMO* : ${n} signaux contre 2, soit ×${richness(report)} plus riche, captés sur le moment. De quoi ajuster l’expérience ou informer directement les équipes.`,
    ].join('\n\n'),
  );
  await pause(PAUSE_MS);
  await reply(msg.phone, PROJECTION_QUESTION);
  return 'onboarding_report';
}

export const PROJECTION_QUESTION =
  'Imagine la même chose chez tes clients ou tes collaborateurs, au moment où ils le vivent.\n\nChez toi, où brancherais-tu LEMO en premier ? Ton entreprise et le moment à capter, en une phrase ou en vocal.';

// Étape 3 : où brancher LEMO chez soi -> projection personnalisée, invitations débloquées, alerte au fondateur.
export async function receiveProjection(msg, member) {
  if (!(await recordInbound(msg, { role: 'respondent' }))) return 'ignored:duplicate';
  const answer = spoken(msg);
  if (!answer) {
    await reply(msg.phone, "Je n'ai pas pu lire ce message. Tu peux me répondre par écrit ou en vocal.");
    return 'onboarding_unreadable';
  }
  const lead = await leadFromProjection({ firstName: member.first_name, experience: member.experience, projection: answer });
  let code = member.invite_code;
  for (let i = 0; !code && i < 5; i++) {
    const candidate = newInviteCode();
    if (!(await one('select 1 from members where invite_code=$1', [candidate]))) code = candidate;
  }
  await query(`update members set projection=$2, lead=$3, invite_code=$4, state='experienced', updated_at=now() where id=$1`, [member.id, answer, JSON.stringify(lead), code]);

  await reply(msg.phone, lead.hook);
  await pause(PAUSE_MS);
  await reply(
    msg.phone,
    `Merci${member.first_name ? ` ${member.first_name}` : ''}. Florio, le fondateur de LEMO, va te recontacter personnellement.\n\nTes ${member.invites_total} invitations sont débloquées. Ton lien personnel, à transférer aux personnes de ton choix :\n${config.publicUrl}/i/${code}`,
  );
  await notifyFounder({ ...member, projection: answer, lead, invite_code: code });
  return 'onboarding_done';
}

// Alerte au fondateur : la fiche du lead et un lien WhatsApp avec son message prêt, envoyé depuis son propre compte.
export async function notifyFounder(m) {
  if (!config.founderPhone) return;
  const l = m.lead || {};
  const inviter = m.invited_by ? await one('select first_name from members where id=$1', [m.invited_by]) : null;
  const facts = [l.company, l.sector, l.role].filter(Boolean).join(' · ') || 'Entreprise non précisée';
  const body = [
    `*Nouvel early adopter* · ${l.priority || '?'}`,
    `${m.first_name || 'Sans prénom'} · +${m.phone}`,
    facts,
    `Cible : ${l.audience || 'inconnu'}${l.moment ? ` · Moment : ${l.moment}` : ''}`,
    `Sa réponse : « ${String(m.projection || '').slice(0, 220)} »`,
    `Invité par : ${inviter?.first_name || 'lien général'}`,
    '',
    'Lui écrire depuis ton WhatsApp, message prêt :',
    `https://wa.me/${m.phone}?text=${encodeURIComponent(l.founder_message || '')}`,
  ].join('\n');
  await reply(config.founderPhone, body);
}

async function sendCard(phone, link, caption) {
  await query(`insert into messages (direction, role, phone_hash, kind, body) values ('out','lemo',$1,'other',$2)`, [phoneHash(phone), `[image] ${link}`]);
  try {
    await sendImage(phone, link, caption);
  } catch (err) {
    console.error('[kapso] envoi image échoué :', err.message);
  }
}
