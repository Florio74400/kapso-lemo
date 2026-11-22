-- Parcours "alertes remontées" : abonnement par QR code, info du matin, questions libres, retour de fin de journée.

alter table collections add column if not exists kind text not null default 'feedback' check (kind in ('feedback','alerts'));

create table if not exists subscriptions (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null references collections(id) on delete cascade,
  phone text,                          -- nécessaire pour les envois programmés, effacé après le dernier jour
  phone_hash text not null,
  domain text,                         -- identifiant du domaine skiable choisi
  days text[] not null default '{}',   -- jours choisis, format AAAA-MM-JJ (3 jours max)
  state text not null check (state in ('awaiting_consent','choosing_domain','choosing_days','active','ended','declined','opted_out')),
  morning_sent text[] not null default '{}',
  eod_sent text[] not null default '{}',
  skipped_window int not null default 0, -- envois programmés non faits car fenêtre WhatsApp de 24 h fermée
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists subscriptions_phone_idx on subscriptions(phone_hash, updated_at desc);
create index if not exists subscriptions_collection_idx on subscriptions(collection_id);

-- Questions libres posées par les abonnés : ce que les gens cherchent, et ce à quoi on ne sait pas répondre.
create table if not exists questions (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null references collections(id) on delete cascade,
  subscription_id uuid references subscriptions(id) on delete set null,
  phone_hash text,
  domain text,
  question text not null,
  topic text,
  answerable boolean,
  answer text,
  simulated boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists questions_collection_idx on questions(collection_id, created_at desc);

alter table subscriptions enable row level security;
alter table questions enable row level security;
