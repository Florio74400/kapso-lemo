// Catalogue des liens d'inscription (opt-in) du labo Compagnie du Mont-Blanc.
// Un modèle décrit : les questions posées au départ, les horaires des envois, la source des infos,
// les thèmes des questions et à qui renvoyer quand l'IA ne sait pas.
// Ajouter un nouveau parcours = ajouter un modèle ici, puis créer la collecte depuis le tableau de bord.
import * as cmb from './cmb-data.js';

export const PRESETS = {
  cmb_ski: {
    label: 'Alertes remontées mécaniques (démo CMB)',
    source: 'cmb_demo',
    title: 'votre journée de ski',
    intro: "Je peux vous envoyer chaque matin vers {morning}h l'état des remontées de votre domaine, pour les jours de votre choix ({max} jours maximum), répondre à vos questions et transmettre vos retours à l'équipe.",
    steps: [
      { key: 'domain', type: 'single', question: 'Quel domaine vous intéresse ?', options: cmb.DOMAINS.map((d) => ({ id: d.id, label: d.name, description: `Horaires ${d.hours}` })) },
      { key: 'days', type: 'days', question: 'Pour quels jours voulez-vous les infos ?', max: 3 },
    ],
    morning_hour: 8,
    eod_hour: 16,
    eod_question: "Comment s'est passée votre journée de ski ? Racontez-nous en quelques mots, par écrit ou en vocal.",
    topics: ['ouverture_remontees', 'horaires', 'meteo_neige', 'forfaits_tarifs', 'acces_parking_navettes', 'securite', 'restauration_services', 'autre'],
    fallback: 'se renseigner aux caisses du domaine',
    faq: cmb.FAQ,
  },
};

// Configuration effective d'une collecte (les anciennes collectes "alerts" sans config = modèle CMB).
export function getConfig(col) {
  const c = typeof col.config === 'string' ? JSON.parse(col.config) : col.config;
  return c || { preset: 'cmb_ski', ...PRESETS.cmb_ski };
}

export function presetConfig(id) {
  const p = PRESETS[id];
  if (!p) throw new Error(`Modèle inconnu : ${id}`);
  return { preset: id, ...p };
}

export function fill(text, cfg) {
  const days = cfg.steps.find((s) => s.type === 'days');
  return text.replace('{morning}', cfg.morning_hour).replace('{eod}', cfg.eod_hour ?? '').replace('{max}', days?.max ?? 1);
}

// Libellé lisible d'un choix (pour les confirmations et le tableau de bord).
export function choiceLabel(cfg, key, id) {
  const step = cfg.steps.find((s) => s.key === key);
  return step?.options?.find((o) => o.id === id)?.label || id;
}

// Message du matin selon la source. null = rien à envoyer ce jour-là.
export function morningBody(cfg, choices, date, infos) {
  const withTeam = (text) => {
    if (!infos.length) return text;
    const team = `Info de l'équipe :\n${infos.map((i) => `- ${i.body}`).join('\n')}\n`;
    return text.replace(/\nUne question/, `\n${team}\nUne question`);
  };
  if (cfg.source === 'cmb_demo') return withTeam(cmb.morningText(choices.domain, date));
  if (!infos.length) return null;
  return `Bonjour ! Les infos du ${cmb.dateLabel(date)} :\n${infos.map((i) => `- ${i.body}`).join('\n')}\n\nUne question, ou un retour ? Écrivez-le ici, à tout moment.`;
}

// Contexte transmis à l'IA pour répondre : source + infos de l'équipe + infos pratiques. Rien d'autre.
export function contextBody(cfg, choices, days, infos) {
  const base =
    cfg.source === 'cmb_demo' ? cmb.contextFor(choices.domain, days) : 'Pas de données automatiques.';
  const team = infos.length ? `\n\nInfos de l'équipe :\n${infos.map((i) => `- ${cmb.dateLabel(i.day)} : ${i.body}`).join('\n')}` : '';
  const faq = cfg.faq?.length ? `\n\nInformations pratiques :\n- ${cfg.faq.join('\n- ')}` : '';
  return base + team + faq;
}
