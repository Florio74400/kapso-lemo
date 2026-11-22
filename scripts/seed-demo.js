// Données de démonstration : une entreprise fictive + une collecte avec quelques retours.
import { query, one } from '../src/db.js';
import { hashPassword } from '../src/server.js';
import { createCollection } from '../src/conversation.js';

export const DEMO_EMAIL = 'demo@lemo.local';
export const DEMO_PASSWORD = 'demo-lemo';
export const DEMO_OWNER_PHONE = '33600000099';

export async function seedDemo() {
  if (await one('select 1 from companies where admin_email=$1', [DEMO_EMAIL])) return;
  const c = await one(
    `insert into companies (name, admin_email, admin_password_hash, owner_phones) values ($1,$2,$3,$4) returning *`,
    ['Hôtel du Mont (démo)', DEMO_EMAIL, hashPassword(DEMO_PASSWORD), [DEMO_OWNER_PHONE]],
  );
  await createCollection(c.id, 'votre séjour', 'Comment avez-vous vécu votre séjour chez nous ? Racontez-nous librement, par écrit ou en vocal.');
  console.log(`[démo] entreprise créée. Connexion : ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
}
