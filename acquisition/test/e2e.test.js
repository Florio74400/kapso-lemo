// Test de bout en bout : webhooks signés Kapso -> conversation -> analyse -> CRM -> bilan.
// Tourne sans aucun compte : base en mémoire, WhatsApp et IA simulés.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.LOCAL_DB_PATH = 'memory://';
process.env.KAPSO_WEBHOOK_SECRET = 'test-secret-0123456789abcdef0123456789';
process.env.APP_SECRET = 'test-app-secret-0123456789abcdef0123456789';
process.env.DEMO_MODE = 'true';
process.env.ONBOARDING_PAUSE_MS = '0';
delete process.env.KAPSO_API_KEY;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.DATABASE_URL;

const { initDb, query, one, closeDb } = await import('../src/db.js');
const { createApp, receiveWebhook, fakeInbound, hashPassword } = await import('../src/server.js');
const { sign } = await import('../src/kapso.js');
const { phoneHash, drainQueues } = await import('../src/conversation.js');
const { runMaintenance } = await import('../src/jobs.js');
const { config } = await import('../src/config.js');

const OWNER = '33611111111';
let server;
let base;
let company;

async function deliver(payload, { key = crypto.randomUUID(), event = 'whatsapp.message.received' } = {}) {
  const body = Buffer.from(JSON.stringify(payload));
  const r = await receiveWebhook(body, { 'x-webhook-signature': sign(body), 'x-webhook-event': event, 'x-idempotency-key': key });
  await r.done;
  await drainQueues();
  return r;
}
const say = (phone, text, opts = {}) => deliver(fakeInbound({ phone, text, ...opts }));
const lastOut = async (phone) => (await one(`select body from messages where phone_hash=$1 and direction='out' order by seq desc limit 1`, [phoneHash(phone)]))?.body;

before(async () => {
  await initDb();
  company = await one(
    `insert into companies (name, admin_email, admin_password_hash, owner_phones) values ('Hôtel Test','a@test.fr',$1,$2) returning *`,
    [hashPassword('motdepasse-test'), [OWNER]],
  );
  await query(`insert into companies (name, admin_email, admin_password_hash) values ('Autre','b@test.fr',$1)`, [hashPassword('motdepasse-autre')]);
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server.close();
  await closeDb();
});

test('webhook : signature invalide refusée, valide acceptée', async () => {
  const body = JSON.stringify(fakeInbound({ phone: '33699999999', text: 'hello' }));
  let r = await fetch(`${base}/webhooks/kapso`, { method: 'POST', body, headers: { 'Content-Type': 'application/json', 'X-Webhook-Signature': 'a'.repeat(64) } });
  assert.equal(r.status, 401);
  r = await fetch(`${base}/webhooks/kapso`, { method: 'POST', body, headers: { 'Content-Type': 'application/json', 'X-Webhook-Signature': sign(Buffer.from(body)), 'X-Webhook-Event': 'whatsapp.message.received', 'X-Idempotency-Key': 'k-sig' } });
  assert.equal(r.status, 200);
});

let collection;
test('dirigeant : création de collecte par WhatsApp', async () => {
  await say(OWNER, 'Je veux savoir ce que mes clients ont pensé de leur séjour.');
  collection = await one('select * from collections where company_id=$1', [company.id]);
  assert.ok(collection, 'collecte créée');
  assert.match(collection.code, /^LEMO-[A-Z0-9]{4}$/);
  const out = await lastOut(OWNER);
  assert.ok(out.includes(`https://wa.me/`) && out.includes(collection.code), 'lien wa.me renvoyé');
});

test('client : parcours complet texte + relance + vocal', async () => {
  const P = '33622222222';
  await say(P, `Bonjour, je souhaite donner mon avis (${collection.code})`);
  assert.match(await lastOut(P), /assistant de \*Hôtel Test\*.*Acceptez-vous/s);
  await deliver(fakeInbound({ phone: P, text: "Oui, j'accepte", buttonId: 'consent_yes' }));
  assert.match(await lastOut(P), new RegExp(collection.question.slice(0, 20)));
  await say(P, 'Plutôt bien');
  const s1 = await one('select * from sessions where phone_hash=$1', [phoneHash(P)]);
  assert.equal(s1.state, 'awaiting_followup');
  await say(P, "L'accueil était super mais la chambre était bruyante et le petit-déjeuner décevant, il faudrait plus de choix.", { audio: true });
  assert.match(await lastOut(P), /Merci beaucoup/);
  const s2 = await one('select * from sessions where id=$1', [s1.id]);
  assert.equal(s2.state, 'done');
  assert.equal(s2.phone, null, 'numéro effacé après la conversation');
  const f = await one('select * from feedbacks where session_id=$1', [s1.id]);
  assert.ok(f.verbatim.includes('Plutôt bien') && f.verbatim.includes('bruyante'));
  assert.ok(f.transcript.includes('bruyante'), 'transcription conservée');
  const a = typeof f.analysis === 'string' ? JSON.parse(f.analysis) : f.analysis;
  for (const k of ['summary', 'emotion', 'tone', 'topics', 'positives', 'irritants', 'suggestions', 'urgency']) assert.ok(k in a, k);
});

