// Outil d'acquisition : accueil des early adopters arrivés par le lien d'invitation.
// « Hey LEMO, c'est Florio ! » -> présentation -> événement marquant -> relance angle mort
// -> synthèse « Vu par LEMO » face à une enquête à J+4 -> 5 invitations (bouton de transfert, message prêt).
import crypto from 'node:crypto';
import { config } from './config.js';
import { query, one } from './db.js';
import { reply, recordInbound, phoneHash } from './conversation.js';
import { sendImage } from './kapso.js';
import { notifyNewFeedback } from './notify.js';
import { blindSpotQuestion, experienceReport } from './llm.js';

export const INVITES_PER_MEMBER = 5;
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
       invited_by=coalesce(members.invited_by, excluded.invited_by), invites_total=excluded.invites_total, opted_out_at=null, state='awaiting_experience', updated_at=now()`,
    [hash, msg.phone, name, INVITES_PER_MEMBER, inviter?.id || null],
  );
  await query('delete from opt_outs where phone_hash=$1', [hash]); // « Hey LEMO » après un STOP = nouveau consentement
  const lines = [
    `Hello${name ? ` ${name}` : ''}. Je suis LEMO, le moteur d'analyse émotionnelle en temps réel : avant, pendant et après chaque expérience.`,
    `LEMO est en accès sur invitation uniquement. Tu disposes de ${INVITES_PER_MEMBER} invitations, débloquées après ta première expérience.`,
    "Le plus simple pour comprendre, c'est d'essayer. Tes réponses restent confidentielles : seul Florio, le fondateur, les lit et peut te recontacter. Écris STOP à tout moment pour tout arrêter.",
    'Peux-tu me décrire un événement marquant de ta journée ? Par écrit ou en vocal.',
  ];
  for (const [i, line] of lines.entries()) {
    if (i) await pause(PAUSE_MS);
    await reply(msg.phone, line);
  }
  return 'onboarding_welcome';
}

// Membre au milieu du parcours (événement marquant ou relance) ?
export async function inProgress(phone) {
  return one(`select * from members where phone_hash=$1 and opted_out_at is null and state in ('awaiting_experience','awaiting_blindspot')`, [phoneHash(phone)]);
}

