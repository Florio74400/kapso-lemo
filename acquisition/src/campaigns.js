// Test A/B de la fin de parcours early adopter, et mini-campagnes (variante B).
//   A : « Envoyer l'invitation » : 5 invitations à transférer (message prêt).
//   B : « Créer ma campagne » : le dirigeant donne un sujet, LEMO rédige la question et le message à transférer,
//       jusqu'à 5 personnes répondent à chaud sur WhatsApp, et leurs retours arrivent au dirigeant (sans leur numéro).
// Répartition 50/50, un parcours sur deux. Chaque étape est journalisée dans ab_events pour le CRM.
import crypto from 'node:crypto';
import { config } from './config.js';
import { query, one } from './db.js';
import { reply, recordInbound, phoneHash } from './conversation.js';
import { blindSpotQuestion, experienceReport, campaignDraft } from './llm.js';

const PAUSE_MS = Number(process.env.ONBOARDING_PAUSE_MS ?? 900);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const spoken = (msg) => (msg.kind === 'audio' ? msg.transcript : msg.body)?.trim();
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from(crypto.randomBytes(6), (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');

export const CAMPAIGN_RE = /\(campagne\s+([A-Z0-9]{6})\)/i;
export const START_RE = /^\s*cr[ée]er\s+(ma\s+)?campagne/i;

export async function logEvent(memberId, variant, kind) {
  await query('insert into ab_events (member_id, variant, kind) values ($1,$2,$3)', [memberId, variant, kind]).catch((e) => console.error('[ab]', e.message));
}

// Un parcours sur deux : A, B, A, B… (AB_FORCE=A ou B pour tester une variante précise).
export async function pickVariant() {
  const forced = String(process.env.AB_FORCE || '').toUpperCase();
  if (forced === 'A' || forced === 'B') return forced;
  const { n } = await one(`select count(*)::int as n from ab_events where kind='shown'`);
  return n % 2 === 0 ? 'A' : 'B';
}

// ---------- Dernier message du parcours, selon la variante ----------
export async function sendEnding(member, phone, inviteCode) {
  const variant = await pickVariant();
  await query('update members set variant=$2 where id=$1', [member.id, variant]);
  const name = member.first_name ? ` ${member.first_name}` : '';
  const total = member.invites_total;
  if (variant === 'A') {
    await reply(
      phone,
      `Merci${name}. Tes ${total} invitations sont débloquées.\n\nFais vivre LEMO à ${total} personnes de ton choix : touche le bouton, choisis un contact, le message est prêt.`,
      { cta: { text: "Envoyer l'invitation", url: `${config.publicUrl}/go/i/${inviteCode}`, footer: `${total} invitations · lien personnel` } },
    );
  } else {
    await reply(
      phone,
      `Merci${name}. Tes ${total} invitations sont débloquées.\n\nUtilise-les pour lancer ta propre campagne : tu choisis un sujet, LEMO rédige la question, et ${total} personnes de ton choix te répondent à chaud, sur WhatsApp.`,
      { buttons: [{ id: 'campaign_start', title: 'Créer ma campagne' }] },
    );
  }
  await logEvent(member.id, variant, 'shown');
  return variant;
}

// Texte partagé par la variante A (ouvert après le clic suivi sur /go/i/CODE).
export function inviteShareText(inviteCode) {
  return `Je t'invite sur LEMO : la data émotionnelle en temps réel, en un message WhatsApp. Accès sur invitation uniquement, essaie : ${config.publicUrl}/i/${inviteCode}`;
}

// ---------- Variante B, côté dirigeant ----------
export async function wantsCampaign(msg, member) {
  return member.variant === 'B' && !member.opted_out_at && (msg.buttonId === 'campaign_start' || START_RE.test(msg.body || ''));
}

export async function startCampaign(msg, member) {
  if (!(await recordInbound(msg, { role: 'respondent' }))) return 'ignored:duplicate';
  await query(`update members set state='awaiting_campaign_topic', updated_at=now() where id=$1`, [member.id]);
  await logEvent(member.id, 'B', 'cta_click');
  await reply(
    msg.phone,
    "Très bien. Sur quel moment veux-tu le ressenti de tes 5 personnes ?\n\nPar exemple : l'accueil de ton restaurant ce midi, la réunion d'équipe de ce matin, la livraison d'une commande client. En une phrase, par écrit ou en vocal.",
  );
  return 'campaign_start';
}

export async function receiveTopic(msg, member) {
  if (!(await recordInbound(msg, { role: 'respondent' }))) return 'ignored:duplicate';
  const topic = spoken(msg);
  if (!topic) {
    await reply(msg.phone, "Je n'ai pas pu lire ce message. Dis-moi en une phrase sur quel moment tu veux leur avis.");
    return 'campaign_unreadable';
  }
  const draft = await campaignDraft({ leaderName: member.first_name, topic });
  let code = null;
  for (let i = 0; !code && i < 5; i++) {
    const c = newCode();
    if (!(await one('select 1 from campaigns where code=$1', [c]))) code = c;
  }
  const forward = forwardMessage({ leader: member.first_name, register: draft.register, subject: draft.subject, code });
  await query(
    `insert into campaigns (code, member_id, topic, title, subject, register, question, forward_message) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [code, member.id, topic, draft.title, draft.subject, draft.register, draft.question, forward],
  );
  await query(`update members set state='experienced', updated_at=now() where id=$1`, [member.id]);
  await logEvent(member.id, 'B', 'campaign_created');
  const n = member.invites_total;
  await reply(
    msg.phone,
    `*Ta campagne est prête*\n*Sujet :* ${draft.title}\n*La question :* « ${draft.question} »\n\nTouche le bouton et choisis jusqu'à ${n} personnes : le message est prêt. Leurs retours arrivent ici, à chaud, sans leur numéro.`,
    { cta: { text: 'Envoyer la campagne', url: `${config.publicUrl}/go/c/${code}`, footer: `${n} personnes · réponses sans numéro` } },
  );
  return 'campaign_created';
}

// Le message que le dirigeant transfère : qui demande, sur quoi, combien de temps, ce que devient la réponse.
export function forwardMessage({ leader, register, subject, code }) {
  const who = leader || 'moi';
  const link = `${config.publicUrl}/c/${code}`;
  return register === 'vous'
    ? `Bonjour, c'est ${who}. J'aimerais votre ressenti, à chaud, sur ${subject}. Je teste LEMO : deux petites questions sur WhatsApp, une minute, par écrit ou en vocal. Votre réponse me sera transmise sans votre numéro. Pour répondre : ${link}`
    : `Salut, c'est ${who}. J'aimerais ton ressenti, à chaud, sur ${subject}. Je teste LEMO : deux petites questions sur WhatsApp, une minute, par écrit ou en vocal. Ta réponse me sera transmise sans ton numéro. Pour répondre : ${link}`;
}

// Message prérempli quand un participant ouvre le lien /c/CODE.
export function participantHello(campaign, leader) {
  return `Hey LEMO, je réponds à ${leader || 'ta campagne'} (campagne ${campaign.code})`;
}

// ---------- Variante B, côté participant ----------
const T = (c, tu, vous) => (c.register === 'vous' ? vous : tu);

export async function campaignByCode(code) {
  return one(
    `select c.*, m.first_name as leader, m.phone as leader_phone, m.invites_total from campaigns c join members m on m.id=c.member_id where c.code=$1`,
    [String(code || '').toUpperCase()],
  );
}

export async function participantInProgress(phone) {
  return one(
    `select r.*, c.code, c.question, c.register, c.title, c.member_id, m.first_name as leader
     from campaign_responses r join campaigns c on c.id=r.campaign_id join members m on m.id=c.member_id
     where r.phone_hash=$1 and r.state in ('awaiting_answer','awaiting_followup') order by r.created_at desc limit 1`,
    [phoneHash(phone)],
  );
}

export async function participantStart(msg, code) {
  if (!(await recordInbound(msg, { role: 'respondent' }))) return 'ignored:duplicate';
  const c = await campaignByCode(code);
  if (!c) {
    await reply(msg.phone, "Ce lien de campagne n'est plus valable. Demande à la personne qui te l'a envoyé de t'en renvoyer un.");
    return 'campaign_unknown';
  }
  const hash = phoneHash(msg.phone);
  const existing = await one('select * from campaign_responses where campaign_id=$1 and phone_hash=$2', [c.id, hash]);
  if (!existing) {
    const { n } = await one(`select count(*)::int as n from campaign_responses where campaign_id=$1`, [c.id]);
    if (n >= c.invites_total) {
      await reply(msg.phone, T(c, `Merci ! La campagne de ${c.leader} a déjà reçu toutes ses réponses.`, `Merci ! La campagne de ${c.leader} a déjà reçu toutes ses réponses.`));
      return 'campaign_full';
    }
    await query(`insert into campaign_responses (campaign_id, phone_hash, phone) values ($1,$2,$3)`, [c.id, hash, msg.phone]);
  } else {
    await query(`update campaign_responses set state='awaiting_answer', phone=$2 where id=$1 and state <> 'done'`, [existing.id, msg.phone]);
  }
  await logEvent(c.member_id, 'B', 'participant_start');
  await reply(
    msg.phone,
    T(
      c,
      `Bonjour, je suis LEMO. ${c.leader} aimerait ton ressenti, à chaud. Ta réponse lui sera transmise, sans ton numéro. Écris STOP pour arrêter.`,
      `Bonjour, je suis LEMO. ${c.leader} aimerait votre ressenti, à chaud. Votre réponse lui sera transmise, sans votre numéro. Écrivez STOP pour arrêter.`,
    ),
  );
  await pause(PAUSE_MS);
  await reply(msg.phone, c.question);
  return 'participant_start';
}

export async function participantAnswer(msg, r) {
  if (!(await recordInbound(msg, { role: 'respondent' }))) return 'ignored:duplicate';
  const text = spoken(msg);
  if (!text) {
    await reply(msg.phone, T(r, "Je n'ai pas pu lire ce message. Tu peux répondre par écrit ou en vocal.", "Je n'ai pas pu lire ce message. Vous pouvez répondre par écrit ou en vocal."));
    return 'participant_unreadable';
  }
  if (r.state === 'awaiting_answer') {
    const { question } = await blindSpotQuestion({ experience: text, register: r.register });
    await query(`update campaign_responses set answer=$2, followup=$3, state='awaiting_followup' where id=$1`, [r.id, text, question]);
    await reply(msg.phone, question);
    return 'participant_answer';
  }
  const report = await experienceReport({ experience: r.answer, followup: r.followup, answer: text, thin: false });
  await query(`update campaign_responses set followup_answer=$2, analysis=$3, state='done', completed_at=now(), phone=null where id=$1`, [r.id, text, JSON.stringify(report)]);
  await logEvent(r.member_id, 'B', 'participant_done');
  await reply(
    msg.phone,
    T(
      r,
      `Merci, ton retour est transmis à ${r.leader}. LEMO est en accès sur invitation : pour le vivre à ton tour, écris « Hey LEMO ».`,
      `Merci, votre retour est transmis à ${r.leader}. LEMO est en accès sur invitation : pour le vivre à votre tour, écrivez « Hey LEMO ».`,
    ),
  );
  await notifyLeader(r, report);
  return 'participant_done';
}

// Le retour arrive au dirigeant sur WhatsApp, s'il a écrit à LEMO dans les dernières 24 h (règle WhatsApp).
// Sinon il reste consultable dans le CRM.
async function notifyLeader(r, report) {
  const leader = await one('select id, phone, phone_hash, opted_out_at from members where id=$1', [r.member_id]);
  if (!leader?.phone || leader.opted_out_at) return;
  const recent = await one(`select 1 from messages where phone_hash=$1 and direction='in' and created_at > now() - interval '23 hours 50 minutes' limit 1`, [leader.phone_hash]);
  if (!recent) return;
  const { n } = await one(`select count(*)::int as n from campaign_responses where campaign_id=$1 and state='done'`, [r.campaign_id]);
  const lines = (report.lemo_lines || []).filter((l) => !/^d[ée]tail/i.test(l.label)).slice(0, 3);
  await reply(leader.phone, [`*Retour ${n} · ${r.title}*`, ...lines.map((l) => `*${l.label} :* ${l.text}`)].join('\n'));
}

export async function optOutParticipant(hash) {
  const rows = await query(
    `update campaign_responses set state='stopped', phone=null, answer=null, followup_answer=null, analysis=null where phone_hash=$1 and state <> 'done' returning id`,
    [hash],
  );
  return rows.length > 0;
}
