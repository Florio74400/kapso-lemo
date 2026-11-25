// « Vue dirigeant » envoyée à la fin du parcours : ce que verrait une équipe dirigeante avec LEMO.
// Exemple FICTIF : 200 retours à chaud sur un domaine skiable (aucun nom d'exploitant ni de lieu).
// Chiffres tirés du jeu de 200 retours fictifs du labo (émotions, sujets, urgences), arrondis.
import fs from 'node:fs';
import { Resvg } from '@resvg/resvg-js';

const FONTS = [300, 500, 700].map((w) => new URL(`../public/fonts/montserrat-${w}.ttf`, import.meta.url).pathname);
const mark = fs.readFileSync(new URL('../public/lemo-mark.svg', import.meta.url), 'utf8').replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
const xml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const INK = '#1A1A1A';
const GREY = '#888888';
const ACCENT = '#6B7CFF';
const WARM = '#E8856B';

export const DEMO = {
  total: 200,
  period: 'Du 1er au 23 novembre',
  positive: 49, // % de retours positifs (98 / 200)
  alerts: 8, // retours d'urgence haute
  emotions: [['Satisfaction', 35], ['Frustration', 17], ['Déception', 12], ['Neutre', 12], ['Joie', 8]],
  irritants: [['Attente aux remontées', 19], ['Manque d’information', 18], ['Sécurité', 13], ['Fermetures', 13], ['Restauration', 9]],
  alert: { time: '10h20', text: '« Bloqués 45 minutes dans la cabine, sans la moindre annonce. Des gens paniquaient. »', sent: 'Signalé à l’exploitation à 10h21' },
};

export function dashboardSvg(d = DEMO) {
  const W = 1080;
  const H = 1350;
  const t = [];
  const text = (x, y, s, size, weight, color, extra = '') =>
    t.push(`<text x="${x}" y="${y}" font-family="Montserrat" font-size="${size}" font-weight="${weight}" fill="${color}" ${extra}>${xml(s)}</text>`);

  // En-tête
  t.push(`<svg x="80" y="76" width="112" height="36" viewBox="0 0 864 278"><g fill="${INK}">${mark}</g></svg>`);
  text(1000, 102, 'VUE DIRIGEANT', 18, 700, ACCENT, 'text-anchor="end" letter-spacing="4"');
  text(80, 206, 'Domaine skiable', 40, 700, INK);
  text(80, 258, `${d.total} retours à chaud, en temps réel`, 40, 700, '#9A9AA2');
  t.push(`<rect x="80" y="288" width="290" height="40" rx="20" fill="#FFF4EF" stroke="#F6C9B8"/>`);
  text(225, 315, 'DONNÉES FICTIVES', 16, 700, WARM, 'text-anchor="middle" letter-spacing="3"');
  text(390, 315, d.period, 20, 300, GREY);

  // Chiffres clés
  const kpis = [[String(d.total), 'retours'], [`${d.positive} %`, 'positifs'], [String(d.alerts), 'alertes critiques']];
  kpis.forEach(([v, l], i) => {
    const x = 80 + i * 313;
    t.push(`<rect x="${x}" y="360" width="294" height="140" rx="20" fill="#F5F6FF"/>`);
    text(x + 28, 438, v, 52, 700, i === 2 ? WARM : INK);
    text(x + 28, 476, l, 22, 500, GREY);
  });

  // Émotions dominantes
  text(80, 566, 'ÉMOTIONS', 18, 700, GREY, 'letter-spacing="3"');
  d.emotions.forEach(([label, pct], i) => {
    const y = 606 + i * 44;
    text(80, y + 8, label, 22, 500, INK);
    t.push(`<rect x="250" y="${y - 10}" width="${(pct / 35) * 120}" height="18" rx="9" fill="${ACCENT}" fill-opacity="${1 - i * 0.14}"/>`);
    text(450, y + 8, `${pct} %`, 20, 300, GREY, 'text-anchor="end"');
  });

  // Ce qui fait basculer
  text(560, 566, 'CE QUI FAIT BASCULER', 18, 700, GREY, 'letter-spacing="3"');
  d.irritants.forEach(([label, n], i) => {
    const y = 606 + i * 44;
    text(560, y + 8, label, 22, 500, INK);
    t.push(`<rect x="860" y="${y - 10}" width="${(n / 19) * 100}" height="18" rx="9" fill="${WARM}" fill-opacity="${1 - i * 0.14}"/>`);
    text(1000, y + 8, String(n), 20, 300, GREY, 'text-anchor="end"');
  });

  // Alerte en temps réel
  t.push(`<rect x="80" y="860" width="920" height="230" rx="20" fill="#FFF7F3" stroke="#F6C9B8"/>`);
  t.push(`<circle cx="118" cy="908" r="8" fill="${WARM}"/>`);
  text(138, 915, `ALERTE EN TEMPS RÉEL · ${d.alert.time}`, 18, 700, WARM, 'letter-spacing="3"');
  const words = d.alert.text.split(' ');
  let line = '';
  const rows = [];
  for (const w of words) {
    if ((line + ' ' + w).trim().length > 52 && line) { rows.push(line); line = w; } else line = (line + ' ' + w).trim();
  }
  rows.push(line);
  rows.forEach((r, i) => text(108, 968 + i * 38, r, 27, 500, INK));
  text(108, 968 + rows.length * 38 + 18, d.alert.sent, 21, 300, '#666');

  // Conclusion
  text(80, 1180, 'Ce que verrait ton équipe : qui ressent quoi, où et quand,', 26, 500, INK);
  text(80, 1220, 'pour agir le jour même plutôt qu’à J+4.', 26, 500, INK);
  text(80, 1290, 'Exemple fictif, pour illustration. Aucune donnée réelle.', 17, 300, '#AAA');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<rect width="${W}" height="${H}" fill="#FFFFFF"/>
${t.join('\n')}
</svg>`;
}

let cached = null;
export function dashboardPng() {
  cached ||= new Resvg(dashboardSvg(), { font: { fontFiles: FONTS, loadSystemFonts: false, defaultFontFamily: 'Montserrat' } }).render().asPng();
  return cached;
}
