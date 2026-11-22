// Données de DÉMONSTRATION pour le parcours "alertes remontées" (vallée de Chamonix).
// Noms de domaines et de remontées réalistes, états générés de façon déterministe par date.
// À remplacer par la source officielle de l'exploitant avant tout usage réel.
import crypto from 'node:crypto';

export const DEMO_NOTICE = '(Données de démonstration)';

export const DOMAINS = [
  { id: 'grands-montets', name: 'Grands Montets', hours: '8h30 – 16h30', lifts: ['Télécabine de Plan Joran', 'Téléphérique de Lognan', 'Télécabine de Bochard', 'Télésiège de la Herse', 'Télésiège des Marmottons', 'Téléski du Tabé'] },
  { id: 'brevent-flegere', name: 'Brévent – Flégère', hours: '8h45 – 16h45', lifts: ['Télécabine de Planpraz', 'Téléphérique du Brévent', 'Télésiège de Cornu', 'Téléphérique de la Flégère', "Télésiège de l'Index", 'Liaison Brévent-Flégère'] },
  { id: 'balme', name: 'Le Tour – Balme – Vallorcine', hours: '8h45 – 16h30', lifts: ['Télécabine de Charamillon', 'Télésiège des Autannes', 'Télésiège des Esserts', 'Télécabine de Vallorcine', 'Télésiège de Tête de Balme'] },
  { id: 'houches', name: 'Les Houches', hours: '9h00 – 16h45', lifts: ['Télécabine du Prarion', 'Téléphérique de Bellevue', 'Télésiège du Kandahar', 'Télésiège de Plancerts'] },
  { id: 'aiguille-midi', name: 'Aiguille du Midi', hours: '7h30 – 16h00', lifts: ["Téléphérique Plan de l'Aiguille", 'Téléphérique Aiguille du Midi (2e tronçon)'] },
  { id: 'montenvers', name: 'Montenvers – Mer de Glace', hours: '10h00 – 16h30', lifts: ['Train du Montenvers', 'Télécabine du Glacier'] },
];

export const FAQ = [
  'Forfaits : en vente aux caisses de chaque domaine et sur le site internet de l’exploitant. Les tarifs ne sont pas communiqués par cet assistant.',
  'Navettes : bus gratuits dans la vallée de Chamonix entre les domaines, environ toutes les 20 à 30 minutes en saison.',
  'Parking : parkings limités aux Grands Montets et au Tour, arriver avant 9h30 conseillé le week-end.',
  'Météo et vent : les remontées d’altitude (Aiguille du Midi, Lognan, Brévent) ferment en cas de vent fort, l’état peut changer dans la journée.',
  'Secours et urgences : composer le 112. Pour un objet perdu, s’adresser aux caisses du domaine.',
];

export function domainById(id) {
  return DOMAINS.find((d) => d.id === id) || null;
}

const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
export function matchDomain(text) {
  const t = norm(text);
  return DOMAINS.find((d) => t.includes(d.id) || norm(d.name).split(/[–-]/).some((part) => part.trim() && t.includes(part.trim()))) || null;
}

// Nombre pseudo-aléatoire stable pour une graine donnée (même date = mêmes conditions).
function rand(seed) {
  const h = crypto.createHash('sha256').update(seed).digest();
  return h.readUInt32BE(0) / 0xffffffff;
}

export function conditions(domainId, date) {
  const d = domainById(domainId);
  if (!d) return null;
  const sky = ['ensoleillé', 'grand beau', 'nuageux', 'chutes de neige', 'éclaircies'][Math.floor(rand(`${date}:${domainId}:sky`) * 5)];
  const wind = Math.round(10 + rand(`${date}:${domainId}:wind`) * 70);
  const reasons = ['vent fort', 'maintenance', 'enneigement insuffisant', 'sécurisation du domaine'];
  const lifts = d.lifts.map((name, i) => {
    const r = rand(`${date}:${domainId}:${i}`);
    const closed = r < 0.12 || (wind > 60 && /phérique/i.test(name) && r < 0.7);
    return { name, open: !closed, reason: closed ? (wind > 60 ? 'vent fort' : reasons[Math.floor(r * 100) % reasons.length]) : null };
  });
  return {
    domain: d.name,
    date,
    hours: d.hours,
    sky,
    wind,
    tempTop: Math.round(-14 + rand(`${date}:${domainId}:t`) * 10),
    tempBottom: Math.round(-4 + rand(`${date}:${domainId}:b`) * 8),
    snowTop: Math.round(80 + rand(`${date}:${domainId}:s`) * 150),
    freshSnow: sky === 'chutes de neige' ? Math.round(5 + rand(`${date}:${domainId}:f`) * 25) : 0,
    lifts,
  };
}

export function dateLabel(date) {
  return new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
}

export function morningText(domainId, date) {
  const c = conditions(domainId, date);
  const open = c.lifts.filter((l) => l.open).map((l) => l.name);
  const closed = c.lifts.filter((l) => !l.open).map((l) => `${l.name} (${l.reason})`);
  return [
    `Bonjour ! *${c.domain}* – ${dateLabel(date)}`,
    '',
    `Ouvert (${open.length}/${c.lifts.length}) : ${open.join(', ') || 'aucune remontée'}`,
    closed.length ? `Fermé : ${closed.join(', ')}` : 'Tout est ouvert.',
    `Horaires : ${c.hours}`,
    `Météo : ${c.sky}, vent ${c.wind} km/h, ${c.tempBottom}°C en bas / ${c.tempTop}°C au sommet`,
    `Neige : ${c.snowTop} cm au sommet${c.freshSnow ? `, ${c.freshSnow} cm de fraîche` : ''}`,
    '',
    'Une question, ou un retour sur votre journée ? Écrivez-le ici, à tout moment.',
    DEMO_NOTICE,
  ].join('\n');
}

// Contexte fourni à l'IA pour répondre aux questions : uniquement ces informations.
export function contextFor(domainId, days) {
  const blocks = [];
  for (const day of days) {
    for (const d of DOMAINS) {
      const c = conditions(d.id, day);
      blocks.push(
        `${c.domain} – ${dateLabel(day)} : horaires ${c.hours}; météo ${c.sky}, vent ${c.wind} km/h, ${c.tempBottom}/${c.tempTop}°C; neige ${c.snowTop} cm${c.freshSnow ? ` (+${c.freshSnow} cm)` : ''}; ` +
          c.lifts.map((l) => `${l.name} ${l.open ? 'ouvert' : `fermé (${l.reason})`}`).join(', '),
      );
    }
  }
  return `Domaine de l'abonné : ${domainById(domainId)?.name || 'non choisi'}\n\nÉtat des domaines :\n${blocks.join('\n')}\n\nInformations pratiques :\n- ${FAQ.join('\n- ')}`;
}
