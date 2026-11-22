-- LEMO Mini : schéma initial (Postgres / Supabase).
-- Le même fichier est utilisé en mode démo (base embarquée PGlite).

create table if not exists companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  admin_email text not null unique,
  admin_password_hash text not null,
  -- numéros WhatsApp des dirigeants (format international sans "+", ex: 33612345678)
  owner_phones text[] not null default '{}',
  -- nombre minimum de répondants avant toute synthèse agrégée
  privacy_threshold int not null default 5,
  -- durée de conservation des retours (jours)
  retention_days int not null default 90,
  created_at timestamptz not null default now()
);

create table if not exists collections (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  code text not null unique,            -- ex: LEMO-7KQ2, mis dans le lien wa.me
  title text not null,                  -- sujet court : "votre séjour"
  question text not null,               -- question ouverte posée au client
  status text not null default 'open' check (status in ('open','closed')),
  summary jsonb,                        -- dernière synthèse générée
  summary_count int not null default 0, -- nb de retours au moment de la synthèse
  created_at timestamptz not null default now()
);

-- Une conversation d'un répondant pour une collecte.
-- Le numéro en clair n'est conservé que pendant l'échange, puis effacé (phone_hash reste).
create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null references collections(id) on delete cascade,
  phone text,                       -- effacé à la clôture
  phone_hash text not null,         -- HMAC du numéro, sert à retrouver la session
  state text not null check (state in ('awaiting_consent','awaiting_answer','awaiting_followup','analyzing','done','declined','opted_out')),
  followup_question text,
  last_inbound_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists sessions_phone_hash_idx on sessions(phone_hash, updated_at desc);
create index if not exists sessions_collection_idx on sessions(collection_id);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  seq bigserial,                    -- ordre strict d'arrivée
  session_id uuid references sessions(id) on delete cascade,
  company_id uuid references companies(id) on delete cascade,
  direction text not null check (direction in ('in','out')),
  role text not null check (role in ('respondent','owner','lemo','unknown')),
  wa_message_id text unique,        -- anti-doublon : un message WhatsApp n'est traité qu'une fois
  phone_hash text,
  kind text not null default 'text', -- text | audio | interactive | other
  body text,
  transcript text,
  created_at timestamptz not null default now()
);
create index if not exists messages_session_idx on messages(session_id, seq);

create table if not exists feedbacks (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null unique references sessions(id) on delete cascade,
  collection_id uuid not null references collections(id) on delete cascade,
  verbatim text not null,
  transcript text,
  analysis jsonb not null,
  emotion text,
  sentiment text,
  urgency text,
  simulated boolean not null default false, -- true si analyse faite par le simulateur (sans clé Claude)
  created_at timestamptz not null default now()
);
create index if not exists feedbacks_collection_idx on feedbacks(collection_id, created_at desc);

create table if not exists opt_outs (
  phone_hash text primary key,
  created_at timestamptz not null default now()
);

-- Journal des webhooks reçus : persistance avant réponse 200, anti-doublon par clé d'idempotence.
create table if not exists webhook_events (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending','done','error')),
  error text,
  created_at timestamptz not null default now()
);

-- Accès : l'application serveur se connecte avec un rôle privilégié.
-- On active RLS sans politique pour fermer l'accès via les clés publiques Supabase (anon).
alter table companies enable row level security;
alter table collections enable row level security;
alter table sessions enable row level security;
alter table messages enable row level security;
alter table feedbacks enable row level security;
alter table opt_outs enable row level security;
alter table webhook_events enable row level security;
