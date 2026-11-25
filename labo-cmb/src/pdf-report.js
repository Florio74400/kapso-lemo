// Rapport PDF à partager en interne (COMEX, direction) : charte LEMO fixe, contenu tiré des retours.
// Demandé sur WhatsApp (« fais-moi un PDF des retours de la semaine sur les Grands Montets »),
// envoyé en document WhatsApp, prêt à transférer. Les chiffres sont calculés par le code ;
// l'IA ne fait que regrouper les retours (par numéro) et choisir des extraits, vérifiés mot pour mot.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';
import { query, one } from './db.js';
import { config, llmMode } from './config.js';
import { periodBounds } from './insights.js';
import { parisNow } from './alerts.js';
import { DOMAINS, domainById, matchDomain } from './cmb-data.js';
import { synthesizeDocument } from './llm.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.join(here, '..', 'assets');
const FONTS = { light: 'montserrat-300.ttf', regular: 'montserrat-500.ttf', bold: 'montserrat-700.ttf' };
const LOGO = fs.readFileSync(path.join(ASSETS, 'lemo-mark.svg'), 'utf8').match(/ d="([^"]+)"/)[1];
const LOGO_W = 864; // largeur du viewBox du logo

const BANNER = path.join(ASSETS, 'cmb-banner.jpg'); // photo + logo Mont-Blanc Natural Resort (sans texte)

// Charte du rapport (reprise du rapport satisfaction CMB) : fond cassé, cartes blanches, bleu nuit,
// vert pour le positif, rouge pour le négatif. Une seule page A4 paysage, gabarit fixe.
const C = { bg: '#FAFAF8', card: '#FFFFFF', border: '#ECECE8', dark: '#121317', navy: '#122C47', title: '#1B2A41', text: '#2B2F36', muted: '#8A8F98', track: '#EDEDED', quote: '#F4F4F1', pos: '#568E75', neg: '#B5443A', neutral: '#C9CCD1', warn: '#C9822B', bannerFill: '#1B2430' };
const PAGE = { w: 841.89, h: 595.28, m: 28 };

export const DOCUMENT_RE = /\bpdf\b|\bdocument\b|\bfichier\b|(?<!par )\brapport\b/i;
const MAX_ITEMS = 300;

