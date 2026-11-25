// Schéma personnalisé envoyé sur WhatsApp : la courbe de l'oubli.
// En haut, à chaud, ce que LEMO a capté du moment ; en bas, à J+4, ce qu'il reste dans une enquête de satisfaction.
// Charte LEMO (blanc, encre, bleu #6B7CFF, corail #E8856B, Montserrat). Rendu SVG -> PNG.
import fs from 'node:fs';
import { Resvg } from '@resvg/resvg-js';

const FONTS = [300, 500, 700].map((w) => new URL(`../public/fonts/montserrat-${w}.ttf`, import.meta.url).pathname);
const mark = fs.readFileSync(new URL('../public/lemo-mark.svg', import.meta.url), 'utf8').replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');

const INK = '#1A1A1A';
const GREY = '#888888';
const LINE = '#E4E4EA';
const ACCENT = '#6B7CFF';
const DEEP = '#2F3DA8';
const WARM = '#E8856B';

const xml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Découpe un texte en lignes d'environ `max` caractères ; au plus `n` lignes, la dernière terminée par « … » si coupé.
function lines(text, max, n = 2) {
  const out = [];
  let line = '';
  for (const w of String(text || '').split(/\s+/)) {
    if ((line + ' ' + w).trim().length > max && line) {
      out.push(line);
      line = w;
    } else line = (line + ' ' + w).trim();
  }
  if (line) out.push(line);
  if (out.length <= n) return out;
  const cut = out.slice(0, n);
  cut[n - 1] = cut[n - 1].replace(/[\s,;:.]*$/, '') + '…';
  return cut;
}

// Courbe de l'oubli (forme d'après Ebbinghaus, 1885 : part du souvenir encore là) : chute rapide puis plateau.
// Illustration, pas une mesure.
const recall = (u) => 0.22 + 0.78 * Math.pow(1 + u / 0.025, -0.55);
const TICKS = [['À chaud', 0], ['1 h', 0.16], ['24 h', 0.5], ['J+4', 0.88]];

