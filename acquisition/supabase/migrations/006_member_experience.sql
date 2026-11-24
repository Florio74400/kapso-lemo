-- Parcours early adopter : événement marquant -> relance sur un angle mort -> restitution (texte + schéma).
alter table members add column if not exists followup text;          -- question de relance posée
alter table members add column if not exists blindspot text;         -- réponse à la relance
alter table members add column if not exists report jsonb;           -- restitution générée
alter table members add column if not exists card_token text unique; -- adresse non devinable du schéma
alter table members drop constraint if exists members_state_check;
alter table members add constraint members_state_check check (state in ('awaiting_experience','awaiting_blindspot','experienced'));