// Domaine cité dans la demande, y compris les noms d'usage et les erreurs de dictée vocale.
const ALIASES = [
  [/grands?[\s-]*mont(e|a)n?t?s?|argenti[eè]re|lognan|plan joran|bochard|la herse/i, 'grands-montets'],
  [/fl[eé]g[eè]re|br[eé]vent|planpraz|cornu|l'index/i, 'brevent-flegere'],
  [/aiguille|plan de l'aiguille/i, 'aiguille-midi'],
  [/montenvers|mer de glace|train du/i, 'montenvers'],
  [/houches|bellevue|prarion|kandahar/i, 'houches'],
  [/balme|le tour|vallorcine|charamillon/i, 'balme'],
];
export function detectDomain(text) {
  for (const [re, id] of ALIASES) if (re.test(text || '')) return id;
  return matchDomain(text)?.id || null;
}

const parse = (v) => (typeof v === 'string' ? JSON.parse(v) : v || {});
const parisDate = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date(d));
const shortDate = (d) => new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit' }).format(new Date(d));
const hourLabel = (d) => new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' }).format(new Date(d)).replace(':', 'h');
const longDate = (iso) => new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T12:00:00Z`));
const flat = (x) => x.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[«»"“”'’]/g, '').replace(/\s+/g, ' ').trim();
// « du 19 au 25 novembre 2026 », « du 28 novembre au 4 décembre 2026 »
function periodText({ first, last }) {
  if (first === last) return `le ${longDate(first)}`;
  const [y1, m1] = first.split('-');
  const [y2, m2] = last.split('-');
  const day = (iso, opts) => new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', ...opts }).format(new Date(`${iso}T12:00:00Z`));
  if (y1 === y2 && m1 === m2) return `du ${day(first, { day: 'numeric' })} au ${longDate(last)}`;
  if (y1 === y2) return `du ${day(first, { day: 'numeric', month: 'long' })} au ${longDate(last)}`;
  return `du ${longDate(first)} au ${longDate(last)}`;
}
const pct = (a, n) => (n ? Math.round((a / n) * 100) : 0);

// ---------------- Données ----------------
async function loadFeedbacks(companyId, period, domain) {
  const b = periodBounds(period);
  const rows = await query(
    `select f.created_at, f.sentiment, f.urgency, f.analysis, f.verbatim, f.simulated, c.title,
            coalesce(sub.domain, sub.choices->>'domain') as domain
     from feedbacks f
     join collections c on c.id = f.collection_id
     join sessions s on s.id = f.session_id
     left join lateral (
       select x.choices, x.domain from subscriptions x where x.phone_hash = s.phone_hash and x.collection_id = f.collection_id order by x.created_at desc limit 1
     ) sub on true
     where c.company_id = $1 and f.created_at >= $2 and f.created_at < $3 and f.created_at <= now()
     order by f.created_at asc limit ${MAX_ITEMS}`,
    [companyId, b.from, b.to],
  );
  const items = rows
    .filter((r) => !domain || r.domain === domain)
    .map((r, i) => ({ ...r, n: i + 1, analysis: parse(r.analysis), place: domainById(r.domain)?.name || r.title }));
  return { bounds: b, items };
}

function periodRange(bounds, items) {
  const today = parisNow().date;
  const first = bounds.from.getTime() > 0 ? parisDate(bounds.from) : items.length ? parisDate(items[0].created_at) : today;
  const lastBound = parisDate(new Date(bounds.to.getTime() - 1));
  return { first, last: lastBound > today ? today : lastBound };
}

function dailySeries(range, items) {
  const days = [];
  for (let d = new Date(`${range.first}T12:00:00Z`); days.length < 31; d = new Date(d.getTime() + 86400000)) {
    const iso = d.toISOString().slice(0, 10);
    if (iso > range.last) break;
    days.push({ iso, pos: 0, neg: 0, other: 0 });
  }
  const byIso = new Map(days.map((d) => [d.iso, d]));
  for (const f of items) {
    const d = byIso.get(parisDate(f.created_at));
    if (!d) continue;
    if (f.sentiment === 'positive') d.pos++;
    else if (f.sentiment === 'negative') d.neg++;
    else d.other++;
  }
  return days;
}

// Repli sans IA : regroupement par sujet, extraits = premières phrases (exactes par construction).
function simulatedSynthesis(items, scope, canQuote) {
  const group = (tone) => {
    const m = new Map();
    for (const f of items.filter((x) => x.sentiment === tone)) {
      const t = (f.analysis.topics || [])[0];
      if (t) m.set(t, [...(m.get(t) || []), f.n]);
    }
    return [...m.entries()].map(([label, ids]) => ({ label: label.charAt(0).toUpperCase() + label.slice(1), ids }));
  };
  const neg = items.filter((f) => f.sentiment === 'negative');
  const pos = items.filter((f) => f.sentiment === 'positive');
  const first = (f) => ({ id: f.n, text: (f.verbatim.match(/[^.!?]+[.!?]/g) || [f.verbatim]).map((x) => x.trim()).sort((a, b) => b.length - a.length)[0] });
  return {
    headline: `${items.length} retours clients analysés ${scope}.`,
    summary: `${pct(pos.length, items.length)} % des retours sont positifs et ${pct(neg.length, items.length)} % négatifs. Synthèse simulée (pas de clé Claude configurée) : regroupement par sujet uniquement.`,
    irritants: group('negative'),
    positives: group('positive'),
    quotes: canQuote ? [...neg.slice(-2), ...pos.slice(-1)].map(first) : [],
  };
}

// Les thèmes de l'IA ne gardent que des numéros de retours existants ; les comptes viennent de là.
function cleanThemes(themes, items, max) {
  const valid = new Set(items.map((f) => f.n));
  return (themes || [])
    .map((t) => ({ label: t.label, count: new Set((t.ids || []).filter((id) => valid.has(id))).size }))
    .filter((t) => t.label && t.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, max);
}

function cleanQuotes(quotes, items) {
  const byN = new Map(items.map((f) => [f.n, f]));
  const seen = new Set();
  const out = [];
  for (const q of quotes || []) {
    const f = byN.get(q.id);
    if (!f || !q.text || seen.has(q.id) || !flat(f.verbatim).includes(flat(q.text))) continue;
    seen.add(q.id);
    out.push({ text: q.text.trim().replace(/^["«\s]+|["»\s]+$/g, ''), where: `${f.place}, ${shortDate(f.created_at)} ${hourLabel(f.created_at)}`, tone: f.sentiment });
  }
  return out.slice(0, 4);
}

export async function buildDocument({ company, period = '7d', domain = null }) {
  const { bounds, items } = await loadFeedbacks(company.id, period, domain);
  const place = domain ? domainById(domain)?.name : 'Tous domaines';
  const range = periodRange(bounds, items);
  const scope = `${domain ? `sur ${place} ` : ''}${bounds.label}`;
  if (!items.length) return { empty: true, scope };

  const canQuote = items.length >= company.privacy_threshold;
  let s;
  if (llmMode() === 'simulated') s = simulatedSynthesis(items, scope, canQuote);
  else {
    const lines = items.map((f) => {
      const a = f.analysis;
      return `#${f.n} | ${shortDate(f.created_at)} ${hourLabel(f.created_at)} | ${f.place} | ton ${f.sentiment}, urgence ${f.urgency} | irritants : ${(a.irritants || []).join(' ; ') || '-'} | positifs : ${(a.positives || []).join(' ; ') || '-'} | verbatim : "${f.verbatim}"`;
    });
    s = await synthesizeDocument({ company: company.name, scope, data: lines.join('\n'), canQuote, threshold: company.privacy_threshold });
  }

  const pos = items.filter((f) => f.sentiment === 'positive').length;
  const neg = items.filter((f) => f.sentiment === 'negative').length;
  const signals = items
    .filter((f) => f.urgency === 'high' || f.urgency === 'medium')
    .sort((a, b) => (a.urgency === b.urgency ? b.created_at - a.created_at : a.urgency === 'high' ? -1 : 1));
  const data = {
    company: company.name,
    place,
    range,
    periodText: periodText(range),
    highCount: signals.filter((f) => f.urgency === 'high').length,
    n: items.length,
    pos,
    neg,
    other: items.length - pos - neg,
    signals: signals.slice(0, 3).map((f) => ({ urgency: f.urgency, when: `${shortDate(f.created_at)} ${hourLabel(f.created_at)}`, place: f.place, text: f.analysis.summary || f.verbatim.slice(0, 180) })),
    signalCount: signals.length,
    days: dailySeries(range, items),
    headline: s.headline,
    summary: s.summary,
    irritants: cleanThemes(s.irritants, items, 4),
    positives: cleanThemes(s.positives, items, 4),
    quotes: canQuote ? cleanQuotes(s.quotes, items) : [],
    canQuote,
    threshold: company.privacy_threshold,
    simulated: items.some((f) => f.simulated),
    generatedAt: new Date(),
  };
  const buffer = await renderPdf(data);
  const slug = (place || 'retours').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return { empty: false, scope, data, buffer, filename: `LEMO_${slug}_${range.first}_${range.last}.pdf` };
}