test('anti-doublon : même clé webhook et même message WhatsApp traités une seule fois', async () => {
  const P = '33633333333';
  const payload = fakeInbound({ phone: P, text: `Avis (${collection.code})` });
  await deliver(payload, { key: 'same-key' });
  const r = await deliver(payload, { key: 'same-key' });
  assert.equal(r.duplicate, true);
  await deliver(payload, { key: 'other-key' }); // Meta peut renvoyer le même message avec une autre livraison
  const n = await one(`select count(*)::int as n from messages where phone_hash=$1 and direction='in'`, [phoneHash(P)]);
  assert.equal(n.n, 1);
  const sessions = await one(`select count(*)::int as n from sessions where phone_hash=$1`, [phoneHash(P)]);
  assert.equal(sessions.n, 1);
});

test('messages sortants ignorés (jamais confondus avec des réponses client)', async () => {
  const p = fakeInbound({ phone: '33644444444', text: 'echo' });
  p.message.kapso.direction = 'outbound';
  await deliver(p, { event: 'whatsapp.message.received' });
  const n = await one(`select count(*)::int as n from messages where phone_hash=$1`, [phoneHash('33644444444')]);
  assert.equal(n.n, 0);
});

test('clients simultanés sur le même lien : réponses séparées', async () => {
  const phones = ['33650000001', '33650000002', '33650000003', '33650000004'];
  const step = (fn) => Promise.all(phones.map(fn));
  await step((p) => say(p, `Bonjour (${collection.code})`));
  await step((p) => say(p, 'oui'));
  await step((p, i) => say(p, `Séjour numéro ${i} : le personnel était très accueillant et la chambre propre, mais le parking était trop cher pour nous cette fois-ci.`));
  for (const [i, p] of phones.entries()) {
    const f = await one(`select f.verbatim from feedbacks f join sessions s on s.id=f.session_id where s.phone_hash=$1`, [phoneHash(p)]);
    assert.ok(f, `retour du client ${i}`);
    assert.ok(f.verbatim.includes(`numéro ${i}`) && !phones.some((_, j) => j !== i && f.verbatim.includes(`numéro ${j}`)), 'pas de mélange');
  }
});

test('STOP : désabonnement, suppression des réponses en cours, silence ensuite', async () => {
  const P = '33655555555';
  await say(P, `Avis (${collection.code})`);
  await say(P, 'oui');
  await say(P, 'STOP');
  assert.ok(await one('select 1 from opt_outs where phone_hash=$1', [phoneHash(P)]));
  const s = await one('select * from sessions where phone_hash=$1', [phoneHash(P)]);
  assert.equal(s.state, 'opted_out');
  assert.equal(s.phone, null);
  const before = await one(`select count(*)::int as n from messages where phone_hash=$1 and direction='out'`, [phoneHash(P)]);
  await say(P, 'coucou');
  const afterN = await one(`select count(*)::int as n from messages where phone_hash=$1 and direction='out'`, [phoneHash(P)]);
  assert.equal(afterN.n, before.n, 'aucune réponse après STOP');
});

test('refus du consentement : rien de conservé', async () => {
  const P = '33656565656';
  await say(P, `Avis (${collection.code})`);
  await deliver(fakeInbound({ phone: P, text: 'Non merci', buttonId: 'consent_no' }));
  const s = await one('select * from sessions where phone_hash=$1', [phoneHash(P)]);
  assert.equal(s.state, 'declined');
  const n = await one(`select count(*)::int as n from messages where session_id=$1 and direction='in'`, [s.id]);
  assert.equal(n.n, 0);
});

test('bilan WhatsApp : seuil de confidentialité puis synthèse', async () => {
  await query('update companies set privacy_threshold=10 where id=$1', [company.id]);
  await say(OWNER, 'Fais-moi le bilan de ma collecte');
  assert.match(await lastOut(OWNER), /à partir de 10 répondants/);
  await query('update companies set privacy_threshold=5 where id=$1', [company.id]);
  await say(OWNER, 'Fais-moi le bilan de ma collecte');
  const out = await lastOut(OWNER);
  assert.match(out, /Participants : 5/);
  assert.match(out, /Problèmes principaux/);
  assert.match(out, /Actions recommandées/);
  assert.ok(!out.includes('numéro 1'), 'pas de verbatim dans la synthèse');
});

test('garde-fou : numéros hors liste de test ignorés', async () => {
  config.allowedNumbers.push(OWNER);
  await say('33677777777', `Avis (${collection.code})`);
  config.allowedNumbers.length = 0;
  assert.equal(await one('select 1 from sessions where phone_hash=$1', [phoneHash('33677777777')]), null);
});

test('CRM : connexion, données visibles, cloisonnement entre entreprises', async () => {
  const login = async (email, password) => {
    const r = await fetch(`${base}/login`, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ email, password }) });
    return r.headers.get('set-cookie')?.split(';')[0];
  };
  assert.equal(await fetch(`${base}/`, { redirect: 'manual' }).then((r) => r.status), 302);
  assert.equal(await login('a@test.fr', 'mauvais'), undefined);
  const ca = await login('a@test.fr', 'motdepasse-test');
  const page = await fetch(`${base}/collections/${collection.id}`, { headers: { cookie: ca } }).then((r) => r.text());
  assert.match(page, /Réponses<\/div><div class="kpi">5/);
  assert.match(page, /bruyante/);
  const qr = await fetch(`${base}/collections/${collection.id}/qr.png`, { headers: { cookie: ca } });
  assert.equal(qr.headers.get('content-type'), 'image/png');
  const cb = await login('b@test.fr', 'motdepasse-autre');
  assert.equal(await fetch(`${base}/collections/${collection.id}`, { headers: { cookie: cb } }).then((r) => r.status), 404);
});

