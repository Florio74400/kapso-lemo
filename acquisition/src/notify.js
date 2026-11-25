// Alerte au fondateur à chaque parcours terminé, hors WhatsApp (pour ne pas mélanger avec ses propres tests).
// Deux canaux, activés par variables d'environnement :
//  - NTFY_TOPIC : notification push sur le téléphone via l'appli gratuite ntfy (sans compte). Le sujet est secret.
//  - RESEND_API_KEY + ALERT_EMAIL : e-mail via Resend (ALERT_FROM optionnel).
// Contenu volontairement minimal (prénom, qui l'a invité, lien vers le CRM) : aucun détail confié par la personne.
import { config } from './config.js';

export async function notifyNewFeedback({ firstName, inviter }) {
  const title = `LEMO : ${firstName || 'quelqu’un'} a terminé son parcours`;
  const body = `${firstName || 'Un early adopter'}${inviter ? `, invité par ${inviter},` : ''} vient de raconter son moment. Sa fiche et le bouton « Écrire » t'attendent dans le CRM.`;
  const link = `${config.publicUrl}/early-adopters`;
  const jobs = [];
  if (process.env.NTFY_TOPIC) {
    jobs.push(
      fetch('https://ntfy.sh/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: process.env.NTFY_TOPIC.trim(), title, message: body, click: link, tags: ['speech_balloon'] }),
      }).then((r) => { if (!r.ok) throw new Error(`ntfy ${r.status}`); }),
    );
  }
  if (process.env.RESEND_API_KEY && process.env.ALERT_EMAIL) {
    jobs.push(
      fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY.trim()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: process.env.ALERT_FROM || 'LEMO <onboarding@resend.dev>',
          to: process.env.ALERT_EMAIL.trim(),
          subject: title,
          text: `${body}\n\n${link}`,
        }),
      }).then((r) => { if (!r.ok) throw new Error(`resend ${r.status}`); }),
    );
  }
  const results = await Promise.allSettled(jobs);
  for (const r of results) if (r.status === 'rejected') console.error('[alerte]', r.reason?.message);
  return jobs.length;
}