// Stockage : lien non devinable, valable 30 jours (purge dans jobs.js).
export async function storeDocument(companyId, filename, buffer) {
  const token = crypto.randomBytes(24).toString('hex');
  await query('insert into documents (token, company_id, filename, body) values ($1,$2,$3,$4)', [token, companyId, filename, buffer]);
  return { token, url: `${config.publicUrl}/d/${token}` };
}

export async function getDocument(token) {
  if (!/^[a-f0-9]{48}$/.test(token || '')) return null;
  return one(`select filename, body from documents where token=$1 and created_at > now() - interval '30 days'`, [token]);
}

// ---------------- Mise en page (gabarit fixe, une page A4 paysage) ----------------
export function renderPdf(d) {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 0, info: { Title: `Retours clients ${d.place}`, Author: 'LEMO' } });
  for (const [name, file] of Object.entries(FONTS)) doc.registerFont(name, path.join(ASSETS, 'fonts', file));
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  const { w: W, h: H, m: M } = PAGE;
  const LW = 452; // colonne gauche
  const RX = M + LW + 14;
  const RW = W - M - RX;
  const card = (x, y, w, h) => doc.roundedRect(x, y, w, h, 10).fillAndStroke(C.card, C.border);
  const label = (txt, x, y, color = C.title) => doc.font('bold').fontSize(7.5).fillColor(color).text(txt.toUpperCase(), x, y, { characterSpacing: 1.3, lineBreak: false });
  const clip = (txt, x, y, w, h, font, size, color, extra = {}) =>
    doc.font(font).fontSize(size).fillColor(color).text(txt || '', x, y, { width: w, height: h, ellipsis: true, lineGap: 1.5, ...extra });
  const logoLemo = (x, y, w, color) => doc.save().translate(x, y).scale(w / LOGO_W).path(LOGO).fill(color).restore();

  doc.rect(0, 0, W, H).fill(C.bg);

  // --- Bandeau photo + logo CMB, texte à droite
  const BH = 100;
  if (fs.existsSync(BANNER)) {
    const iw = BH * (1570 / 274);
    doc.rect(0, 0, W, BH).fill(C.bannerFill);
    doc.image(BANNER, 0, 0, { height: BH, width: iw });
    const g = doc.linearGradient(iw - 260, 0, iw - 4, 0);
    g.stop(0, C.bannerFill, 0).stop(1, C.bannerFill, 1);
    doc.rect(iw - 260, 0, 260, BH).fill(g);
    doc.rect(iw - 6, 0, W - iw + 6, BH).fill(C.bannerFill);
  } else {
    doc.rect(0, 0, W, BH).fill(C.navy);
    logoLemo(M + 8, 36, 90, '#FFFFFF');
  }
  const TX = W - 36 - 420;
  doc.font('bold').fontSize(7.5).fillColor('#E6E9EE').text('RETOURS CLIENTS · ANALYSE LEMO', TX, 22, { width: 420, align: 'right', characterSpacing: 1.5 });
  doc.font('bold').fontSize(12).fillColor('#FFFFFF').text(d.periodText.charAt(0).toUpperCase() + d.periodText.slice(1), TX, 37, { width: 420, align: 'right' });
  doc.font('bold').fontSize(20).fillColor('#FFFFFF').text(d.place.toUpperCase(), TX, 52, { width: 420, align: 'right', height: 26, ellipsis: true });
  doc.font('light').fontSize(8).fillColor('#D5DAE1').text('Diffusion interne · Comité de direction', TX, 79, { width: 420, align: 'right' });

  // --- Chiffres clés
  const TY = BH + 14;
  const TH = 64;
  const tw = (LW - 24) / 4;
  const tiles = [
    ['Retours analysés', String(d.n), 'recueillis sur WhatsApp', null],
    ['Positifs', `${pct(d.pos, d.n)} %`, `${d.pos} retour${d.pos > 1 ? 's' : ''}`, C.pos],
    ['Négatifs', `${pct(d.neg, d.n)} %`, `${d.neg} retour${d.neg > 1 ? 's' : ''}`, C.neg],
    ['Signaux à traiter', String(d.signalCount), d.signalCount ? `dont ${d.highCount} urgent${d.highCount > 1 ? 's' : ''}` : 'aucun sur la période', d.signalCount ? C.warn : null],
  ];
  tiles.forEach(([lab, value, sub, color], i) => {
    const x = M + i * (tw + 8);
    if (i === 0) doc.roundedRect(x, TY, tw, TH, 10).fill(C.dark);
    else card(x, TY, tw, TH);
    const fg = i === 0 ? '#FFFFFF' : C.title;
    doc.font('regular').fontSize(7.5).fillColor(i === 0 ? '#C9CDD4' : C.muted).text(lab, x + 12, TY + 11, { width: tw - 20, lineBreak: false });
    doc.font('bold').fontSize(20).fillColor(fg).text(value, x + 12, TY + 23, { width: tw - 20, lineBreak: false });
    doc.font('regular').fontSize(6.5).fillColor(color || (i === 0 ? '#C9CDD4' : C.muted)).text(sub, x + 12, TY + 48, { width: tw - 20, lineBreak: false });
  });

  // --- L'essentiel
  let y = TY + TH + 10;
  card(M, y, LW, 112);
  label("L'essentiel", M + 14, y + 13);
  clip(d.headline, M + 14, y + 28, LW - 28, 26, 'bold', 10, C.title);
  const sy = Math.max(doc.y + 4, y + 44);
  clip(d.summary, M + 14, sy, LW - 28, y + 104 - sy, 'light', 8.2, C.text);

  // --- Ce qui irrite / ce qui plaît
  y += 122;
  card(M, y, LW, 120);
  const half = (LW - 28 - 18) / 2;
  const themes = (title, list, color, x) => {
    label(title, x, y + 13);
    if (!list.length) return clip('Rien de notable sur la période.', x, y + 32, half, 12, 'light', 8, C.muted);
    const max = Math.max(...list.map((t) => t.count));
    list.slice(0, 4).forEach((t, i) => {
      const ry = y + 31 + i * 21;
      clip(t.label, x, ry, half - 28, 11, 'regular', 8, C.text, { lineBreak: false });
      doc.font('bold').fontSize(8).fillColor(color).text(String(t.count), x + half - 24, ry, { width: 24, align: 'right', lineBreak: false });
      doc.roundedRect(x, ry + 12, half, 3, 1.5).fill(C.track);
      doc.roundedRect(x, ry + 12, Math.max(4, (t.count / max) * half), 3, 1.5).fill(color);
    });
  };
  themes('Ce qui irrite', d.irritants, C.neg, M + 14);
  themes('Ce qui plaît', d.positives, C.pos, M + 14 + half + 18);
  doc.font('light').fontSize(6.5).fillColor(C.muted).text('Nombre de retours concernés', M + 14, y + 120 - 12, { width: LW - 28, align: 'right', lineBreak: false });

  // --- Jour par jour
  y += 130;
  const CH = H - 36 - y;
  card(M, y, LW, CH);
  label('Jour par jour', M + 14, y + 13);
  const legend = [['Positifs', C.pos], ['Neutres', C.neutral], ['Négatifs', C.neg]];
  let lx = M + LW - 14 - 150;
  for (const [t, color] of legend) {
    doc.rect(lx, y + 14, 6, 6).fill(color);
    doc.font('regular').fontSize(6.5).fillColor(C.muted).text(t, lx + 9, y + 13.5, { lineBreak: false });
    lx += 50;
  }
  const top = y + 32;
  const chartH = CH - 32 - 22;
  const days = d.days;
  if (days.length) {
    const max = Math.max(1, ...days.map((x) => x.pos + x.neg + x.other));
    const step = (LW - 28) / days.length;
    const bw = Math.min(26, step * 0.6);
    const every = Math.ceil(days.length / 12);
    days.forEach((x, i) => {
      const cx = M + 14 + i * step + (step - bw) / 2;
      let by = top + chartH;
      for (const [v, color] of [[x.pos, C.pos], [x.other, C.neutral], [x.neg, C.neg]]) {
        const h = (v / max) * chartH;
        if (h > 0) doc.rect(cx, by - h, bw, h).fill(color);
        by -= h;
      }
      if (i % every === 0) doc.font('regular').fontSize(6.5).fillColor(C.muted).text(shortDate(`${x.iso}T12:00:00Z`), M + 14 + i * step, top + chartH + 5, { width: step, align: 'center', lineBreak: false });
    });
    doc.moveTo(M + 14, top + chartH).lineTo(M + LW - 14, top + chartH).lineWidth(0.5).strokeColor(C.border).stroke();
  }

  // --- Ce que disent les clients
  const QY = TY;
  const QH = 292;
  card(RX, QY, RW, QH);
  label('Ce que disent les clients', RX + 14, QY + 13);
  if (d.quotes.length) {
    const boxH = Math.min(62, (QH - 36 - 8) / d.quotes.length - 6);
    d.quotes.forEach((q, i) => {
      const by = QY + 32 + i * (boxH + 6);
      doc.roundedRect(RX + 12, by, RW - 24, boxH, 8).fill(C.quote);
      clip(`« ${q.text} »`, RX + 22, by + 8, RW - 44, boxH - 24, 'regular', 8.3, C.text);
      const tone = q.tone === 'negative' ? ['Négatif', C.neg] : q.tone === 'positive' ? ['Positif', C.pos] : ['Neutre', C.muted];
      doc.font('bold').fontSize(6.8).fillColor(tone[1]).text(tone[0], RX + 22, by + boxH - 13, { continued: true, lineBreak: false })
        .font('regular').fillColor(C.muted).text(` · ${q.where}`, { lineBreak: false });
    });
  } else {
    clip(d.canQuote ? 'Aucun extrait retenu.' : `Moins de ${d.threshold} retours sur ce périmètre : par confidentialité, aucun verbatim n'est cité.`, RX + 14, QY + 34, RW - 28, 40, 'light', 8.3, C.muted);
  }

  // --- Points d'attention (signaux)
  const SY = QY + QH + 10;
  const SH = H - 36 - SY;
  card(RX, SY, RW, SH);
  label(`Points d'attention${d.signalCount ? ` (${d.signalCount})` : ''}`, RX + 14, SY + 13);
  if (d.signals.length) {
    const rowH = (SH - 34) / 3;
    d.signals.forEach((s, i) => {
      const ry = SY + 32 + i * rowH;
      doc.circle(RX + 21, ry + 6, 7).fill(C.title);
      doc.font('bold').fontSize(7.5).fillColor('#FFFFFF').text(String(i + 1), RX + 14, ry + 2.5, { width: 14, align: 'center', lineBreak: false });
      const color = s.urgency === 'high' ? C.neg : C.warn;
      doc.font('bold').fontSize(6.8).fillColor(color).text(s.urgency === 'high' ? 'Urgent' : 'À suivre', RX + 36, ry + 1, { continued: true, lineBreak: false })
        .font('regular').fillColor(C.muted).text(` · ${s.place} · ${s.when}`, { lineBreak: false });
      clip(s.text, RX + 36, ry + 11, RW - 50, rowH - 14, 'regular', 7.8, C.text);
    });
  } else {
    clip('Aucun signal urgent sur la période.', RX + 14, SY + 34, RW - 28, 14, 'light', 8.3, C.muted);
  }

  // --- Pied de page
  const stamp = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d.generatedAt).replace(' ', ' à ').replace(':', 'h');
  const FY = H - 24;
  doc.font('regular').fontSize(6.8).fillColor(C.muted).text(`Données : ${d.n} retour${d.n > 1 ? 's' : ''} clients recueillis sur WhatsApp et analysés par LEMO · constats, sans recommandation`, M, FY, { lineBreak: false });
  if (d.simulated) doc.font('bold').fontSize(6.8).fillColor(C.neg).text('Données simulées à des fins de démonstration', M, FY + 9, { lineBreak: false });
  const right = `${d.company} · généré le ${stamp} · propulsé par`;
  doc.font('regular').fontSize(6.8);
  const rw = doc.widthOfString(right);
  doc.fillColor(C.muted).text(right, W - M - 36 - rw, FY, { lineBreak: false });
  logoLemo(W - M - 32, FY - 0.5, 32, C.title);

  doc.end();
  return done;
}

export { DOMAINS };
