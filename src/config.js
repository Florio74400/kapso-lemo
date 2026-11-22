// Configuration lue uniquement depuis les variables d'environnement (jamais de secret dans le code).
import crypto from 'node:crypto';

const env = process.env;

function list(v) {
  return (v || '').split(',').map((s) => s.replace(/[^0-9]/g, '')).filter(Boolean);
}

export const config = {
  port: Number(env.PORT || 3000),
  publicUrl: env.PUBLIC_URL || `http://localhost:${env.PORT || 3000}`,

  // Base de données : Supabase (Postgres) si DATABASE_URL est défini, sinon base locale embarquée.
  databaseUrl: env.DATABASE_URL || '',
  localDbPath: env.LOCAL_DB_PATH || './.data/lemo', // 'memory://' pour les tests

  // Kapso
  kapsoApiKey: env.KAPSO_API_KEY || '',
  kapsoPhoneNumberId: env.KAPSO_PHONE_NUMBER_ID || '',
  kapsoWebhookSecret: env.KAPSO_WEBHOOK_SECRET || '',
  // numéro WhatsApp affiché, utilisé pour construire le lien wa.me (format international sans +)
  whatsappDisplayNumber: (env.WHATSAPP_DISPLAY_NUMBER || '').replace(/[^0-9]/g, ''),
  kapsoBaseUrl: env.KAPSO_BASE_URL || 'https://api.kapso.ai/meta/whatsapp/v24.0',

  // Claude
  anthropicApiKey: env.ANTHROPIC_API_KEY || '',
  model: env.ANTHROPIC_MODEL || 'claude-opus-5-5',

  // Sécurité
  appSecret: env.APP_SECRET || '',
  // Garde-fou phase de test : si rempli, LEMO ne répond qu'à ces numéros.
  allowedNumbers: list(env.ALLOWED_TEST_NUMBERS),

  // Mode démo : simulateur + compte de démo. À n'activer qu'en local, jamais en ligne.
  demoMode: env.DEMO_MODE === 'true',
};

if (!config.appSecret) {
  // En démo on génère un secret éphémère ; en réel il faut le fournir.
  if (!config.demoMode) throw new Error('APP_SECRET manquant (voir .env.example)');
  config.appSecret = crypto.randomBytes(32).toString('hex');
}
for (const [name, value] of [['APP_SECRET', config.appSecret], ['KAPSO_WEBHOOK_SECRET', config.kapsoWebhookSecret]]) {
  if (value && (value.length < 32 || value.includes('${{'))) throw new Error(`${name} trop court ou non généré (32 caractères minimum)`);
}

export const llmMode = () => (config.anthropicApiKey ? 'claude' : 'simulated');
export const kapsoLive = () => Boolean(config.kapsoApiKey && config.kapsoPhoneNumberId);
