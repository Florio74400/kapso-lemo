// Tâches de fond : clôture des conversations abandonnées, reprise des analyses, purge RGPD.
import { query } from './db.js';
import { finalize, analyzeSession } from './conversation.js';
import { processEvent } from './server.js';
import { runAlerts } from './alerts.js';
import { reanchorDemoVerbatims } from '../scripts/demo-verbatims/index.js';

export async function runMaintenance() {
  // 0. Alertes remontées : info du matin, question de fin de journée, fin d'abonnement.
  await runAlerts();
  // 0 bis. Retours fictifs de démonstration : recalés sur la date du jour (sans effet s'ils ne sont pas chargés).
  await reanchorDemoVerbatims();
  // 1. Relance restée sans réponse 30 min : on analyse ce qu'on a (sans envoyer de message).
  for (const s of await query(`select id from sessions where state='awaiting_followup' and updated_at < now() - interval '30 minutes'`)) {
    await finalize(s.id);
  }
  // 2. Analyses en échec (ex : API indisponible) : nouvel essai.
  for (const s of await query(
    `select s.*, c.title from sessions s join collections c on c.id=s.collection_id where s.state='analyzing' and s.updated_at < now() - interval '2 minutes'`,
  )) {
    await analyzeSession(s);
  }
  // 3. Conversations jamais terminées : fermées après 24 h (fin de la fenêtre WhatsApp), numéro effacé.
  await query(
    `update sessions set state='declined', phone=null, completed_at=now()
     where state in ('awaiting_consent','awaiting_answer') and updated_at < now() - interval '24 hours'`,
  );
  await query(`update sessions set phone=null where phone is not null and updated_at < now() - interval '24 hours'`);
  // 4. Webhooks enregistrés non traités.
  for (const e of await query(`select id, payload from webhook_events where status='pending' and created_at < now() - interval '2 minutes'`)) {
    const p = typeof e.payload === 'string' ? JSON.parse(e.payload) : e.payload;
    await processEvent(e.id, p.event, p.payload);
  }
  // 5. Conservation limitée : suppression au-delà de la durée choisie par chaque entreprise.
  await query(
    `delete from sessions s using collections c, companies co
     where s.collection_id=c.id and c.company_id=co.id and s.created_at < now() - make_interval(days => co.retention_days)`,
  );
  await query(
    `delete from messages m using companies co where m.company_id=co.id and m.created_at < now() - make_interval(days => co.retention_days)`,
  );
  await query(
    `delete from questions q using collections c, companies co
     where q.collection_id=c.id and c.company_id=co.id and q.created_at < now() - make_interval(days => co.retention_days)`,
  );
  await query(`delete from messages where company_id is null and created_at < now() - interval '30 days'`);
  await query(`delete from webhook_events where created_at < now() - interval '7 days'`);
  await query(`delete from documents where created_at < now() - interval '30 days'`);
}

export function startJobs() {
  const tick = () => runMaintenance().catch((e) => console.error('[maintenance]', e.message));
  setTimeout(tick, 5000);
  return setInterval(tick, 60 * 1000);
}
