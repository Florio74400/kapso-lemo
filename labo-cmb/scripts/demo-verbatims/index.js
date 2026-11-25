// Chargement des retours FICTIFS de démonstration dans une collecte dédiée, fermée et marquée [DÉMO].
// Activé par la variable DEMO_VERBATIMS_FOR=<email admin de l'entreprise>. Sans effet si déjà chargé.
// Suppression : supprimer la collecte LEMO-DM2X (tout le reste part en cascade).
import crypto from 'node:crypto';
import { one, query } from '../../src/db.js';
import part1 from './part1.js';
import part2 from './part2.js';
import part3 from './part3.js';
import part4 from './part4.js';
import part5 from './part5.js';

export const DEMO_CODE = 'LEMO-DM2X';
const ROWS = [...part1, ...part2, ...part3, ...part4, ...part5];

// Phrases d'allongement pour les retours courts (choisies selon le ton, de façon déterministe).
const OPENERS = [
  'Petit retour sur notre journée.',
  'On était venus en famille pour le week-end.',
  'Première fois dans la vallée pour nous.',
  'Je viens chaque année depuis une dizaine d’années.',
  'On est venus entre amis depuis Lyon.',
  'Je réponds au message reçu tout à l’heure.',
  'Séjour d’une semaine à Chamonix avec ma compagne.',
  'Nous sommes des habitués de la vallée.',
];
const CLOSERS = {
  positive: ['On recommandera sans hésiter autour de nous.', 'Merci à toute l’équipe, on reviendra.', 'Vraiment rien à redire, continuez comme ça.', 'C’est ce genre de détail qui fait la différence.'],
  negative: ['On espère que ce sera amélioré pour la prochaine fois.', 'C’est dommage parce que le site est magnifique.', 'Pour le prix payé, on attend mieux.', 'Ça a un peu gâché la journée.'],
  neutral: ['Pas dramatique, mais c’est à améliorer.', 'Sinon la journée s’est bien passée.', 'Un détail, mais autant le signaler.'],
  mixed: ['Au final une belle journée, malgré ce point.', 'Le reste était très bien, heureusement.', 'Un détail, mais autant le signaler.'],
};
const words = (s) => s.split(/\s+/).length;

function lengthen(text, tone, i) {
  if (words(text) >= 40) return text;
  const closer = CLOSERS[tone][i % CLOSERS[tone].length];
  if (words(text) >= 25) return `${text} ${closer}`;
  return `${OPENERS[i % OPENERS.length]} ${text} ${closer}`;
}

const split = (s) => (s ? s.split(';').map((x) => x.trim()).filter(Boolean) : []);

export function buildRows(now = Date.now()) {
  return ROWS.map(([day, time, domain, emotion, tone, urgency, topics, pos, irr, sug, text], i) => {
    let at = new Date(`2026-11-${String(day).padStart(2, '0')}T${time}:00+01:00`);
    if (at.getTime() > now) at = new Date(now - (i % 50 + 5) * 60 * 1000); // jamais dans le futur
    const irritants = split(irr);
    const summary = (text.match(/^[^.!?]+[.!?]/)?.[0] || text).slice(0, 220);
    return {
      at,
      domain,
      day: `2026-11-${String(day).padStart(2, '0')}`,
      verbatim: lengthen(text, tone, i),
      analysis: {
        summary,
        emotion,
        tone,
        topics: topics.split(',').map((t) => t.replace(/-/g, ' ')),
        positives: split(pos),
        irritants,
        suggestions: split(sug),
        urgency,
        urgency_reason: ['medium', 'high'].includes(urgency) ? irritants[0] || null : null,
      },
    };
  });
}

export async function seedDemoVerbatims(adminEmail) {
  const company = await one('select id from companies where lower(admin_email)=lower($1)', [adminEmail]);
  if (!company) return console.warn('[démo] entreprise introuvable pour les retours fictifs');
  if (await one('select 1 from collections where code=$1', [DEMO_CODE])) return;
  const col = await one(
    `insert into collections (company_id, code, title, question, kind, status) values ($1,$2,$3,$4,'alerts','closed') returning id`,
    [company.id, DEMO_CODE, '[DÉMO] journée de ski (retours fictifs)', "Comment s'est passée votre journée ?"],
  );
  const rows = buildRows();
  for (const [i, r] of rows.entries()) {
    const hash = `demo-${crypto.createHash('sha256').update(`${DEMO_CODE}-${i}`).digest('hex').slice(0, 24)}`;
    await query(
      `insert into subscriptions (collection_id, phone_hash, domain, days, choices, state, created_at, updated_at) values ($1,$2,$3,$4,$5,'ended',$6,$6)`,
      [col.id, hash, r.domain, [r.day], JSON.stringify({ domain: r.domain, days: [r.day] }), r.at],
    );
    const s = await one(
      `insert into sessions (collection_id, phone_hash, state, created_at, updated_at, completed_at) values ($1,$2,'done',$3,$3,$3) returning id`,
      [col.id, hash, r.at],
    );
    await query(
      `insert into feedbacks (session_id, collection_id, verbatim, analysis, emotion, sentiment, urgency, simulated, created_at) values ($1,$2,$3,$4,$5,$6,$7,true,$8)`,
      [s.id, col.id, r.verbatim, JSON.stringify(r.analysis), r.analysis.emotion, r.analysis.tone, r.analysis.urgency, r.at],
    );
  }
  console.log(`[démo] ${rows.length} retours fictifs chargés dans ${DEMO_CODE}`);
}

// Recale les retours fictifs pour que leur dernier jour soit aujourd'hui (heure de Paris).
// Sans ce recalage, « aujourd'hui » ou « cette semaine » ne trouvent plus rien quelques jours après le chargement,
// et la purge RGPD finirait par les supprimer. Décalage en jours entiers : l'heure de chaque retour est conservée.
// Les retours d'aujourd'hui dont l'heure n'est pas encore passée sont ignorés par Jarvis (voir insights.js).
export async function reanchorDemoVerbatims(today = parisToday()) {
  const col = await one('select id from collections where code=$1', [DEMO_CODE]);
  if (!col) return 0;
  const last = await one(
    `select max(to_char(created_at at time zone 'Europe/Paris', 'YYYY-MM-DD')) as d from feedbacks where collection_id=$1`,
    [col.id],
  );
  if (!last?.d) return 0;
  const delta = Math.round((Date.parse(today) - Date.parse(last.d)) / 86400000);
  if (delta <= 0) return 0;
  const shift = (c) => `${c} = ${c} + make_interval(days => $2::int)`;
  await query(`update feedbacks set ${shift('created_at')} where collection_id=$1`, [col.id, delta]);
  await query(
    `update sessions set ${shift('created_at')}, ${shift('updated_at')}, ${shift('last_inbound_at')}, ${shift('completed_at')} where collection_id=$1`,
    [col.id, delta],
  );
  await query(
    `update subscriptions set ${shift('created_at')}, ${shift('updated_at')},
       days = array(select to_char(d::date + $2::int, 'YYYY-MM-DD') from unnest(days) d)
     where collection_id=$1`,
    [col.id, delta],
  );
  await query(`update subscriptions set choices = jsonb_set(choices, '{days}', to_jsonb(days)) where collection_id=$1 and choices ? 'days'`, [col.id]);
  console.log(`[démo] retours fictifs recalés de ${delta} jour(s) : dernier jour = ${today}`);
  return delta;
}

function parisToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());
}
