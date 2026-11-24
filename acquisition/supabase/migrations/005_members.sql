-- Outil d'acquisition : membres early adopters (arrivés par lien d'invitation).
create table if not exists members (
  id uuid primary key default gen_random_uuid(),
  phone_hash text not null unique,
  phone text,                          -- conservé : sert au suivi personnel par le fondateur
  first_name text,
  invite_code text unique,             -- son propre code d'invitation (débloqué après l'expérience)
  invited_by uuid references members(id) on delete set null,
  invites_total int not null default 3,
  state text not null default 'awaiting_experience' check (state in ('awaiting_experience','experienced')),
  experience text,                     -- première expérience racontée (texte ou transcription)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table members enable row level security;
