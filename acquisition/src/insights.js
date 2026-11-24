// Réponses aux questions de la direction sur WhatsApp ("Y a-t-il eu des problèmes aujourd'hui à la Flégère ?").
// On rassemble les données de l'entreprise sur la période (retours analysés, questions des clients, infos du jour),
// puis Claude répond uniquement à partir de ces données. Aucun numéro de téléphone n'est transmis.
import { query } from './db.js';
import { answerDataQuestion, ANSWER_MAX_WORDS } from './llm.js';
import { getConfig, choiceLabel } from './optins.js';
import { parisNow, addDays } from './alerts.js';

const MAX_ITEMS = 300;

// Minuit (heure de Paris) du jour donné, en instant UTC.
function parisMidnight(date) {
  const guess = new Date(`${date}T00:00:00Z`);
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', hour12: false }).format(guess)) % 24;
  return new Date(guess.getTime() - h * 3600 * 1000);
}

export function periodBounds(period, now = parisNow()) {
  const today = parisMidnight(now.date);
  const tomorrow = parisMidnight(addDays(now.date, 1));
  switch (period) {
    case 'today':
      return { from: today, to: tomorrow, label: "aujourd'hui", days: [now.date] };
    case 'yesterday':
      return { from: parisMidnight(addDays(now.date, -1)), to: today, label: 'hier', days: [addDays(now.date, -1)] };
    case '30d':
      return { from: parisMidnight(addDays(now.date, -29)), to: tomorrow, label: 'sur les 30 derniers jours', days: null };
    case 'all':
      return { from: new Date(0), to: tomorrow, label: 'depuis le début', days: null };
    default:
      return { from: parisMidnight(addDays(now.date, -6)), to: tomorrow, label: 'sur les 7 derniers jours', days: null };
  }
}

const fmt = (d) => new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(d));
const clip = (s, n) => (s && s.length > n ? `${s.slice(0, n)}…` : s || '');
const parse = (v) => (typeof v === 'string' ? JSON.parse(v) : v || {});

export async function gatherData(companyId, period) {
  const b = periodBounds(period);
  const feedbacks = await query(
    `select f.created_at, f.emotion, f.sentiment, f.urgency, f.analysis, f.verbatim, c.title, c.kind, c.config, sub.choices, sub.domain
     from feedbacks f
     join collections c on c.id = f.collection_id
     join sessions s on s.id = f.session_id
     left join lateral (
       select x.choices, x.domain from subscriptions x where x.phone_hash = s.phone_hash and x.collection_id = f.collection_id order by x.created_at desc limit 1
     ) sub on true
     where c.company_id = $1 and f.created_at >= $2 and f.created_at < $3
     order by f.created_at desc limit ${MAX_ITEMS}`,
    [companyId, b.from, b.to],
  );
  const questions = await query(
    `select q.created_at, q.question, q.topic, q.answerable, c.title from questions q join collections c on c.id = q.collection_id
     where c.company_id = $1 and q.created_at >= $2 and q.created_at < $3 order by q.created_at desc limit ${MAX_ITEMS}`,
    [companyId, b.from, b.to],
  );
  const infos = await query(
    `select d.day, d.body, c.title from daily_info d join collections c on c.id = d.collection_id
     where c.company_id = $1 and ($2::text[] is null or d.day = any($2)) order by d.day desc limit 50`,
    [companyId, b.days],
  );

  const lines = [];
  for (const f of feedbacks) {
    const a = parse(f.analysis);
    let where = '';
    if (f.kind === 'alerts') {
      const cfg = getConfig(f);
      const ch = parse(f.choices);
      if (!ch.domain && f.domain) ch.domain = f.domain;
      where = cfg.steps
        .filter((s) => s.type !== 'days' && ch[s.key] != null)
        .map((s) => [].concat(ch[s.key]).map((id) => choiceLabel(cfg, s.key, id)).join(', '))
        .join(' · ');
    }
    lines.push(
      `[retour ${fmt(f.created_at)}] ${f.title}${where ? ` · ${where}` : ''} | émotion ${f.emotion}, ton ${f.sentiment}, urgence ${f.urgency} | résumé : ${a.summary || ''} | irritants : ${(a.irritants || []).join(' ; ') || '-'} | positifs : ${(a.positives || []).join(' ; ') || '-'} | verbatim : "${clip(f.verbatim, 300)}"`,
    );
  }
  for (const q of questions) lines.push(`[question ${fmt(q.created_at)}] ${q.title} | thème ${q.topic} | ${q.answerable === false ? 'SANS RÉPONSE' : 'répondue'} | "${clip(q.question, 200)}"`);
  for (const i of infos) lines.push(`[info équipe ${i.day}] ${i.title} | ${i.body}`);

  return { label: b.label, text: lines.join('\n'), feedbackCount: feedbacks.length, questionCount: questions.length, total: lines.length };
}

export async function answerForManager({ company, question, period }) {
  const data = await gatherData(company.id, period || '7d');
  if (!data.total) return `Je n'ai aucun retour ni question client ${data.label}. Essayez une période plus large, par exemple « sur 7 jours » ou « ce mois-ci ».`;
  const res = await answerDataQuestion({
    question,
    company: company.name,
    periodLabel: data.label,
    data: data.text,
    respondents: data.feedbackCount,
    threshold: company.privacy_threshold,
  });
  // Citations : seulement au-dessus du seuil, et seulement si elles existent mot pour mot dans les verbatims.
  const flat = (x) => x.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[«»"“”'’]/g, '').replace(/\s+/g, ' ').trim();
  const corpus = flat(data.text);
  const quotes =
    data.feedbackCount >= company.privacy_threshold
      ? (res.quotes || []).filter((q) => q.text && corpus.includes(flat(q.text))).slice(0, 2)
      : [];
  const body = capWords(res.answer, ANSWER_MAX_WORDS + 15);
  const refs = quotes.map((q) => `« ${q.text.trim()} »\n_${q.where}_`).join('\n\n');
  return `${body}${refs ? `\n\n${refs}` : ''}\n\n_${data.feedbackCount} retour(s), ${data.questionCount} question(s) · ${data.label}_`;
}

// Garde-fou de longueur : coupe à la dernière phrase complète sous la limite.
function capWords(text, max) {
  const words = text.trim().split(/\s+/);
  if (words.length <= max) return text.trim();
  const cut = words.slice(0, max).join(' ');
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('.\n'));
  return end > 0 ? cut.slice(0, end + 1) : `${cut}…`;
}
