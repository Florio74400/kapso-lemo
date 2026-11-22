// Accès base de données : même SQL pour Supabase (pg) et pour la base locale embarquée (PGlite).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';

const here = path.dirname(fileURLToPath(import.meta.url));
let client;
let kind;

export async function initDb() {
  if (client) return;
  if (config.databaseUrl) {
    const pg = (await import('pg')).default;
    client = new pg.Pool({ connectionString: config.databaseUrl, ssl: { rejectUnauthorized: false }, max: 5 });
    kind = 'postgres';
  } else {
    const { PGlite } = await import('@electric-sql/pglite');
    if (!config.localDbPath.startsWith('memory://')) fs.mkdirSync(config.localDbPath, { recursive: true });
    client = new PGlite(config.localDbPath);
    kind = 'local';
  }
  const migrations = path.join(here, '..', 'supabase', 'migrations');
  for (const f of fs.readdirSync(migrations).sort()) {
    const sql = fs.readFileSync(path.join(migrations, f), 'utf8');
    if (kind === 'local') await client.exec(sql);
    else await client.query(sql);
  }
}

export function dbKind() {
  return kind;
}

export async function query(sql, params = []) {
  const res = await client.query(sql, params);
  return res.rows;
}

export async function one(sql, params = []) {
  const rows = await query(sql, params);
  return rows[0] || null;
}

export async function closeDb() {
  if (!client) return;
  if (kind === 'local') await client.close();
  else await client.end();
  client = null;
}
