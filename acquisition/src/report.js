// Bilan d'une collecte : statistiques + synthèse IA, soumise au seuil de confidentialité.
import { query } from './db.js';
import { synthesize } from './llm.js';

function tally(values) {
  const m = new Map();
  for (const v of values) if (v) m.set(v, (m.get(v) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([label, count]) => ({ label, count }));
}

export async function collectionStats(collectionId) {
  const rows = await query(`select analysis, emotion, sentiment, urgency from feedbacks where collection_id=$1`, [collectionId]);
  const analyses = rows.map((r) => (typeof r.analysis === 'string' ? JSON.parse(r.analysis) : r.analysis));
  return {
    n: rows.length,
    analyses,
    emotions: tally(rows.map((r) => r.emotion)),
    tones: tally(rows.map((r) => r.sentiment)),
    topics: tally(analyses.flatMap((a) => a.topics || [])).slice(0, 10),
    alerts: rows.filter((r) => r.urgency === 'high' || r.urgency === 'medium').length,
  };
}

// Régénère la synthèse uniquement si de nouveaux retours sont arrivés.
export async function buildReport(col, company, { force = false } = {}) {
  const stats = await collectionStats(col.id);
  const threshold = company.privacy_threshold;
  const below = stats.n < threshold;
  let synthesis = col.summary ? (typeof col.summary === 'string' ? JSON.parse(col.summary) : col.summary) : null;

  if (!below && (force || !synthesis || col.summary_count !== stats.n)) {
    synthesis = await synthesize({ title: col.title, analyses: stats.analyses });
    await query('update collections set summary=$2, summary_count=$3 where id=$1', [col.id, JSON.stringify(synthesis), stats.n]);
  }
  if (below) synthesis = null;

  const lines = [`*Bilan : ${col.title}* (${col.code})`, `Participants : ${stats.n}`];
  if (below) {
    lines.push(`\nPar confidentialité, la synthèse s'affiche à partir de ${threshold} répondants. Encore ${threshold - stats.n} à recueillir.`);
  } else {
    const list = (arr, numbered) => (arr.length ? arr.map((x, i) => `${numbered ? `${i + 1}.` : '-'} ${x}`).join('\n') : '- rien de notable');
    lines.push(`\n*Points positifs*\n${list(synthesis.positives.slice(0, 3))}`);
    lines.push(`\n*Problèmes principaux*\n${list(synthesis.problems.slice(0, 3), true)}`);
    if (synthesis.insight) lines.push(`\n*Découverte*\n${synthesis.insight}`);
    lines.push(`\n*Actions recommandées*\n${list(synthesis.actions.slice(0, 3), true)}`);
    if (stats.alerts) lines.push(`\n${stats.alerts} retour(s) signalé(s) comme urgent(s) : à consulter dans le tableau de bord.`);
  }
  return { ...stats, threshold, belowThreshold: below, synthesis, whatsappText: lines.join('\n') };
}
