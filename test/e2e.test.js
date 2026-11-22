// Test de bout en bout : webhooks signés Kapso -> conversation -> analyse -> CRM -> bilan.
// Tourne sans aucun compte : base en mémoire, WhatsApp et IA simulés.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.LOCAL_DB_PATH = 'memory://';
process.env.KAPSO_WEBHOOK_SECRET = 'test-secret-0123456789abcdef0123456789';
process.env.APP_SECRET = 'test-app-secret-0123456789abcdef0123456789';
process.env.DEMO_MODE = 'true';
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
