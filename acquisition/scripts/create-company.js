// Crée une entreprise et son accès administrateur.
// Le mot de passe est lu depuis la variable d'environnement ADMIN_PASSWORD (jamais en argument).
// Usage : ADMIN_PASSWORD=... node scripts/create-company.js "Nom" admin@exemple.fr 33612345678
import { initDb, one, closeDb } from '../src/db.js';
import { hashPassword } from '../src/server.js';

const [name, email, ownerPhone] = process.argv.slice(2);
const password = process.env.ADMIN_PASSWORD;
if (!name || !email || !password || password.length < 10) {
  console.error('Usage : ADMIN_PASSWORD=<10 caractères min> node scripts/create-company.js "Nom" email [numéro_dirigeant]');
  process.exit(1);
}
await initDb();
const phones = ownerPhone ? [ownerPhone.replace(/[^0-9]/g, '')] : [];
const c = await one(
  `insert into companies (name, admin_email, admin_password_hash, owner_phones) values ($1,$2,$3,$4) returning id`,
  [name, email, hashPassword(password), phones],
);
console.log(`Entreprise créée (${c.id}).`);
await closeDb();
