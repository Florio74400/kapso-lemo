// Schéma personnalisé envoyé sur WhatsApp : ce que LEMO capte pendant l'expérience,
// face à ce qu'une enquête de satisfaction obtient à J+4. Rendu SVG -> PNG (police Montserrat embarquée).
import fs from 'node:fs';
import { Resvg } from '@resvg/resvg-js';

const FONTS = [300, 500, 700].map((w) => new URL(`../public/fonts/montserrat-${w}.ttf`, import.meta.url).pathname);
const logo = fs.readFileSync(new URL('../public/lemo-logo.svg', import.meta.url), 'utf8');
const logoInner = logo.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');

const xml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Découpe un texte en lignes d'environ `max` caractères.
function wrap(text, max) {
  const out = [];
  let line = '';
  for (const w of String(text || '').split(/\s+/)) {
    if ((line + ' ' + w).trim().length > max && line) {
      out.push(line);
      line = w;
    } else line = (line + ' ' + w).trim();
  }
  if (line) out.push(line);
  return out;
}
// Au plus `n` lignes, la dernière terminée par « … » si le texte est coupé.
const lines = (text, max, n = 2) => {
  const l = wrap(text, max);
  if (l.length <= n) return l;
  const cut = l.slice(0, n);
  cut[n - 1] = cut[n - 1].replace(/[\s,;:.]*$/, '') + '…';
  return cut;
};

// Nombre de signaux exploitables : émotions situées + bascule + angle mort + signaux concrets, contre 2 pour une enquête (note + commentaire).
export function signalCount(r) {
  return (r.emotions?.length || 0) + (r.key_moment ? 1 : 0) + (r.blind_spot ? 1 : 0) + (r.details?.length || 0);
}
export function richness(r) {
  return Math.max(2, Math.round(signalCount(r) / 2));
}

export function cardSvg(r, firstName) {
  const W = 1080;
  const H = 1350;
  const n = signalCount(r);
  const x = richness(r);
  let y = 0;
  const t = [];
  const text = (tx, ty, s, size, weight, color, extra = '') =>
    t.push(`<text x="${tx}" y="${ty}" font-family="Montserrat" font-size="${size}" font-weight="${weight}" fill="${color}" ${extra}>${xml(s)}</text>`);

  // En-tête
  t.push(`<svg x="80" y="72" width="140" height="46" viewBox="0 128 370 120"><g fill="#1A1A1A" color="#1A1A1A">${logoInner}</g></svg>`);
  text(1000, 104, 'EARLY ADOPTER', 20, 500, '#888', 'text-anchor="end" letter-spacing="5"');
  text(80, 210, firstName ? `${firstName}, ton moment vu par LEMO` : 'Ton moment vu par LEMO', 44, 700, '#1A1A1A');

  // Bloc LEMO
  y = 260;
  t.push(`<rect x="80" y="${y}" width="920" height="680" rx="28" fill="#F5F6FF"/>`);
  t.push(`<rect x="80" y="${y}" width="10" height="680" rx="5" fill="url(#g)"/>`);
  text(130, y + 66, 'LEMO · PENDANT L’EXPÉRIENCE', 22, 700, '#4553C7', 'letter-spacing="3"');
  let cy = y + 130;
  for (const e of (r.emotions || []).slice(0, 3)) {
    const label = `${e.emotion}`;
    const w = 48 + label.length * 18;
    t.push(`<rect x="130" y="${cy - 36}" width="${w}" height="52" rx="26" fill="#fff" stroke="#DADDFB"/>`);
    text(150, cy, label, 28, 700, '#2F3DA8');
    text(150 + w, cy, `  ${e.moment}`, 26, 300, '#555');
    cy += 70;
  }
  cy += 20;
  if (r.key_moment) {
    text(130, cy, 'Point de bascule', 22, 700, '#1A1A1A');
    for (const l of lines(r.key_moment, 52)) text(130, (cy += 40), l, 26, 300, '#333');
    cy += 56;
  }
  text(130, cy, 'Angle mort capté', 22, 700, '#E8734F');
  for (const l of lines(r.blind_spot, 52)) text(130, (cy += 40), l, 26, 300, '#333');
  text(130, y + 636, `${n} signaux exploitables`, 26, 700, '#2F3DA8');

  // Bloc enquête J+4
  y = 975;
  t.push(`<rect x="80" y="${y}" width="920" height="200" rx="28" fill="#F4F4F5"/>`);
  text(130, y + 60, 'ENQUÊTE DE SATISFACTION · J+4', 22, 700, '#888', 'letter-spacing="3"');
  text(130, y + 140, `${r.survey_score}/10`, 64, 700, '#9A9AA2');
  text(330, y + 128, `« ${r.survey_comment} »`, 30, 300, '#777');
  text(330, y + 170, '2 signaux · un effort demandé · un souvenir lissé', 22, 300, '#999');

  // Conclusion
  text(80, 1272, `×${x}`, 84, 700, 'url(#g)');
  text(240, 1240, 'plus riche qu’une enquête classique', 30, 500, '#1A1A1A');
  text(240, 1282, 'pour ajuster sur le moment ou informer les équipes', 24, 300, '#777');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4553C7"/><stop offset="1" stop-color="#E8856B"/></linearGradient></defs>
<rect width="${W}" height="${H}" fill="#FFFFFF"/>
${t.join('\n')}
</svg>`;
}

export function cardPng(r, firstName) {
  return new Resvg(cardSvg(r, firstName), { font: { fontFiles: FONTS, loadSystemFonts: false, defaultFontFamily: 'Montserrat' } }).render().asPng();
}
