-- Liens d'inscription (opt-in) configurables : chaque collecte "alerts" porte sa configuration
-- (questions de départ, options, jours, horaires, source d'informations).

alter table collections add column if not exists config jsonb;

alter table subscriptions add column if not exists choices jsonb not null default '{}'::jsonb; -- réponses aux questions de départ
alter table subscriptions add column if not exists step int not null default 0;                -- question de départ en cours
alter table subscriptions drop constraint if exists subscriptions_state_check;
alter table subscriptions add constraint subscriptions_state_check
  check (state in ('awaiting_consent','choosing','choosing_domain','choosing_days','active','ended','declined','opted_out'));

-- Infos du jour saisies par l'équipe (tableau de bord, plus tard canal personnel), utilisées dans
-- le message du matin et dans les réponses aux questions.
create table if not exists daily_info (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null references collections(id) on delete cascade,
  day text not null,                     -- AAAA-MM-JJ
  body text not null,
  source text not null default 'admin',
  created_at timestamptz not null default now()
);
create index if not exists daily_info_collection_idx on daily_info(collection_id, day);
alter table daily_info enable row level security;