test('maintenance : purge selon la durée de conservation', async () => {
  await query(`update sessions set created_at = now() - interval '100 days' where collection_id=$1`, [collection.id]);
  await runMaintenance();
  const n = await one('select count(*)::int as n from feedbacks where collection_id=$1', [collection.id]);
  assert.equal(n.n, 0);
});

// ================= Parcours alertes remontées =================
const { runAlerts, parisNow, addDays } = await import('../src/alerts.js');
const { createCollection } = await import('../src/conversation.js');

test('alertes : inscription, questions, info du matin, retour de fin de journée, fin', async () => {
  const col = await createCollection(company.id, 'votre journée de ski', "Comment s'est passée votre journée de ski ?", 'alerts');
  const P = '33688888888';
  const today = parisNow().date;
  const d1 = addDays(today, 1);

  await say(P, `Bonjour, je veux recevoir les infos remontées (${col.code})`);
  assert.match(await lastOut(P), /chaque matin.*Acceptez-vous/s);
  await deliver(fakeInbound({ phone: P, text: "Oui, j'accepte", buttonId: 'alert_yes' }));
  assert.match(await lastOut(P), /Quel domaine/);
  await deliver(fakeInbound({ phone: P, text: 'Brévent – Flégère', buttonId: 'dom:brevent-flegere' }));
  assert.match(await lastOut(P), /Pour quels jours/);
  await say(P, 'demain');
  let sub = await one('select * from subscriptions where phone_hash=$1', [phoneHash(P)]);
  assert.equal(sub.state, 'active');
  assert.deepEqual(sub.days, [d1]);

  await say(P, 'Est-ce que le téléphérique du Brévent est ouvert demain ?');
  await say(P, 'Combien coûte le forfait journée ?');
  const qs = await query('select topic, answerable from questions where collection_id=$1 order by created_at', [col.id]);
  assert.equal(qs.length, 2);
  assert.equal(qs[0].topic, 'ouverture_remontees');
  assert.equal(qs[1].answerable, false, 'question sans réponse repérée');
  assert.match(await lastOut(P), /Données de démonstration/);

  let r = await runAlerts({ date: d1, hour: 9 });
  assert.equal(r.morning, 1);
  assert.match(await lastOut(P), /Brévent – Flégère.*Ouvert/s);
  r = await runAlerts({ date: d1, hour: 10 });
  assert.equal(r.morning, 0, 'pas de doublon');

  r = await runAlerts({ date: d1, hour: 16 });
  assert.equal(r.eod, 1);
  assert.match(await lastOut(P), /Comment s'est passée votre journée/);
  await say(P, "Super journée, la neige était top mais énorme attente au téléphérique du Brévent le matin, il faudrait plus de cabines.");
  const f = await one('select * from feedbacks where collection_id=$1', [col.id]);
  assert.ok(f && f.verbatim.includes('attente'), 'retour de fin de journée analysé');

  r = await runAlerts({ date: addDays(d1, 1), hour: 9 });
  sub = await one('select * from subscriptions where id=$1', [sub.id]);
  assert.equal(sub.state, 'ended');
  assert.equal(sub.phone, null, 'numéro effacé après le dernier jour');
});

test('alertes : fenêtre WhatsApp fermée = pas d’envoi libre', async () => {
  const col = await one(`select * from collections where kind='alerts' limit 1`);
  const P = '33689999999';
  const d3 = addDays(parisNow().date, 3);
  await say(P, `Infos (${col.code})`);
  await say(P, 'oui');
  await say(P, 'Les Houches');
  await deliver(fakeInbound({ phone: P, text: 'J+3', buttonId: `days:${d3}` }));
  await query(`update messages set created_at = now() - interval '3 days' where phone_hash=$1`, [phoneHash(P)]);
  const before = await one(`select count(*)::int as n from messages where phone_hash=$1 and direction='out'`, [phoneHash(P)]);
  await runAlerts({ date: d3, hour: 8 });
  const after = await one(`select count(*)::int as n from messages where phone_hash=$1 and direction='out'`, [phoneHash(P)]);
  assert.equal(after.n, before.n);
  const sub = await one('select skipped_window from subscriptions where phone_hash=$1', [phoneHash(P)]);
  assert.equal(sub.skipped_window, 1);
});

test('alertes : le dirigeant abonné garde ses commandes, STOP résilie', async () => {
  const col = await one(`select * from collections where kind='alerts' limit 1`);
  await say(OWNER, `Infos (${col.code})`);
  await say(OWNER, 'oui');
  await say(OWNER, 'Grands Montets');
  await say(OWNER, 'les 3 prochains jours');
  const sub = await one(`select * from subscriptions where phone_hash=$1 and state='active'`, [phoneHash(OWNER)]);
  assert.equal(sub.days.length, 3);
  await say(OWNER, 'Fais-moi le bilan de ma collecte');
  assert.match(await lastOut(OWNER), /Bilan/);
  await say(OWNER, 'Il y a des navettes entre les domaines ?');
  assert.match(await lastOut(OWNER), /Données de démonstration/);
  await say(OWNER, 'STOP');
  assert.equal((await one('select state from subscriptions where id=$1', [sub.id])).state, 'opted_out');
});

test('alertes : un retour spontané est enregistré comme retour, pas comme question', async () => {
  const col = await one(`select * from collections where kind='alerts' limit 1`);
  const P = '33687777777';
  await say(P, `Infos (${col.code})`);
  await say(P, 'oui');
  await say(P, 'Grands Montets');
  await say(P, 'demain');
  const before = await one('select count(*)::int as n from feedbacks where collection_id=$1', [col.id]);
  await say(P, "Beaucoup trop d'attente à Lognan ce matin, c'était vraiment pénible.", { audio: true });
  const after = await one('select count(*)::int as n from feedbacks where collection_id=$1', [col.id]);
  assert.equal(after.n, before.n + 1);
  assert.match(await lastOut(P), /transmis à l'équipe/);
  assert.equal(await one(`select 1 from questions where question like 'Beaucoup trop%'`), null);
});

test('lien d’inscription configurable : ATMB, 3 questions au départ, infos du jour', async () => {
  const { presetConfig } = await import('../src/optins.js');
  const { addDailyInfo } = await import('../src/alerts.js');
  const cfg = presetConfig('atmb_trafic');
  const col = await createCollection(company.id, cfg.title, cfg.eod_question, 'alerts', cfg);
  const P = '33686666666';
  const d1 = addDays(parisNow().date, 1);

  await say(P, `Bonjour, je veux recevoir les infos (${col.code})`);
  assert.match(await lastOut(P), /info trafic.*Acceptez-vous/s);
  await say(P, 'oui');
  assert.match(await lastOut(P), /Quel itinéraire/);
  await deliver(fakeInbound({ phone: P, text: 'Tunnel du Mont-Blanc', buttonId: 'opt:tunnel' }));
  assert.match(await lastOut(P), /Quelles infos.*1\. Fermetures/s);
  await say(P, '1 et 2');
  assert.match(await lastOut(P), /Pour quels jours/);
  await say(P, 'demain');
  const sub = await one('select * from subscriptions where phone_hash=$1', [phoneHash(P)]);
  assert.equal(sub.state, 'active');
  assert.deepEqual(sub.choices, { route: 'tunnel', alerts: ['fermetures', 'attente'], days: [d1] });
  assert.match(await lastOut(P), /Tunnel du Mont-Blanc · Fermetures et coupures, Temps d'attente/);

  await addDailyInfo(col.id, d1, 'Convoi exceptionnel à 14h, prévoir 30 min d’attente');
  const r = await runAlerts({ date: d1, hour: 7 });
  assert.equal(r.morning, 1);
  const morning = await lastOut(P);
  assert.match(morning, /Tunnel du Mont-Blanc/);
  assert.match(morning, /Attente au tunnel/);
  assert.doesNotMatch(morning, /Travaux/, 'seulement les infos choisies');
  assert.match(morning, /Convoi exceptionnel/);
  await runAlerts({ date: d1, hour: 16 });
  assert.doesNotMatch(await lastOut(P), /Bonsoir/, 'question de fin de journée à 18h pour ce lien, pas 16h');
  await runAlerts({ date: d1, hour: 18 });
  assert.match(await lastOut(P), /Comment s'est passé votre trajet/);
});

test('direction : un lecteur interroge les retours par WhatsApp, sans pouvoir créer de collecte', async () => {
  const READER = '33612121212';
  await query('update companies set reader_phones=$2 where id=$1', [company.id, [READER]]);
  await say(READER, "Est-ce qu'il y a eu des problèmes aujourd'hui à la Flégère ?");
  const out = await lastOut(READER);
  assert.match(out, /retour/);
  assert.match(out, /\d+ retour\(s\), \d+ question\(s\) · /);
  assert.doesNotMatch(out, /336\d{8}/, 'aucun numéro de téléphone');
  await say(READER, 'Je veux savoir ce que mes clients ont pensé du restaurant');
  assert.match(await lastOut(READER), /réservée au dirigeant/);
  const { gatherData } = await import('../src/insights.js');
  const d = await gatherData(company.id, 'today');
  assert.ok(d.text.includes('Brévent – Flégère'), 'les retours sont rattachés au domaine choisi');
});

test('dirigeant abonné : les questions sur les retours vont à l’analyse, les questions pratiques à l’assistant', async () => {
  const col = await one(`select * from collections where kind='alerts' and config is null limit 1`);
  await say(OWNER, `Infos (${col.code})`);
  await say(OWNER, 'oui');
  await say(OWNER, 'Grands Montets');
  await say(OWNER, 'demain');
  await say(OWNER, "Est-ce qu'il y a eu des problèmes signalés cette semaine ?");
  assert.match(await lastOut(OWNER), /\d+ retour\(s\), \d+ question\(s\) · /);
  await say(OWNER, 'Il y a des navettes entre les domaines ?');
  assert.match(await lastOut(OWNER), /Données de démonstration/);
});

test('réactions : emoji adapté au contenu, jamais de sourire sur un problème', async () => {
  const { reactionFor } = await import('../src/conversation.js');
  assert.equal(reactionFor('Quelle neige ce matin, de la poudreuse partout'), '❄️');
  assert.equal(reactionFor('Pas de neige et une attente énorme, très déçu'), '🙏');
  assert.equal(reactionFor('Merci pour tout, super journée'), '😊');
  assert.equal(reactionFor('Grand beau sur les pistes'), '☀️');
  assert.equal(reactionFor('Le téléphérique est fermé à cause du vent ?'), '🙏');
  assert.equal(reactionFor('Bonjour'), '👋');
  assert.equal(reactionFor('Hey LEMO !'), '👋');
  assert.equal(reactionFor('Quelle heure ?'), '👍');
});

test('invitation : page minimale, relance, synthèse en deux parties, 5 invitations à transférer', async () => {
  const page = await fetch(`${base}/i`).then((r) => r.text());
  assert.match(page, /og:title" content="Florio t&#39;invite sur LEMO"/);
  assert.match(page, /og:description" content="Une invitation privée d’un membre LEMO\./);
  assert.match(page, /og:image" content="[^"]+\/public\/lemo-thumb\.png\?v=\w+"/);
  assert.match(page, /og:image:width" content="200"/);
  assert.match(page, />Bienvenue, Florio<br>t'invite sur LEMO\.<\/h1>/);
  assert.match(page, />Commencer</);
  assert.match(page, /placeholder="Ton prénom"/);
  assert.doesNotMatch(page, /Confidentialité|lemohq|Bonjour|votre/i);
  const js = await fetch(`${base}/public/invite.js`).then((r) => r.text());
  assert.match(js, /Hey LEMO, c'est /, 'message prérempli reconnu par LEMO');
  const thumb = await fetch(`${base}/public/lemo-thumb.png`);
  assert.equal(thumb.headers.get('content-type'), 'image/png');
  await fetch(`${base}/i/evt?k=continue`, { method: 'POST' });

  const P = '33688881111';
  const outsOf = async (phone) => (await query(`select body from messages where phone_hash=$1 and direction='out' order by seq`, [phoneHash(phone)])).map((r) => r.body);
  await say(P, "Hey LEMO, c'est florio !");
  let outs = await outsOf(P);
  assert.equal(outs.length, 4, 'quatre messages d’accueil');
  assert.match(outs[0], /^Hello Florio\. Je suis LEMO/);
  assert.match(outs[1], /5 invitations, débloquées après ta première expérience/);
  assert.match(outs[2], /Le plus simple pour comprendre.*confidentielles\. Seul Florio, le fondateur, pourra te recontacter\. Écris STOP/);
  assert.doesNotMatch(outs[2], /lit|lire|accès/);
  assert.match(outs[3], /événement marquant de ta journée/);

  // Événement marquant -> relance
  await say(P, "Ce midi, déjeuner avec un client important dans une brasserie bondée : l'ambiance était tendue au début, on attendait les plats depuis longtemps, puis tout s'est détendu.");
  assert.match(await lastOut(P), /\?/);
  let m = await one('select * from members where phone_hash=$1', [phoneHash(P)]);
  assert.equal(m.first_name, 'Florio');
  assert.equal(m.state, 'awaiting_blindspot');

  // Relance -> synthèse « Vu par LEMO » / « Enquête de satisfaction · J+4 », puis les invitations
  await say(P, "Quand il a reconnu que notre proposition l'avait surpris, tout s'est détendu.");
  m = await one('select * from members where phone_hash=$1', [phoneHash(P)]);
  assert.equal(m.state, 'experienced');
  assert.equal(m.invites_total, 5);
  assert.match(m.invite_code, /^[A-Z0-9]{6}$/);
  outs = await outsOf(P);
  assert.equal(outs.length, 7, 'synthèse puis invitations, sans image');
  assert.match(outs[3], /^Peux-tu me décrire un événement marquant de ta journée \?/);
  assert.ok(!outs.some((b) => /^\[image\]/.test(b)), 'ni courbe ni vue dirigeant');
  const synth = outs[5];
  assert.match(synth, /^\*Vu par LEMO, à chaud\*\n\*Ressenti :\* /);
  assert.match(synth, /\n\n\*Enquête de satisfaction, à J\+4\*\nIl aurait fallu retrouver le mail.*Réponse type : \*7\/10\*, « Bien, rien à signaler\. »/);
  assert.match(synth, /\n\n\*La différence\*\nTu as raconté ce moment à chaud.*WhatsApp.*le moment le plus fort et la fin/);
  assert.doesNotMatch(synth, /plus riche|[—–]/);
  const invite = outs[6];
  assert.match(invite, /^Merci Florio\. Tes 5 invitations sont débloquées\./);
  // Variante A (premier parcours) : le bouton passe par un lien suivi, puis ouvre le partage WhatsApp
  assert.equal(m.variant, 'A');
  const go = invite.match(/\[Envoyer l'invitation\] (\S+)$/)[1];
  assert.match(go, new RegExp(`/go/i/${m.invite_code}$`));
  const BROWSER = { 'user-agent': 'Mozilla/5.0 (iPhone) Safari' };
  const click = await fetch(go.replace(/^https?:\/\/[^/]+/, base), { redirect: 'manual', headers: BROWSER });
  assert.equal(click.status, 302);
  const share = decodeURIComponent(click.headers.get('location').match(/^https:\/\/wa\.me\/\?text=(.+)$/)[1]);
  assert.match(share, new RegExp(`^Je t'invite sur LEMO.*/i/${m.invite_code}$`));
  await fetch(go.replace(/^https?:\/\/[^/]+/, base), { redirect: 'manual', headers: { 'user-agent': 'WhatsApp/2.24.1 A' } });
  assert.equal((await one(`select count(*)::int as n from ab_events where member_id=$1 and kind='cta_click'`, [m.id])).n, 1, 'le robot d’aperçu ne compte pas');
  assert.ok(!(await outsOf('33699990000')).length, 'plus d’alerte « nouvel early adopter »');

  // Réponse trop courte : LEMO le dit, analyse un exemple universel
  const T = '33655554444';
  await say(T, "Hey LEMO, c'est Léa !");
  await say(T, 'Un café.');
  await say(T, 'Bien.');
  const t = await outsOf(T);
  assert.match(t[t.length - 3], /^J'ai très peu d'informations sur ton moment\. Pour te montrer ce que LEMO capte, prenons un exemple :\n\n_« .+ »_$/);
  assert.match(t[t.length - 2], /^\*Vu par LEMO, à chaud\*/);

  // Lien personnel : « Florio t'invite sur LEMO », puis l'invité est rattaché à Florio
  const mine = await fetch(`${base}/i/${m.invite_code}`).then((r) => r.text());
  assert.match(mine, /og:title" content="Florio t&#39;invite sur LEMO"/);
  assert.match(mine, new RegExp(`"code":"${m.invite_code}"`));
  const G = '33677770000';
  await say(G, `Hey LEMO, c'est Marc ! (invitation ${m.invite_code})`);
  const guest = await one('select * from members where phone_hash=$1', [phoneHash(G)]);
  assert.equal(guest.invited_by, m.id);
  assert.equal(guest.first_name, 'Marc');
  const marcPage = await fetch(`${base}/i/${(await one('select invite_code from members where id=$1', [m.id])).invite_code}`).then((r) => r.text());
  assert.match(marcPage, /Bienvenue, Florio/);

  // STOP : plus de contact, réponses effacées, plus de bouton « Écrire »
  await say(T, 'STOP');
  assert.match(await lastOut(T), /^C'est noté : tu ne recevras plus de messages de LEMO/);
  const stopped = await one('select * from members where phone_hash=$1', [phoneHash(T)]);
  assert.ok(stopped.opted_out_at);
  assert.equal(stopped.phone, null);
  assert.equal(stopped.experience, null);

  // CRM : entonnoir et fiche avec bouton « Écrire »
  const cookie = (await fetch(`${base}/login`, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ email: 'a@test.fr', password: 'motdepasse-test' }) })).headers.get('set-cookie').split(';')[0];
  const login = await fetch(`${base}/login`, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ email: 'a@test.fr', password: 'motdepasse-test' }) });
  assert.equal(login.headers.get('location'), '/early-adopters', 'on arrive directement sur les early adopters');
  const crm = await fetch(`${base}/early-adopters`, { headers: { cookie } }).then((r) => r.text());
  assert.match(crm, /<h1>Early adopters<\/h1>/);
  assert.match(crm, /Du lien à la conversation/);
  assert.match(crm, /Copier mon lien d’invitation/);
  assert.doesNotMatch(crm, /Collectes/);
  assert.match(crm, /href="\/settings">.*Réglages<\/a>/s);
  assert.match(crm, /href="\/logout"/);
  assert.match(crm, /data-phone="33688881111"/, 'Florio est à recontacter, avec son message prêt');
  assert.match(crm, /Salut Florio, c’est Florio, fondateur de LEMO/);
  // Invitations : 1 invité arrivé sur 5, on en ajoute 5
  const florioId = (await one('select id from members where phone_hash=$1', [phoneHash(P)])).id;
  assert.match(crm, /<strong>1<\/strong> invité arrivé · <strong>4<\/strong> restantes sur 5/);
  assert.match(crm, /Invités : Marc/);
  const add = await fetch(`${base}/early-adopters/${florioId}/invites`, { method: 'POST', redirect: 'manual', headers: { cookie, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'add=5' });
  assert.equal(add.status, 303);
  assert.equal((await one('select invites_total from members where id=$1', [florioId])).invites_total, 10);
  assert.equal((await fetch(`${base}/early-adopters/${florioId}/invites`, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'add=5' })).status, 302, 'réservé au compte connecté');

  // Réglages : e-mail d'alerte et numéro
  const st = await fetch(`${base}/settings`, { method: 'POST', redirect: 'manual', headers: { cookie, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'alert_email=alerte%40exemple.fr&owner_phone=33611111111' });
  assert.equal(st.headers.get('location'), '/settings?saved=1');
  const settings = await fetch(`${base}/settings`, { headers: { cookie } }).then((r) => r.text());
  assert.match(settings, /value="alerte@exemple\.fr"/);
  assert.match(settings, /Enregistré|E-mail d’alerte/);
  assert.equal((await fetch(`${base}/`, { redirect: 'manual', headers: { cookie } })).headers.get('location'), '/early-adopters');

  // Connexion aux couleurs de LEMO
  const loginPage = await fetch(`${base}/login`).then((r) => r.text());
  assert.match(loginPage, /<title>Connexion · LEMO<\/title>/);
  assert.match(loginPage, /<svg[^>]*viewBox="0 0 864 278"/);
  assert.match(loginPage, /placeholder="E-mail"/);
  assert.match(loginPage, /<link rel="apple-touch-icon" sizes="180x180" href="\/public\/apple-touch-icon\.png">/);
  assert.equal((await fetch(`${base}/public/apple-touch-icon.png`)).headers.get('content-type'), 'image/png');
  assert.match(await fetch(`${base}/public/manifest.webmanifest`).then((r) => r.text()), /"start_url": "\/early-adopters"/);

  // Après « Envoyer depuis mon WhatsApp » : passe dans « Contactés »
  const florio = await one('select id from members where phone_hash=$1', [phoneHash(P)]);
  assert.equal((await fetch(`${base}/early-adopters/${florio.id}/contacted`, { method: 'POST', headers: { cookie } })).status, 204);
  assert.doesNotMatch(await fetch(`${base}/early-adopters`, { headers: { cookie } }).then((r) => r.text()), /data-phone="33688881111"/);
  const done = await fetch(`${base}/early-adopters?f=done`, { headers: { cookie } }).then((r) => r.text());
  assert.match(done, /Contacté à l&#39;instant/);
  const all = await fetch(`${base}/early-adopters?f=all`, { headers: { cookie } }).then((r) => r.text());
  assert.match(all, /STOP, ne plus contacter/);
  assert.doesNotMatch(all, /data-phone="33655554444"/);
  assert.equal((await fetch(`${base}/early-adopters/${florio.id}/contacted`, { method: 'POST', redirect: 'manual' })).status, 302, 'réservé au compte connecté');
});

test('citation : affichée seulement si elle existe mot pour mot', async () => {
  const { verifiedQuote } = await import('../src/onboarding.js');
  assert.equal(verifiedQuote('tout s’est détendu', "Puis tout s'est détendu."), 'tout s’est détendu');
  assert.equal(verifiedQuote('une phrase inventée', 'Rien à voir.'), null);
});

test('rédaction : aucun tiret long ni moyen dans les textes générés', async () => {
  const { noDashes } = await import('../src/llm.js');
  assert.deepEqual(noDashes({ a: 'Ressenti — attente', b: ['x – y'], c: 3 }), { a: 'Ressenti, attente', b: ['x, y'], c: 3 });
});

test('alerte au fondateur : notification push sans aucun détail confié', async () => {
  const { notifyNewFeedback } = await import('../src/notify.js');
  const calls = [];
  const realFetch = globalThis.fetch;
  process.env.NTFY_TOPIC = 'lemo-test-topic';
  globalThis.fetch = async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return { ok: true }; };
  try {
    assert.equal(await notifyNewFeedback({ firstName: 'Franz', inviter: 'Florio' }), 1);
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.NTFY_TOPIC;
  }
  assert.equal(calls[0].url, 'https://ntfy.sh/');
  assert.equal(calls[0].body.topic, 'lemo-test-topic');
  assert.match(calls[0].body.title, /Franz a terminé son parcours/);
  assert.match(calls[0].body.click, /\/early-adopters$/);
});

test('synthèse : trois lignes seulement, et transposition en entreprise pour un moment privé', async () => {
  const { synthesisMessage } = await import('../src/onboarding.js');
  const base = {
    lemo_lines: [
      { label: 'Ressenti', text: 'détente au début, agacement ensuite' },
      { label: 'Bascule', text: 'l’eau froide au bout de deux minutes' },
      { label: 'Angle mort', text: 'un hôtel ne saurait jamais que l’eau chaude manque' },
      { label: 'Détail', text: 'pression faible' },
    ],
    survey_score: 8, survey_comment: 'Chambre propre.', survey_lost: 'Le coup de froid aurait disparu.', quote: null,
  };
  const privateMoment = synthesisMessage({ ...base, business_context: 'à un hôtel ou un spa' });
  assert.match(privateMoment, /^_Ton moment est personnel\. Transposons-le à un hôtel ou un spa, là où une entreprise vend l'expérience\._\n\n\*Vu par LEMO, à chaud\*/);
  assert.doesNotMatch(privateMoment, /Détail/);
  assert.doesNotMatch(synthesisMessage({ ...base, business_context: null }), /Transposons/);
});

test('test A/B : variante B, de « Créer ma campagne » au retour reçu par le dirigeant', async () => {
  process.env.AB_FORCE = 'B';
  const L = '33622223333';
  const P1 = '33644445555';
  const outsOf = async (phone) => (await query(`select body from messages where phone_hash=$1 and direction='out' order by seq`, [phoneHash(phone)])).map((r) => r.body);
  try {
    await say(L, "Hey LEMO, c'est Mehdi !");
    await say(L, "Ce matin, réunion d'équipe tendue sur le planning de la saison : personne n'osait parler, puis une proposition a tout débloqué.");
    await say(L, "Quand Sarah a proposé de tester deux équipes, l'ambiance a changé d'un coup.");
  } finally {
    delete process.env.AB_FORCE;
  }
  let lm = await one('select * from members where phone_hash=$1', [phoneHash(L)]);
  assert.equal(lm.variant, 'B');
  assert.match(await lastOut(L), /^Merci Mehdi\. Tes 5 invitations sont débloquées\.\n\nUtilise-les pour lancer ta propre campagne/);

  // Clic sur le bouton « Créer ma campagne », puis le sujet
  await say(L, 'Créer ma campagne', { buttonId: 'campaign_start' });
  assert.match(await lastOut(L), /Sur quel moment veux-tu le ressenti de tes 5 personnes/);
  await say(L, "L'accueil de mes clients au restaurant ce midi");
  const ready = await lastOut(L);
  assert.match(ready, /^\*Ta campagne est prête\*\n\*Sujet :\* .+\n\*La question :\* « .+ »/);
  const c = await one('select * from campaigns where member_id=$1', [lm.id]);
  assert.match(ready, new RegExp(`\\[Envoyer la campagne\\] .*/go/c/${c.code}$`));
  assert.match(c.forward_message, new RegExp(`^Salut, c'est Mehdi\\. J'aimerais ton ressenti, à chaud.*sans ton numéro\\. Pour répondre : .*/c/${c.code}$`));

  // Le dirigeant transfère (clic suivi), le participant ouvre le lien puis WhatsApp
  const BROWSER = { 'user-agent': 'Mozilla/5.0 (iPhone) Safari' };
  const fwd = await fetch(`${base}/go/c/${c.code}`, { redirect: 'manual', headers: BROWSER });
  assert.equal(decodeURIComponent(fwd.headers.get('location').replace('https://wa.me/?text=', '')), c.forward_message);
  const landing = await fetch(`${base}/c/${c.code}`, { headers: BROWSER }).then((r) => r.text());
  assert.match(landing, /og:title" content="Mehdi te demande ton avis"/);
  assert.match(landing, new RegExp(`Hey%20LEMO%2C%20je%20r%C3%A9ponds%20%C3%A0%20Mehdi%20\\(campagne%20${c.code}\\)`));

  // Le participant répond : présentation + question, relance, merci ; le dirigeant reçoit le retour
  await say(P1, `Hey LEMO, je réponds à Mehdi (campagne ${c.code})`);
  const p = await outsOf(P1);
  assert.match(p[0], /^Bonjour, je suis LEMO\. Mehdi aimerait ton ressenti, à chaud\. Ta réponse lui sera transmise, sans ton numéro\./);
  assert.equal(p[1], c.question);
  assert.equal((await one('select state from members where phone_hash=$1', [phoneHash(P1)])), null, 'un participant n’est pas inscrit comme early adopter');
  await say(P1, "On a attendu vingt minutes avant qu'on nous installe, personne ne nous a prévenus.");
  assert.match(await lastOut(P1), /\?/);
  await say(P1, "Le serveur s'est excusé en nous offrant le café, ça a tout rattrapé.");
  assert.match(await lastOut(P1), /^Merci, ton retour est transmis à Mehdi\. LEMO est en accès sur invitation/);
  const r = await one('select * from campaign_responses where phone_hash=$1', [phoneHash(P1)]);
  assert.equal(r.state, 'done');
  assert.equal(r.phone, null, 'numéro du participant effacé');
  const back = await lastOut(L);
  assert.match(back, /^\*Retour 1 · .+\*\n\*Ressenti :\* /);
  assert.doesNotMatch(back.split('\n').slice(1).join('\n'), /\b(tu|te|ton|ta|tes|t')\b/i, 'le dirigeant lit le retour de quelqu’un d’autre : jamais « tu »');

  // Après la démo : message de fin fixe (sans IA), deux sorties : inviter, ou parler à un référent
  await say(L, "Ok, très bien, j'ai vu les retours. Qu'est-ce que je fais maintenant ?");
  const end = await lastOut(L);
  assert.match(end, /^Ta démo LEMO est terminée, merci pour ces échanges\.\n\nPour aller plus loin :\n• inviter 5 personnes à vivre LEMO : .*\/go\/i\/[A-Z0-9]{6}\n• en savoir plus sur la mise en place de LEMO : contacte l'équipe LEMO avec le bouton\.$/m);
  assert.match(end, /\[Contacter LEMO\] .*\/go\/r\/[A-Z0-9]{6}$/);
  const ref = await fetch(end.match(/\[Contacter LEMO\] (\S+)$/)[1].replace(/^https?:\/\/[^/]+/, base), { redirect: 'manual', headers: BROWSER });
  assert.match(decodeURIComponent(ref.headers.get('location')), new RegExp(`^https://wa\\.me/${OWNER}\\?text=Bonjour, c'est Mehdi\\. J'ai testé LEMO et j'aimerais en savoir plus sur sa mise en place\\.$`));
  await say(L, 'Créer ma campagne', { buttonId: 'campaign_start' });
  assert.match(await lastOut(L), /^Ta démo LEMO est terminée/, 'une seule campagne par personne');
  await say(L, "Hey LEMO, c'est Mehdi !");
  assert.match(await lastOut(L), /^Ta démo LEMO est terminée/, 'une seule démo par personne');
  // Le participant qui réécrit : merci fixe, sans IA
  await say(P1, 'Super merci !');
  assert.match(await lastOut(P1), /^Merci, ton retour a bien été transmis à Mehdi\./);

  // Le CRM : test A/B et campagne dans la fiche
  const cookie = (await fetch(`${base}/login`, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ email: 'a@test.fr', password: 'motdepasse-test' }) })).headers.get('set-cookie').split(';')[0];
  const crm = await fetch(`${base}/early-adopters?f=all`, { headers: { cookie } }).then((r) => r.text());
  assert.match(crm, /Test A\/B · fin de parcours/);
  assert.match(crm, /Créer ma campagne/);
  assert.match(crm, /Réponses complètes/);
  assert.match(crm, /Équipe LEMO contactée/);
  assert.match(crm, /« Envoyer l’invitation »|Envoyer l’invitation/);
  assert.match(crm, new RegExp(`Campagne · ${c.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
});

test('lien du fondateur : toujours « Florio t’invite », même testé sous un autre prénom', async () => {
  const F = OWNER; // numéro du dirigeant de l'entreprise de test
  await query(`insert into members (phone_hash, phone, first_name, invite_code, state) values ($1,$2,'Mehdi','FNDR01','experienced') on conflict (phone_hash) do update set first_name='Mehdi', invite_code='FNDR01'`, [phoneHash(F), F]);
  const page = await fetch(`${base}/i/FNDR01`).then((r) => r.text());
  assert.match(page, /og:title" content="Florio t&#39;invite sur LEMO"/);
});

test('le fondateur peut refaire la démo pour ses tests', async () => {
  await say(OWNER, "Hey LEMO, c'est Florio !");
  assert.match(await lastOut(OWNER), /Peux-tu me décrire un événement marquant de ta journée/);
});
