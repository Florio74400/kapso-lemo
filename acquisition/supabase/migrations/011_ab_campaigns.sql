-- Test A/B de la fin de parcours early adopter :
--   A = « Envoyer l'invitation » (5 invitations à transférer)
--   B = « Créer ma campagne » (le dirigeant choisit un sujet, LEMO rédige la question, 5 personnes répondent à chaud)
alter table members add column if not exists variant text check (variant in ('A','B'));
alter table members drop constraint if exists members_state_check;
alter table members add constraint members_state_check check (state in ('awaiting_experience','awaiting_blindspot','awaiting_projection','experienced','awaiting_campaign_topic'));

-- Mini-campagne créée par un early adopter (variante B).
create table if not exists campaigns (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,                 -- dans le lien transféré : /c/CODE
  member_id uuid not null references members(id) on delete cascade,
  topic text not null,                       -- ce que le dirigeant veut questionner, en ses mots
  title text not null,                       -- sujet court
  subject text not null,                     -- « le déjeuner de ce midi », pour le message transféré
  register text not null default 'tu' check (register in ('tu','vous')),
  question text not null,                    -- la question posée aux participants
  forward_message text not null,             -- le message prêt à transférer
  created_at timestamptz not null default now()
);
alter table campaigns enable row level security;

-- Réponse d'un participant (arrivé de lui-même par le lien : c'est son consentement).
create table if not exists campaign_responses (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  phone_hash text not null,
  phone text,                                -- effacé à la fin du parcours ou au STOP
  state text not null default 'awaiting_answer' check (state in ('awaiting_answer','awaiting_followup','done','stopped')),
  answer text,
  followup text,
  followup_answer text,
  analysis jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (campaign_id, phone_hash)
);
alter table campaign_responses enable row level security;

-- Journal du test A/B : affiché, cliqué, sujet donné, transféré, participant arrivé, réponse terminée…
create table if not exists ab_events (
  id bigserial primary key,
  member_id uuid references members(id) on delete cascade,
  variant text,
  kind text not null,
  created_at timestamptz not null default now()
);
alter table ab_events enable row level security;
create index if not exists ab_events_kind on ab_events (variant, kind);
