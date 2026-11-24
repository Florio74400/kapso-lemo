-- Parcours early adopter, dernière étape : où la personne brancherait LEMO chez elle (donnée de prospection),
-- puis déblocage de ses invitations. Compteur de visites de la page d'invitation pour suivre l'entonnoir.
alter table members add column if not exists projection text;  -- sa réponse : entreprise + moment à capter
alter table members add column if not exists lead jsonb;       -- extraction : entreprise, secteur, cible, moment, accroche
alter table members drop constraint if exists members_state_check;
alter table members add constraint members_state_check check (state in ('awaiting_experience','awaiting_blindspot','awaiting_projection','experienced'));

create table if not exists invite_events (
  id bigserial primary key,
  kind text not null check (kind in ('view','continue')),
  code text,                      -- code d'invitation utilisé (null = lien général)
  created_at timestamptz not null default now()
);
alter table invite_events enable row level security;
