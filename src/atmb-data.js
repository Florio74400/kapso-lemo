// Données de DÉMONSTRATION pour un parcours "info trafic" (tunnel et autoroutes du Mont-Blanc).
// États générés de façon déterministe par date. À remplacer par la source officielle de l'exploitant.
import crypto from 'node:crypto';
import { dateLabel, DEMO_NOTICE } from './cmb-data.js';

export const ROUTES = [
  { id: 'tunnel', label: 'Tunnel du Mont-Blanc', description: 'Chamonix – Courmayeur' },
  { id: 'a40', label: 'A40 Autoroute Blanche', description: 'Genève – Le Fayet' },
  { id: 'a41', label: 'A41 Annecy – Genève', description: 'Annecy – Saint-Julien' },
];

export const ALERT_TYPES = [
  { id: 'fermetures', label: 'Fermetures et coupures' },
  { id: 'attente', label: "Temps d'attente" },
  { id: 'travaux', label: 'Travaux' },
  { id: 'meteo', label: 'Météo et équipements' },
];

function rand(seed) {
  return crypto.createHash('sha256').update(seed).digest().readUInt32BE(0) / 0xffffffff;
}

export function traffic(routeId, date) {
  const r = (k) => rand(`${date}:${routeId}:${k}`);
  const weekend = [0, 6].includes(new Date(`${date}T12:00:00Z`).getUTCDay());
  const snow = r('snow') < 0.3;
  return {
    closure: routeId === 'tunnel' && r('close') < 0.35 ? 'Fermeture nocturne pour maintenance de 22h à 6h' : routeId !== 'tunnel' && r('close') < 0.1 ? 'Bretelle fermée cette nuit (22h – 5h)' : null,
    waitFr: routeId === 'tunnel' ? Math.round((weekend ? 20 : 5) + r('wf') * (weekend ? 50 : 20)) : null,
    waitIt: routeId === 'tunnel' ? Math.round((weekend ? 15 : 5) + r('wi') * (weekend ? 40 : 15)) : null,
    peak: weekend ? 'Trafic dense prévu entre 9h et 12h, et entre 16h et 19h' : 'Trafic fluide prévu, plus dense entre 17h et 19h',
    works: r('works') < 0.4 ? `Travaux : circulation sur une voie ${routeId === 'tunnel' ? 'aux abords de la plateforme française' : 'entre deux échangeurs'}, de 9h à 16h` : null,
    weather: snow ? 'Neige attendue en altitude : équipements spéciaux (pneus hiver ou chaînes) obligatoires' : 'Pas de difficulté météo annoncée',
  };
}

export function morningText(choices, date) {
  const route = ROUTES.find((x) => x.id === choices.route) || ROUTES[0];
  const want = new Set(choices.alerts?.length ? choices.alerts : ALERT_TYPES.map((a) => a.id));
  const t = traffic(route.id, date);
  const lines = [`Bonjour ! *${route.label}* – ${dateLabel(date)}`, ''];
  if (want.has('fermetures')) lines.push(`Fermetures : ${t.closure || 'aucune prévue'}`);
  if (want.has('attente')) lines.push(t.waitFr != null ? `Attente au tunnel : environ ${t.waitFr} min côté France, ${t.waitIt} min côté Italie. ${t.peak}` : `Trafic : ${t.peak}`);
  if (want.has('travaux')) lines.push(t.works || 'Travaux : aucun chantier gênant prévu');
  if (want.has('meteo')) lines.push(`Météo : ${t.weather}`);
  lines.push('', 'Une question, ou un retour sur votre trajet ? Écrivez-le ici, à tout moment.', DEMO_NOTICE);
  return lines.join('\n');
}

export function contextFor(choices, days) {
  const blocks = [];
  for (const day of days) {
    for (const route of ROUTES) {
      const t = traffic(route.id, day);
      blocks.push(
        `${route.label} – ${dateLabel(day)} : fermetures ${t.closure || 'aucune'}; ${t.waitFr != null ? `attente tunnel ${t.waitFr} min (France) / ${t.waitIt} min (Italie); ` : ''}${t.peak}; ${t.works || 'pas de travaux gênants'}; ${t.weather}`,
      );
    }
  }
  return `Itinéraire de l'abonné : ${ROUTES.find((x) => x.id === choices.route)?.label || 'non choisi'}\n\nÉtat du réseau :\n${blocks.join('\n')}`;
}
