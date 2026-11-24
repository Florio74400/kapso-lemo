// Outil d'acquisition : accueil des early adopters arrivés par le lien d'invitation.
// « Hey LEMO, c'est Florio ! » -> présentation -> événement marquant -> relance angle mort -> restitution (texte + schéma).
import crypto from 'node:crypto';
import { config } from './config.js';
import { query, one } from './db.js';
import { reply, recordInbound, phoneHash } from './conversation.js';
import { sendImage } from './kapso.js';
import { blindSpotQuestion, experienceReport } from './llm.js';
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

export async function welcome(msg) {
  if (!(await recordInbound(msg, { role: 'unknown' }))) return 'ignored:duplicate';
  const name = firstNameFrom(msg.body, msg.profileName);
  const hash = phoneHash(msg.phone);
  await query(
    `insert into members (phone_hash, phone, first_name, invites_total) values ($1,$2,$3,$4)
     on conflict (phone_hash) do update set phone=excluded.phone, first_name=coalesce(excluded.first_name, members.first_name), state='awaiting_experience', updated_at=now()`,
    [hash, msg.phone, name, INVITES_PER_MEMBER],
  );
  const lines = [
    `Hello${name ? ` ${name}` : ''}. Je suis LEMO, le moteur d'analyse émotionnelle en temps réel : avant, pendant et après chaque expérience.`,
    `LEMO est en accès sur invitation uniquement. Tu disposes de ${INVITES_PER_MEMBER} invitations, débloquées après ta première expérience.`,
    "Le plus simple pour comprendre, c'est d'essayer.",
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
  return one(`select * from members where phone_hash=$1 and state in ('awaiting_experience','awaiting_blindspot')`, [phoneHash(phone)]);
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

// Étape 2 : la réponse à la relance -> restitution (schéma + ce que LEMO a capté + ce qu'une enquête J+4 aurait donné).
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
  await query(`update members set blindspot=$2, report=$3, card_token=$4, state='experienced', updated_at=now() where id=$1`, [member.id, answer, JSON.stringify(report), token]);

  const n = signalCount(report);
  const captured = [
    '*Ce que LEMO a capté, pendant l’expérience*',
    ...report.emotions.map((e) => `· ${e.emotion}, ${e.moment}`),
    report.key_moment ? `· Point de bascule : ${report.key_moment}` : null,
    `· Angle mort : ${report.blind_spot}`,
    report.quote ? `« ${report.quote} »` : null,
  ].filter(Boolean).join('\n');
  const survey = [
    '*Ce qu’une enquête de satisfaction à J+4 aurait obtenu*',
    `Un questionnaire, quatre jours plus tard, qui demande un effort. Réponse type : « ${report.survey_score}/10 · ${report.survey_comment} »`,
    `Ici : *${n} signaux contre 2*, soit *×${richness(report)}* plus riche. De quoi ajuster l’expérience sur le moment, ou informer directement les équipes.`,
  ].join('\n\n');

  await reply(msg.phone, 'Merci. Voici ce que LEMO en retient.');
  await pause(PAUSE_MS);
  await sendCard(msg.phone, `${config.publicUrl}/m/${token}.png`, 'Ton moment, analysé par LEMO.');
  await pause(PAUSE_MS);
  await reply(msg.phone, captured);
  await pause(PAUSE_MS);
  await reply(msg.phone, survey);
  await pause(PAUSE_MS);
  // Étape suivante à venir : déblocage des invitations.
  await reply(msg.phone, 'Très bien continuons le dev maintenant !');
  return 'onboarding_report';
}

async function sendCard(phone, link, caption) {
  await query(`insert into messages (direction, role, phone_hash, kind, body) values ('out','lemo',$1,'other',$2)`, [phoneHash(phone), `[image] ${link}`]);
  try {
    await sendImage(phone, link, caption);
  } catch (err) {
    console.error('[kapso] envoi image échoué :', err.message);
  }
}