// STOP : plus aucun contact (le bouton « Écrire » du CRM disparaît), réponses et échanges effacés.
export async function optOutMember(phoneHashValue) {
  const m = await one(
    `update members set opted_out_at=now(), phone=null, experience=null, followup=null, blindspot=null, report=null, card_token=null, projection=null, lead=null, updated_at=now()
     where phone_hash=$1 returning id`,
    [phoneHashValue],
  );
  if (m) await query(`delete from messages where phone_hash=$1 and session_id is null`, [phoneHashValue]);
  return Boolean(m);
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

// En dessous, le récit est trop maigre pour une analyse honnête : LEMO le dit et analyse un exemple.
export const THIN_WORDS = 25;
const words = (t) => String(t || '').split(/\s+/).filter(Boolean).length;

// Étape 2 : la réponse à la relance -> schéma (courbe de l'oubli) + synthèse « Vu par LEMO » / « Enquête à J+4 » / « La différence »,
// puis les invitations (bouton qui ouvre WhatsApp avec le message prêt à transférer).
export async function receiveBlindspot(msg, member) {
  if (!(await recordInbound(msg, { role: 'respondent' }))) return 'ignored:duplicate';
  const answer = spoken(msg);
  if (!answer) {
    await reply(msg.phone, "Je n'ai pas pu lire ce message. Tu peux me répondre par écrit ou en vocal.");
    return 'onboarding_unreadable';
  }
  const thin = words(member.experience) + words(answer) < THIN_WORDS;
  const report = await experienceReport({ experience: member.experience, followup: member.followup, answer, firstName: member.first_name, thin });
  report.thin = thin && Boolean(report.example);
  report.quote = report.thin ? null : verifiedQuote(report.quote, member.experience, answer);
  const token = crypto.randomBytes(12).toString('base64url'); // adresse non devinable du schéma (courbe de l'oubli)
  let code = member.invite_code;
  for (let i = 0; !code && i < 5; i++) {
    const candidate = newInviteCode();
    if (!(await one('select 1 from members where invite_code=$1', [candidate]))) code = candidate;
  }
  await query(`update members set blindspot=$2, report=$3, card_token=$4, invite_code=$5, state='experienced', updated_at=now() where id=$1`, [member.id, answer, JSON.stringify(report), token, code]);

  if (report.thin) {
    await reply(msg.phone, `J'ai très peu d'informations sur ton moment. Pour te montrer ce que LEMO capte, prenons un exemple :\n\n_« ${report.example} »_`);
    await pause(PAUSE_MS);
  }
  await sendCard(msg.phone, `${config.publicUrl}/m/${token}.png`, 'Ton moment, à chaud et à J+4.');
  await pause(PAUSE_MS);
  await reply(msg.phone, synthesisMessage(report));
  await pause(PAUSE_MS * 2);
  await sendCard(msg.phone, `${config.publicUrl}/v/dirigeant.png`, "Et voilà ce que verrait une équipe dirigeante : 200 retours à chaud sur un domaine skiable, en temps réel. Données fictives, pour l'exemple.");
  await pause(PAUSE_MS * 2);
  const { body, cta } = inviteMessage({ firstName: member.first_name, total: member.invites_total, code });
  await reply(msg.phone, body, { cta });
  const inviter = member.invited_by ? await one('select first_name from members where id=$1', [member.invited_by]) : null;
  notifyNewFeedback({ firstName: member.first_name, inviter: inviter?.first_name }).catch((e) => console.error('[alerte]', e.message));
  return 'onboarding_report';
}

// Synthèse lue sur WhatsApp : ce que LEMO a capté à chaud, ce qu'une enquête à J+4 en aurait gardé,
// et la différence (s'exprimer à chaud, avec l'outil du quotidien, pour pouvoir agir le jour même).
export function synthesisMessage(r) {
  const comment = String(r.survey_comment || '').replace(/^[«"\s]+|[»"\s]+$/g, '');
  return [
    ['*Vu par LEMO, à chaud*', ...(r.lemo_lines || []).map((l) => `*${l.label} :* ${l.text}`), r.quote ? `_« ${r.quote} »_` : null].filter(Boolean).join('\n'),
    [
      '*Enquête de satisfaction, à J+4*',
      `Il aurait fallu retrouver le mail, ouvrir le lien, te souvenir et remplir le questionnaire. Réponse type : *${r.survey_score}/10*, « ${comment} ». ${r.survey_lost || ''}`.trim(),
    ].join('\n'),
    [
      '*La différence*',
      "Tu as raconté ce moment à chaud, en deux messages, sur WhatsApp, l'outil que tu utilises déjà tous les jours. Une équipe peut donc ajuster ou réagir le jour même. Une enquête à J+4 arrive après l'oubli : la mémoire ne garde que le moment le plus fort et la fin, le reste se lisse en une note, trop tard pour décider.",
    ].join('\n'),
  ].join('\n\n');
}

async function sendCard(phone, link, caption) {
  await query(`insert into messages (direction, role, phone_hash, kind, body) values ('out','lemo',$1,'other',$2)`, [phoneHash(phone), `[image] ${link}`]);
  try {
    await sendImage(phone, link, caption);
  } catch (err) {
    console.error('[kapso] envoi image échoué :', err.message);
  }
}

// Dernier message : les invitations. Le bouton ouvre WhatsApp, on choisit un contact, le message est prêt.
export function inviteMessage({ firstName, total, code }) {
  const link = `${config.publicUrl}/i/${code}`;
  const share = `Je t'invite sur LEMO : la data émotionnelle en temps réel, en un message WhatsApp. Accès sur invitation uniquement, essaie : ${link}`;
  return {
    body: `Merci${firstName ? ` ${firstName}` : ''}. Tes ${total} invitations sont débloquées.\n\nFais vivre LEMO à ${total} personnes de ton choix : touche le bouton, choisis un contact, le message est prêt.`,
    cta: { text: "Envoyer l'invitation", url: `https://wa.me/?text=${encodeURIComponent(share)}`, footer: `${total} invitations · lien personnel` },
  };
}