export function cardSvg(r, firstName) {
  const W = 1080;
  const H = 1350;
  const t = [];
  const text = (x, y, s, size, weight, color, extra = '') =>
    t.push(`<text x="${x}" y="${y}" font-family="Montserrat" font-size="${size}" font-weight="${weight}" fill="${color}" ${extra}>${xml(s)}</text>`);

  // En-tête
  t.push(`<svg x="80" y="76" width="112" height="36" viewBox="0 0 864 278"><g fill="${INK}">${mark}</g></svg>`);
  text(1000, 102, firstName ? `TON MOMENT · ${firstName.toUpperCase()}` : 'TON MOMENT', 18, 500, GREY, 'text-anchor="end" letter-spacing="4"');
  text(80, 206, 'À chaud, LEMO capte le vécu.', 40, 700, INK);
  text(80, 258, 'À J+4, il reste une note.', 40, 700, '#9A9AA2');

  // Repère du graphique
  const x0 = 110, x1 = 1000, yTop = 660, yBot = 1090;
  const X = (u) => x0 + u * (x1 - x0);
  const Y = (v) => yBot - v * (yBot - yTop);
  t.push(`<rect x="${x0}" y="${yTop - 20}" width="${X(0.16) - x0}" height="${yBot - yTop + 20}" fill="${ACCENT}" fill-opacity="0.08"/>`);
  t.push(`<line x1="${X(0.16)}" y1="${yTop - 20}" x2="${X(0.16)}" y2="${yBot}" stroke="${ACCENT}" stroke-width="2" stroke-dasharray="6 6"/>`);
  t.push(`<line x1="${x0}" y1="${yBot}" x2="${x1}" y2="${yBot}" stroke="${INK}" stroke-width="2"/>`);
  for (const [label, u] of TICKS) text(X(u), yBot + 42, label, 22, 500, GREY, `text-anchor="${u === 0 ? 'start' : 'middle'}"`);

  // La courbe, du bleu LEMO au corail
  const d = Array.from({ length: 121 }, (_, i) => i / 120).map((u, i) => `${i ? 'L' : 'M'}${X(u).toFixed(1)},${Y(recall(u)).toFixed(1)}`).join(' ');
  t.push(`<path d="${d}" fill="none" stroke="url(#curve)" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`);

  // Point LEMO, à chaud, et ce qui a été capté
  const lx = X(0), ly = Y(recall(0));
  const items = (r.chart_points?.length ? r.chart_points : (r.lemo_lines || []).map((l) => `${l.label} : ${l.text}`)).slice(0, 3);
  const rows = items.flatMap((s, i) => lines(s, 50, 2).map((l, j) => ({ l, first: j === 0, i })));
  const boxY = 320, boxH = 92 + rows.length * 36 + (items.length - 1) * 10;
  t.push(`<rect x="80" y="${boxY}" width="920" height="${boxH}" rx="20" fill="#F5F6FF" stroke="#DADDFB"/>`);
  text(112, boxY + 52, 'VU PAR LEMO · À CHAUD', 20, 700, ACCENT, 'letter-spacing="3"');
  let ry = boxY + 96;
  let prev = 0;
  for (const row of rows) {
    if (row.first && row.i !== prev) ry += 10;
    prev = row.i;
    if (row.first) t.push(`<circle cx="120" cy="${ry - 8}" r="5" fill="${row.i === 2 ? WARM : ACCENT}"/>`);
    const m = row.first ? row.l.match(/^([^:]{1,20}) : (.*)$/) : null;
    if (m) t.push(`<text x="140" y="${ry}" font-family="Montserrat" font-size="25" fill="${INK}"><tspan font-weight="700">${xml(m[1])} :</tspan><tspan font-weight="300"> ${xml(m[2])}</tspan></text>`);
    else text(row.first ? 140 : 140, ry, row.l, 25, 300, INK);
    ry += 36;
  }
  t.push(`<line x1="${lx}" y1="${boxY + boxH}" x2="${lx}" y2="${ly - 14}" stroke="${ACCENT}" stroke-width="2"/>`);
  t.push(`<circle cx="${lx}" cy="${ly}" r="12" fill="#fff" stroke="${ACCENT}" stroke-width="5"/>`);
  text(X(0.16) + 14, yTop + 2, 'Fenêtre LEMO', 20, 700, ACCENT);

  // Point enquête à J+4
  const sx = X(0.88), sy = Y(recall(0.88));
  t.push(`<circle cx="${sx}" cy="${sy}" r="11" fill="${WARM}"/>`);
  const cw = 420, cx = 1000 - cw, cy = sy - 210;
  t.push(`<rect x="${cx}" y="${cy}" width="${cw}" height="150" rx="16" fill="#F4F4F5"/>`);
  text(cx + 28, cy + 44, 'ENQUÊTE · J+4', 18, 700, GREY, 'letter-spacing="3"');
  text(cx + 28, cy + 104, `${r.survey_score ?? 7}/10`, 50, 700, '#9A9AA2');
  const comment = lines(`« ${String(r.survey_comment || 'Bien, rien à signaler.').replace(/^[«"\s]+|[»"\s]+$/g, '')} »`, 20, 2);
  comment.forEach((l, i) => text(cx + 170, cy + 86 + i * 30, l, 22, 300, '#666'));
  t.push(`<line x1="${sx}" y1="${cy + 150}" x2="${sx}" y2="${sy - 14}" stroke="#C8C8D0" stroke-width="2"/>`);

  // Conclusion
  text(80, 1200, 'Les enquêtes arrivent après l’oubli : trop tard pour décider.', 26, 500, INK);
  text(80, 1240, 'LEMO capte le vécu à chaud, quand on peut encore agir.', 26, 300, '#555');
  text(80, 1300, 'Courbe de l’oubli, d’après Ebbinghaus (1885). Illustration.', 17, 300, '#AAA');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs><linearGradient id="curve" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${DEEP}"/><stop offset="0.35" stop-color="${ACCENT}"/><stop offset="1" stop-color="${WARM}"/></linearGradient></defs>
<rect width="${W}" height="${H}" fill="#FFFFFF"/>
${t.join('\n')}
</svg>`;
}

export function cardPng(r, firstName) {
  return new Resvg(cardSvg(r, firstName), { font: { fontFiles: FONTS, loadSystemFonts: false, defaultFontFamily: 'Montserrat' } }).render().asPng();
}
