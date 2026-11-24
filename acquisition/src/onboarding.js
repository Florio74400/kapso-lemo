// Outil d'acquisition : accueil des early adopters arrivés par le lien d'invitation.
// « Hey LEMO, c'est Florio ! » -> présentation en quelques messages courts -> demande d'une première expérience.
import { query, one } from './db.js';
import { reply, recordInbound, phoneHash } from './conversation.js';

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
    `Hi${name ? ` ${name}` : ''}. Je suis LEMO, le moteur d'analyse émotionnelle en temps réel : avant, pendant et après chaque expérience.`,
    `LEMO est en accès sur invitation uniquement. Tu disposes de ${INVITES_PER_MEMBER} invitations, débloquées après ta première expérience.`,
    "Le plus simple pour comprendre, c'est d'essayer.",
    'Raconte-moi une expérience récente : un rendez-vous, un repas, un moment de ta journée. Par écrit ou en vocal.',
  ];
  for (const [i, line] of lines.entries()) {
    if (i) await pause(PAUSE_MS);
    await reply(msg.phone, line);
  }
  return 'onboarding_welcome';
}

// Membre en attente de sa première expérience ?
export async function awaitingExperience(phone) {
  return one(`select * from members where phone_hash=$1 and state='awaiting_experience'`, [phoneHash(phone)]);
}

export async function receiveExperience(msg, member) {
  if (!(await recordInbound(msg, { role: 'respondent' }))) return 'ignored:duplicate';
  const text = (msg.kind === 'audio' ? msg.transcript : msg.body)?.trim();
  if (!text) {
    await reply(msg.phone, "Je n'ai pas pu lire ce message. Raconte-moi ton expérience par écrit ou en vocal.");
    return 'onboarding_unreadable';
  }
  await query(`update members set experience=$2, state='experienced', updated_at=now() where id=$1`, [member.id, text]);
  // Étape 3 à venir : analyse émotionnelle de l'expérience et déblocage des invitations.
  await reply(msg.phone, 'Très bien continuons le dev maintenant !');
  return 'onboarding_experience';
}
